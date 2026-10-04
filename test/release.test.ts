import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { headCommit } from "../src/commands/release.js";
import { packBuild } from "../src/ipfs.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fork-kit-"));
});

function build(files: Record<string, string>) {
  const root = mkdtempSync(join(dir, "build-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("packBuild", () => {
  const files = { "index.html": "<h1>ALDEA</h1>", "assets/app.js": "console.log(1)", ".well-known/world.json": "{}" };

  it("gives the same CID for the same files, wherever they are", async () => {
    const first = await packBuild(build(files));
    const second = await packBuild(build(Object.fromEntries(Object.entries(files).reverse())));
    expect(first).toEqual({ cid: expect.stringMatching(/^bafy[a-z2-7]{55}$/), files: 3, bytes: 30 });
    expect(second.cid).toBe(first.cid);
  });

  it("changes the CID when a file changes, a dot-file included", async () => {
    const { cid } = await packBuild(build(files));
    expect((await packBuild(build({ ...files, "index.html": "<h1>aldea</h1>" }))).cid).not.toBe(cid);
    expect((await packBuild(build({ ...files, ".well-known/world.json": "{ }" }))).cid).not.toBe(cid);
  });

  it("writes a CAR whose header names the root", async () => {
    const car = join(dir, "build.car");
    const { cid } = await packBuild(build(files), car);
    // CARv1: a varint length, then the dag-cbor header { roots: [CID], version: 1 }; the CID's bytes follow a 0x00 prefix
    const bytes = readFileSync(car);
    const { CID } = await import("multiformats/cid");
    const root = CID.parse(cid).bytes;
    expect(bytes.subarray(0, 100).includes(Buffer.from(root))).toBe(true);
  });

  it("refuses what is not a build", async () => {
    await expect(packBuild(join(dir, "missing"))).rejects.toThrow(/not a directory/);
    await expect(packBuild(build({}))).rejects.toThrow(/has no files/);
  });
});

describe("headCommit", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" }).trim();

  it("is HEAD, unless a tracked file has uncommitted changes", () => {
    git(dir, "init", "-q");
    writeFileSync(join(dir, "a.txt"), "1");
    git(dir, "add", "a.txt");
    git(dir, "commit", "-q", "-m", "first");
    const head = git(dir, "rev-parse", "HEAD");

    writeFileSync(join(dir, "untracked.log"), "noise");
    expect(headCommit(dir, false)).toBe(head);

    writeFileSync(join(dir, "a.txt"), "2");
    expect(() => headCommit(dir, false)).toThrow(/uncommitted changes/);
    expect(headCommit(dir, true)).toBe(head);
  });

  it("asks for --git-commit outside a repository", () => {
    expect(() => headCommit(join(dir, "nowhere"), false)).toThrow(/--git-commit/);
  });
});
