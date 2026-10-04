import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Hex } from "viem";
import { assertAlmaId } from "../alma.js";
import { atlasAbi } from "../context.js";
import { packBuild, unpackBuild } from "../ipfs.js";
import { bytes32, ZERO_32, type Register } from "./shared.js";

/** What a published client says it is, at `/version.json`. */
export interface VersionJson {
  versionId: string;
  clientCid: string;
  gitCommit: string;
  semver: string;
}

export const VERSION_PATH = "version.json";
export const MANIFEST_PATH = ".well-known/alma-world.json";

interface OfficialVersion {
  worldId: Hex;
  status: number;
  gitCommit: Hex;
  semver: string;
  clientCid: string;
}

/** The `versionId` a site already serves, if it serves a readable `/version.json`. */
async function servedVersionId(site: string): Promise<string | undefined> {
  try {
    const res = await fetch(new URL(VERSION_PATH, site.endsWith("/") ? site : `${site}/`), { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as Partial<VersionJson>;
    return res.ok && typeof body.versionId === "string" ? body.versionId.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** A CAR from a local file, or downloaded from an http(s) URL into `into`. */
async function carFile(source: string, into: string): Promise<string> {
  if (!/^https?:\/\//.test(source)) {
    if (!existsSync(source)) throw new Error(`--car: ${source} does not exist`);
    return source;
  }
  const res = await fetch(source);
  if (!res.ok || !res.body) throw new Error(`--car: ${source} answered ${res.status}`);
  const path = join(into, "build.car");
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(path));
  return path;
}

interface PublishOptions {
  world: string;
  car: string;
  out: string;
  ifChanged?: string;
  name?: string;
  operator?: string;
  presenceUrl?: string;
  locale: string;
}

/**
 * `publish`: prepares the directory a world's site serves. It reads the world's official version from the Atlas, takes
 * that build's CAR, and only if the files in it add up to the CID the Atlas holds does it write them to `--out`, with
 * `/version.json` (and the client manifest) next to them. Those two files name the build's own CID, so they are added
 * here and are not part of what the CID covers. Anything that does not match stops the command and leaves `--out`
 * untouched: a site never serves what its world did not make official.
 */
export const registerPublish: Register = (program, run) => {
  program
    .command("publish")
    .description("Verify a world's official build against the Atlas and prepare the directory its site serves")
    .requiredOption("--world <worldId>", "the world")
    .requiredOption("--car <file or url>", "the official build as a CAR file")
    .requiredOption("--out <directory>", "where to write the site (replaced)")
    .option("--if-changed <site url>", "do nothing when that site already serves the official version")
    .option("--name <name>", "manifest: the world's name (default: its name in the Atlas)")
    .option("--operator <almaId>", "manifest: who operates this client (with --presence-url, writes the manifest)")
    .option("--presence-url <url>", "manifest: where this client reports who is online")
    .option("--locale <list>", "manifest: languages, comma-separated", "es,en")
    .action(
      run<PublishOptions>(async (ctx, options) => {
        const worldId = bytes32("--world", options.world);
        if ((options.operator === undefined) !== (options.presenceUrl === undefined)) throw new Error("The manifest needs both --operator and --presence-url");
        if (options.operator) assertAlmaId(options.operator);
        if (options.presenceUrl) new URL(options.presenceUrl);

        const atlas = { address: ctx.atlas(), abi: atlasAbi } as const;
        const [versionId, version] = (await ctx.publicClient.readContract({ ...atlas, functionName: "officialVersionOf", args: [worldId] })) as [Hex, OfficialVersion];
        if (versionId === ZERO_32) throw new Error(`The world ${worldId} has no official version`);
        const claim: VersionJson = { versionId, clientCid: version.clientCid, gitCommit: version.gitCommit.replace(/^0x/, ""), semver: version.semver };

        if (options.ifChanged && (await servedVersionId(options.ifChanged)) === versionId.toLowerCase()) return { changed: false, ...claim };

        const out = resolve(options.out);
        // Built next to --out, so the final rename stays on one filesystem and is all-or-nothing
        mkdirSync(dirname(out), { recursive: true });
        const work = mkdtempSync(join(dirname(out), ".fork-kit-publish-"));
        const downloads = mkdtempSync(join(tmpdir(), "fork-kit-car-"));
        try {
          const site = join(work, "site");
          mkdirSync(site);
          const root = await unpackBuild(await carFile(options.car, downloads), site);
          const { cid, files, bytes } = await packBuild(site);
          if (root !== version.clientCid || cid !== version.clientCid) {
            throw new Error(`The build does not match the official version: the Atlas holds ${version.clientCid}, the CAR names ${root} and its files add up to ${cid}. Nothing was written.`);
          }

          writeFileSync(join(site, VERSION_PATH), `${JSON.stringify(claim, null, 2)}\n`);
          let manifest: string | undefined;
          if (options.operator && options.presenceUrl) {
            const world = (await ctx.publicClient.readContract({ ...atlas, functionName: "getWorld", args: [worldId] })) as { name: string };
            manifest = join(site, MANIFEST_PATH);
            mkdirSync(dirname(manifest), { recursive: true });
            const body = {
              schema: "alma-world-client/v1",
              worldId,
              versionId: claim.versionId,
              name: options.name ?? world.name,
              operator: options.operator,
              clientCid: claim.clientCid,
              gitCommit: claim.gitCommit,
              presenceUrl: options.presenceUrl,
              locale: options.locale.split(",").map((l) => l.trim()),
            };
            writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);
          }

          if (existsSync(out) && readdirSync(out).length > 0) rmSync(out, { recursive: true });
          else rmSync(out, { recursive: true, force: true });
          renameSync(site, out);
          return { changed: true, ...claim, out, files, bytes, manifest: manifest ? join(out, MANIFEST_PATH) : undefined };
        } finally {
          rmSync(work, { recursive: true, force: true });
          rmSync(downloads, { recursive: true, force: true });
        }
      }),
    );
};
