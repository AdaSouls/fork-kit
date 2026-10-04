import { createWriteStream, existsSync, statSync } from "node:fs";
import { Writable } from "node:stream";
import { filesFromPaths } from "files-from-path";
import { CAREncoderStream, createDirectoryEncoderStream } from "ipfs-car";

/**
 * A client build as IPFS sees it: the directory packed as UnixFS, whose root CID (CIDv1) names exactly these files.
 * The CID depends only on the files' paths and contents, so anyone can rebuild and compare.
 */

export interface PackedBuild {
  /** Root CID of the directory. */
  cid: string;
  files: number;
  bytes: number;
}

async function encode(dir: string, out: WritableStream<Uint8Array>, roots: unknown[]) {
  // Dot-files are part of a build (/.well-known); a fixed order keeps the CAR itself reproducible too
  const files = (await filesFromPaths([dir], { hidden: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!files.length) throw new Error(`${dir} has no files`);
  const car = new CAREncoderStream(roots as never);
  await createDirectoryEncoderStream(files).pipeThrough(car).pipeTo(out);
  if (!car.finalBlock) throw new Error(`${dir} produced no blocks`);
  return { root: car.finalBlock.cid, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

/**
 * Computes the build's root CID and, with `carPath`, writes it as a CAR file with that root in its header: the file
 * any pinning service takes.
 */
export async function packBuild(dir: string, carPath?: string): Promise<PackedBuild> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  // The root is only known once every block exists: a first pass finds it, the second writes the CAR that names it
  const { root, files, bytes } = await encode(dir, new WritableStream(), []);
  const cid = root.toString();
  if (carPath) {
    const written = await encode(dir, Writable.toWeb(createWriteStream(carPath)) as WritableStream<Uint8Array>, [root]);
    if (written.root.toString() !== cid) throw new Error(`${dir} changed while it was being packed`);
  }
  return { cid, files, bytes };
}
