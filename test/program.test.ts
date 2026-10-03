import { describe, expect, it } from "vitest";
import { gitCommit } from "../src/commands/version.js";
import { createContext } from "../src/context.js";
import { printResult } from "../src/output.js";
import { createProgram } from "../src/program.js";

const ATLAS = "0xD56e6F296352B03C3c3386543185E9B8c2e5Fd0b";
const WORLD = `0x${"ab".repeat(32)}`;

/** Runs the CLI with the given arguments and collects what it prints. */
async function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;
  const program = createProgram({ out: (line) => out.push(line), err: (line) => err.push(line), exit: (c) => (code = c), env });
  program.exitOverride();
  await program.parseAsync(args, { from: "user" }).catch(() => (code ||= 1));
  return { out, err, code };
}

describe("input errors are reported before anything is sent", () => {
  it("names the bad value", async () => {
    const base = ["--atlas", ATLAS];
    expect((await cli([...base, "world", "register", "--name", "X", "--org", "nocturna"])).err).toEqual([expect.stringContaining("is not an ALMA identifier")]);
    expect((await cli([...base, "world", "register", "--name", "X", "--org", "alma:main:org:x", "--visibility", "hidden"])).err).toEqual([expect.stringContaining("public, unlisted, private")]);
    expect((await cli([...base, "maintainer", "add", "--world", "0x12", "--address", ATLAS])).err).toEqual([expect.stringContaining("32-byte hex id")]);
    expect((await cli([...base, "client", "register", "--version", WORLD, "--url", "http://x.example", "--operator", "alma:main:org:x"])).err).toEqual([expect.stringContaining("https URL")]);
  });

  it("asks for the key in the environment, and for the rails' addresses", async () => {
    const noKey = await cli(["--atlas", ATLAS, "maintainer", "add", "--world", WORLD, "--address", ATLAS]);
    expect(noKey).toMatchObject({ code: 1, err: [expect.stringContaining("FORK_KIT_PRIVATE_KEY")] });
    const noAtlas = await cli(["maintainer", "add", "--world", WORLD, "--address", ATLAS], { FORK_KIT_PRIVATE_KEY: `0x${"11".repeat(32)}` });
    expect(noAtlas.err).toEqual([expect.stringContaining("No AtlasRegistry address")]);
  });

  it("prints errors as JSON with --json", async () => {
    const { out, code } = await cli(["--json", "--network", "moon", "world", "register", "--name", "X", "--org", "alma:main:org:x"]);
    expect(code).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual({ error: expect.stringContaining('Unknown network "moon"') });
  });
});

describe("context", () => {
  it("takes addresses from the flag, then the environment", () => {
    expect(createContext({ network: "local", atlas: ATLAS.toLowerCase() }, {}).atlas()).toBe(ATLAS);
    expect(createContext({ network: "local" }, { FORK_KIT_ATLAS_ADDRESS: ATLAS }).atlas()).toBe(ATLAS);
    expect(() => createContext({ network: "local", atlas: "0x12" }, {}).atlas()).toThrow(/not an address/);
  });

  it("links transactions only where there is an explorer", () => {
    expect(createContext({ network: "local" }, {}).txUrl("0xabc")).toBeUndefined();
    expect(createContext({ network: "base-sepolia" }, {}).txUrl("0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
  });
});

describe("output", () => {
  it("aligns keys and leaves out what is not there", () => {
    const lines: string[] = [];
    printResult({ worldId: "0x1", tx: "0x2", explorer: undefined }, false, (line) => lines.push(line));
    expect(lines).toEqual(["worldId  0x1", "tx       0x2"]);
  });

  it("accepts a commit hash with or without 0x, and only a full one", () => {
    expect(gitCommit("1234567890ABCDEF1234567890abcdef12345678")).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(() => gitCommit("1234567")).toThrow(/full commit hash/);
  });
});
