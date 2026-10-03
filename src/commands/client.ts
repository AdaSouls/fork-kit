import type { Hex } from "viem";
import { toAlmaIdHash } from "../alma.js";
import { atlasAbi, eventArgs } from "../context.js";
import { bytes32, enumIndex, txResult, type Register } from "./shared.js";

export const CLIENT_KIND = ["web", "mobile", "desktop", "agent"] as const;

/** `client register`: where a version is served (an https URL), by the soul or organization that operates it. */
export const registerClient: Register = (program, run) => {
  program
    .command("client")
    .description("Clients that serve a version")
    .command("register")
    .description("Register a client of a version, operated by a soul or organization you control")
    .requiredOption("--version <versionId>", "the version it serves")
    .requiredOption("--url <url>", "https URL of the client")
    .requiredOption("--operator <almaId>", "who operates it (ALMA id or its hash)")
    .option("--kind <kind>", CLIENT_KIND.join(" | "), "web")
    .action(
      run<{ version: string; url: string; operator: string; kind: string }>(async (ctx, options) => {
        if (!options.url.startsWith("https://")) throw new Error(`--url: "${options.url}" must be an https URL`);
        const args = [bytes32("--version", options.version), options.url, enumIndex("--kind", CLIENT_KIND, options.kind), toAlmaIdHash(options.operator)];
        const receipt = await ctx.send(ctx.atlas(), atlasAbi, "registerClient", args);
        const { clientId } = eventArgs<{ clientId: Hex }>(atlasAbi, receipt.logs, "ClientRegistered");
        return { clientId, versionId: args[0], url: options.url, kind: options.kind, ...txResult(ctx, receipt.transactionHash) };
      }),
    );
};
