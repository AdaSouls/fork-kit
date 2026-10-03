import type { Hex } from "viem";
import { toAlmaIdHash } from "../alma.js";
import { atlasAbi, eventArgs } from "../context.js";
import { bytes32, enumIndex, evmAddress, txResult, ZERO_32, ZERO_ADDRESS, type Register } from "./shared.js";

export const VISIBILITY = ["public", "unlisted", "private"] as const;

/** `world register`: a world in the Atlas, owned by an organization the key controls; `--parent` makes it a fork. */
export const registerWorld: Register = (program, run) => {
  program
    .command("world")
    .description("Worlds in the Atlas")
    .command("register")
    .description("Register a world owned by an organization you control")
    .requiredOption("--name <name>", "the world's name (1 to 64 bytes)")
    .requiredOption("--org <almaId>", "the organization that owns it (ALMA id or its hash)")
    .option("--parent <worldId>", "the world this one is a fork of")
    .option("--visibility <visibility>", VISIBILITY.join(" | "), "public")
    .option("--metadata <uri>", "metadata URI, for example ipfs://…", "")
    .option("--governor <address>", "who sets the official version (default: the key)")
    .action(
      run<{ name: string; org: string; parent?: string; visibility: string; metadata: string; governor?: string }>(async (ctx, options) => {
        const args = [
          options.name,
          toAlmaIdHash(options.org),
          options.parent ? bytes32("--parent", options.parent) : ZERO_32,
          enumIndex("--visibility", VISIBILITY, options.visibility),
          options.metadata,
          options.governor ? evmAddress("--governor", options.governor) : ZERO_ADDRESS,
        ];
        const receipt = await ctx.send(ctx.atlas(), atlasAbi, "registerWorld", args);
        const { worldId, governor } = eventArgs<{ worldId: Hex; governor: string }>(atlasAbi, receipt.logs, "WorldRegistered");
        return { worldId, name: options.name, governor, ...txResult(ctx, receipt.transactionHash) };
      }),
    );
};
