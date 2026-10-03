import { getAddress, type Hex } from "viem";
import { almaIdHash, controllerOf, docHash, type AlmaCoreDoc } from "../alma.js";
import { DEFAULT_CLIENT_ID, DEFAULT_REDIRECT_URI, resolverPost, signInWithAlma } from "../auth.js";
import { almaAbi } from "../context.js";
import { txResult, type Register } from "./shared.js";

interface Prepared {
  almaId: string;
  doc: AlmaCoreDoc;
  docHash: Hex;
}

/**
 * `soul create`: the key signs in with ALMA (its soul is created on the first sign-in), asks the Resolver for the
 * soul's anchoring material with the key itself as controller, and anchors it. An organization needs its owner to
 * have a human soul, so this is the first step of registering a world.
 */
export const registerSoul: Register = (program, run) => {
  program
    .command("soul")
    .description("Your human soul")
    .command("create")
    .description("Sign in with ALMA using the key, then anchor its human soul")
    .option("--client-id <id>", "ALMA Auth client the CLI signs in as", DEFAULT_CLIENT_ID)
    .option("--redirect-uri <uri>", "that client's registered redirect URI", DEFAULT_REDIRECT_URI)
    .action(
      run<{ clientId: string; redirectUri: string }>(async (ctx, options) => {
        const account = ctx.account();
        const registry = ctx.almaRegistry();
        const issuer = ctx.network.resolverUrl;
        const { accessToken, almaId } = await signInWithAlma({ issuer, clientId: options.clientId, redirectUri: options.redirectUri }, account);

        const existing = (await ctx.publicClient.readContract({ address: registry, abi: almaAbi, functionName: "humanOf", args: [account.address] })) as Hex;
        if (existing === almaIdHash(almaId)) return { almaId, almaIdHash: existing, controller: account.address, anchored: "already" };

        const prepared = await resolverPost<Prepared>(issuer, accessToken, "/v1/souls/prepare", { controller: account.address });
        if (prepared.status !== 200) throw new Error(`The Resolver could not prepare ${almaId} (${prepared.status}): ${prepared.body.title ?? prepared.body.code ?? "unknown error"}`);
        const { doc } = prepared.body;
        const controller = controllerOf(doc);
        // The registry makes the sender the controller, so the document it hashes must name this key
        if (!controller || controller !== getAddress(account.address)) {
          throw new Error(`${almaId} is controlled by ${controller ?? "another account"}, not by this key (${account.address}): it has to be anchored from that account`);
        }
        if (docHash(doc) !== prepared.body.docHash) throw new Error("The Resolver's document does not match its hash");

        const receipt = await ctx.send(registry, almaAbi, "anchorHuman", [almaId, prepared.body.docHash]);
        return { almaId, almaIdHash: almaIdHash(almaId), controller: account.address, docHash: prepared.body.docHash, ...txResult(ctx, receipt.transactionHash) };
      }),
    );
};
