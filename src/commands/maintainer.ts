import { atlasAbi } from "../context.js";
import { bytes32, evmAddress, txResult, type Register } from "./shared.js";

/** `maintainer add|remove`: accounts (a CI key, for example) allowed to register versions of a world. */
export const registerMaintainer: Register = (program, run) => {
  const maintainer = program.command("maintainer").description("Who may register versions of a world");
  for (const [name, allowed, description] of [
    ["add", true, "Let an account register versions of a world"],
    ["remove", false, "Stop an account from registering versions of a world"],
  ] as const) {
    maintainer
      .command(name)
      .description(description)
      .requiredOption("--world <worldId>", "the world")
      .requiredOption("--address <address>", "the maintainer's account")
      .action(
        run<{ world: string; address: string }>(async (ctx, options) => {
          const worldId = bytes32("--world", options.world);
          const address = evmAddress("--address", options.address);
          const receipt = await ctx.send(ctx.atlas(), atlasAbi, "setMaintainer", [worldId, address, allowed]);
          return { worldId, maintainer: address, allowed, ...txResult(ctx, receipt.transactionHash) };
        }),
      );
  }
};
