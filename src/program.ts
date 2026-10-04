import { Command } from "commander";
import { registerClient } from "./commands/client.js";
import { registerMaintainer } from "./commands/maintainer.js";
import { registerOrg } from "./commands/org.js";
import { registerPublish } from "./commands/publish.js";
import { registerRelease } from "./commands/release.js";
import type { Register } from "./commands/shared.js";
import { registerSoul } from "./commands/soul.js";
import { registerVersion } from "./commands/version.js";
import { registerWorld } from "./commands/world.js";
import { createContext, NETWORKS, PRIVATE_KEY_ENV, type Context, type GlobalOptions } from "./context.js";
import { errorMessage, printResult, type Result } from "./output.js";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Called with 1 when a command fails. */
  exit: (code: number) => void;
  env: NodeJS.ProcessEnv;
}

/**
 * The `fork-kit` program. Every command prints the ids it created, the transaction hash and its explorer link; with
 * `--json`, one JSON object on stdout (and `{ "error": … }` on failure) for use in CI.
 */
export function createProgram(io: Io): Command {
  const program = new Command("fork-kit")
    .description("Register a soul, an organization, a world, its versions and its clients on the AdaSouls rails")
    .option("--network <name>", Object.keys(NETWORKS).join(" | "), "local")
    .option("--rpc-url <url>", "RPC endpoint (default: the network's public one)")
    .option("--resolver <url>", "ALMA Auth and Resolver (default: the network's)")
    .option("--atlas <address>", "AtlasRegistry address")
    .option("--alma-registry <address>", "AlmaAnchorRegistry address")
    .option("--deployment <file>", "JSON file with the rails' addresses (atlasRegistry, almaAnchorRegistry)")
    .option("--json", "print JSON")
    .addHelpText("after", `\nThe signing key is read from ${PRIVATE_KEY_ENV}.`)
    .configureOutput({ writeOut: (text) => io.out(text.trimEnd()), writeErr: (text) => io.err(text.trimEnd()) });

  const run =
    <Options>(action: (ctx: Context, options: Options) => Promise<Result>) =>
    async (options: Options) => {
      const global = program.opts<GlobalOptions>();
      try {
        printResult(await action(createContext(global, io.env), options), global.json === true, io.out);
      } catch (err) {
        if (global.json) io.out(JSON.stringify({ error: errorMessage(err) }));
        else io.err(`error: ${errorMessage(err)}`);
        io.exit(1);
      }
    };

  for (const register of [registerSoul, registerOrg, registerWorld, registerVersion, registerClient, registerMaintainer, registerRelease, registerPublish] satisfies Register[]) register(program, run);
  return program;
}
