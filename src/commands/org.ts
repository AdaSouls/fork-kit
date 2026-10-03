import { writeFileSync } from "node:fs";
import { almaIdHash, assertAlmaId, buildCoreDoc, docHash } from "../alma.js";
import { almaAbi } from "../context.js";
import { txResult, type Register } from "./shared.js";

/**
 * `org anchor`: anchors an organization owned by the key's human soul, with the key as its controller. The document
 * whose hash is anchored is printed (and written with `--out`): publish it wherever the organization is resolved.
 */
export const registerOrg: Register = (program, run) => {
  program
    .command("org")
    .description("ALMA organizations")
    .command("anchor")
    .description("Anchor an organization owned by your human soul")
    .requiredOption("--id <almaId>", "alma:main:org:<slug>")
    .option("--out <file>", "write the anchored document to a file")
    .action(
      run<{ id: string; out?: string }>(async (ctx, options) => {
        const almaId = assertAlmaId(options.id, "org");
        const account = ctx.account();
        const doc = buildCoreDoc({
          id: almaId,
          type: "org",
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          chainId: ctx.network.chainId,
          controller: account.address,
        });
        const hash = docHash(doc);
        const receipt = await ctx.send(ctx.almaRegistry(), almaAbi, "anchorOrg", [almaId, hash]);
        if (options.out) writeFileSync(options.out, `${JSON.stringify(doc, null, 2)}\n`);
        return { almaId, almaIdHash: almaIdHash(almaId), controller: account.address, docHash: hash, doc, ...txResult(ctx, receipt.transactionHash) };
      }),
    );
};
