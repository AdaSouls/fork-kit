import { isHex, type Hex } from "viem";
import { atlasAbi, eventArgs } from "../context.js";
import { bytes32, evmAddress, txResult, ZERO_32, type Register } from "./shared.js";

/** A full 40-character commit hash, as the 20 bytes the Atlas stores. */
export function gitCommit(value: string): Hex {
  const hex = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(hex) || hex.length !== 42) throw new Error(`--git-commit: "${value}" is not a full commit hash (40 hex characters)`);
  return hex.toLowerCase() as Hex;
}

function positiveInteger(name: string, value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name}: "${value}" is not a positive integer`);
  return BigInt(value);
}

/**
 * `version register`: a candidate version of a world (the World contract it runs on and its client's CID), by the
 * world's organization or one of its maintainers. The world's governor decides which candidate becomes official.
 */
export const registerVersion: Register = (program, run) => {
  program
    .command("version")
    .description("Versions of a world")
    .command("register")
    .description("Register a candidate version of a world")
    .requiredOption("--world <worldId>", "the world")
    .requiredOption("--chain-id <id>", "chain the World contract is on")
    .requiredOption("--world-address <address>", "the World contract")
    .requiredOption("--git-commit <sha>", "full commit hash the client was built from")
    .requiredOption("--semver <version>", "for example 0.1.0")
    .requiredOption("--client-cid <cid>", "CID of the client build")
    .option("--engine <engine>", "for example mud@2.2.23", "")
    .option("--parent-version <versionId>", "the version this one derives from")
    .action(
      run<{ world: string; chainId: string; worldAddress: string; gitCommit: string; semver: string; clientCid: string; engine: string; parentVersion?: string }>(
        async (ctx, options) => {
          const version = {
            parentVersionId: options.parentVersion ? bytes32("--parent-version", options.parentVersion) : ZERO_32,
            chainId: positiveInteger("--chain-id", options.chainId),
            worldAddress: evmAddress("--world-address", options.worldAddress),
            gitCommit: gitCommit(options.gitCommit),
            engine: options.engine,
            semver: options.semver,
            clientCid: options.clientCid,
          };
          const worldId = bytes32("--world", options.world);
          const receipt = await ctx.send(ctx.atlas(), atlasAbi, "registerVersion", [worldId, version]);
          const { versionId } = eventArgs<{ versionId: Hex }>(atlasAbi, receipt.logs, "VersionRegistered");
          return { versionId, worldId, semver: options.semver, clientCid: options.clientCid, status: "candidate", ...txResult(ctx, receipt.transactionHash) };
        },
      ),
    );
};
