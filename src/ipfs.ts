import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CarIndexedReader } from "@ipld/car/indexed-reader";
import { validateBlock } from "@web3-storage/car-block-validator";
import { filesFromPaths } from "files-from-path";
import { CAREncoderStream, createDirectoryEncoderStream } from "ipfs-car";
import { recursive as exporter } from "ipfs-unixfs-exporter";

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

/**
 * Unpacks a CAR file into `dir` and returns the root its header names. Every block is checked against its own hash as
 * it is read; whether the result is the build someone expects is the caller's question (`packBuild(dir)` answers it).
 */
export async function unpackBuild(carPath: string, dir: string): Promise<string> {
  const reader = await CarIndexedReader.fromFile(carPath);
  try {
    const [root] = await reader.getRoots();
    if (!root) throw new Error(`${carPath} names no root`);
    const blockstore = {
      async get(cid: Parameters<typeof reader.get>[0]) {
        const block = await reader.get(cid);
        if (!block) throw new Error(`${carPath} is missing the block ${cid}`);
        await validateBlock(block as never);
        return block.bytes;
      },
    };
    for await (const entry of exporter(root as never, blockstore as never)) {
      // The first path segment is the root CID: the build's files go straight into `dir`
      const path = join(dir, ...entry.path.split("/").slice(1));
      if (entry.type === "directory") mkdirSync(path, { recursive: true });
      else if (entry.type === "file" || entry.type === "raw") {
        mkdirSync(dirname(path), { recursive: true });
        await pipeline(entry.content(), createWriteStream(path));
      } else throw new Error(`${carPath}: unsupported entry ${entry.path} (${entry.type})`);
    }
    return root.toString();
  } finally {
    await reader.close();
  }
}
