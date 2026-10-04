import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const require = createRequire(import.meta.url);

/** The rails' ABIs, exactly as @adasouls/protocol publishes them. */
export const atlasAbi = require("@adasouls/protocol/abis/AtlasRegistry.json") as Abi;
export const almaAbi = require("@adasouls/protocol/abis/AlmaAnchorRegistry.json") as Abi;

export interface Network {
  chainId: number;
  rpcUrl: string;
  /** ALMA Auth and the ALMA Resolver's API. */
  resolverUrl: string;
  explorerUrl?: string;
}

export const NETWORKS = {
  local: { chainId: 31337, rpcUrl: "http://127.0.0.1:8545", resolverUrl: "http://localhost:8787" },
  "base-sepolia": { chainId: 84532, rpcUrl: "https://sepolia.base.org", resolverUrl: "https://auth.adasouls.io", explorerUrl: "https://sepolia.basescan.org" },
  base: { chainId: 8453, rpcUrl: "https://mainnet.base.org", resolverUrl: "https://auth.adasouls.io", explorerUrl: "https://basescan.org" },
} as const satisfies Record<string, Network>;
export type NetworkName = keyof typeof NETWORKS;

export interface GlobalOptions {
  network: string;
  rpcUrl?: string;
  resolver?: string;
  atlas?: string;
  almaRegistry?: string;
  deployment?: string;
  json?: boolean;
}

export const PRIVATE_KEY_ENV = "FORK_KIT_PRIVATE_KEY";

interface Rails {
  atlasRegistry?: string;
  almaAnchorRegistry?: string;
}

/** A deployment file: the two addresses at the top level or under `protocol` (as a world's own deployment keeps them). */
function railsFrom(raw: unknown): Rails {
  const file = (raw ?? {}) as Rails & { protocol?: Rails };
  return { atlasRegistry: file.protocol?.atlasRegistry ?? file.atlasRegistry, almaAnchorRegistry: file.protocol?.almaAnchorRegistry ?? file.almaAnchorRegistry };
}

/** The rails published with @adasouls/protocol for a chain, when it has been deployed there. */
function publishedRails(chainId: number): Rails {
  try {
    return railsFrom(require(`@adasouls/protocol/deployments/${chainId}.json`));
  } catch {
    return {};
  }
}

function address(name: string, value: string | undefined, hint: string): Address {
  if (!value) throw new Error(`No ${name} address for this network. ${hint}`);
  if (!isAddress(value)) throw new Error(`${name}: "${value}" is not an address`);
  return getAddress(value);
}

/**
 * Where the command runs: the chain, the rails' addresses and, lazily, the signing key. Addresses come from the flag,
 * then the environment, then `--deployment <file>`, then the deployment published with @adasouls/protocol.
 */
export function createContext(options: GlobalOptions, env: NodeJS.ProcessEnv = process.env) {
  const preset: Network | undefined = (NETWORKS as Record<string, Network>)[options.network];
  if (!preset) throw new Error(`Unknown network "${options.network}": use ${Object.keys(NETWORKS).join(", ")}`);
  const network: Network = { ...preset, rpcUrl: options.rpcUrl ?? preset.rpcUrl, resolverUrl: (options.resolver ?? preset.resolverUrl).replace(/\/$/, "") };

  if (options.deployment && !existsSync(options.deployment)) throw new Error(`--deployment: ${options.deployment} does not exist`);
  const deployment = options.deployment ? (JSON.parse(readFileSync(options.deployment, "utf8")) as { world?: { address?: string } }) : undefined;
  const fromFile = railsFrom(deployment);
  const published = publishedRails(network.chainId);
  const hint = "Pass --deployment <file>, or the address itself";

  const chain = defineChain({
    id: network.chainId,
    name: options.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });

  const account = () => {
    const key = env[PRIVATE_KEY_ENV];
    if (!key) throw new Error(`Set ${PRIVATE_KEY_ENV} to the key that signs (it is never passed as a flag)`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${PRIVATE_KEY_ENV} must be a 32-byte hex private key`);
    return privateKeyToAccount(key as Hex);
  };

  return {
    network,
    json: options.json === true,
    publicClient,
    account,
    atlas: () => address("AtlasRegistry", options.atlas ?? env.FORK_KIT_ATLAS_ADDRESS ?? fromFile.atlasRegistry ?? published.atlasRegistry, `${hint} with --atlas.`),
    almaRegistry: () =>
      address("AlmaAnchorRegistry", options.almaRegistry ?? env.FORK_KIT_ALMA_REGISTRY_ADDRESS ?? fromFile.almaAnchorRegistry ?? published.almaAnchorRegistry, `${hint} with --alma-registry.`),
    /** The World contract a deployment file names, when it describes a world and not only the rails. */
    worldAddress: () => deployment?.world?.address,
    txUrl: (hash: Hex) => (network.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : undefined),

    /** Simulates the call (so a revert is reported with its reason before anything is sent), sends it and waits. */
    async send(contract: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
      const signer = account();
      const { request } = await publicClient.simulateContract({ address: contract, abi, functionName, args, account: signer });
      const hash = await createWalletClient({ account: signer, chain, transport: http(network.rpcUrl) }).writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
      return receipt;
    },
  };
}
export type Context = ReturnType<typeof createContext>;

/** The arguments of the one `eventName` log a transaction is expected to emit. */
export function eventArgs<T>(abi: Abi, logs: Log[], eventName: string): T {
  const [log] = parseEventLogs({ abi, logs, eventName }) as unknown as { args: T }[];
  if (!log) throw new Error(`The transaction did not emit ${eventName}`);
  return log.args;
}
