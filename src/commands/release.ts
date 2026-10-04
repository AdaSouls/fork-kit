import { execFileSync } from "node:child_process";
import { packBuild } from "../ipfs.js";
import type { Register } from "./shared.js";
import { registerCandidate } from "./version.js";

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new Error(`Could not read the commit with git in ${cwd}: pass --git-commit`);
  }
}

/** The commit the build comes from: HEAD, and only when no tracked file differs from it. */
export function headCommit(cwd: string, allowDirty: boolean): string {
  const commit = git(cwd, "rev-parse", "HEAD");
  if (!allowDirty && git(cwd, "status", "--porcelain", "--untracked-files=no") !== "") {
    throw new Error("There are uncommitted changes, so the build would not match the commit it is registered with: commit them, or pass --allow-dirty");
  }
  return commit;
}

interface ReleaseOptions {
  world: string;
  dir: string;
  semver: string;
  worldAddress?: string;
  chainId?: string;
  engine: string;
  gitCommit?: string;
  parentVersion?: string;
  car?: string;
  allowDirty?: boolean;
  dryRun?: boolean;
}

/**
 * `release`: computes the CID of a client build and registers it as a candidate version of the world, built from the
 * current commit. `--car` also writes the build as a CAR file, to pin with any IPFS service; the CID is the same
 * wherever it is pinned.
 */
export const registerRelease: Register = (program, run) => {
  program
    .command("release")
    .description("Compute a client build's CID and register it as a candidate version")
    .requiredOption("--world <worldId>", "the world")
    .requiredOption("--dir <directory>", "the client build, for example packages/client/dist")
    .requiredOption("--semver <version>", "for example 0.2.0")
    .option("--world-address <address>", "the World contract (default: world.address in --deployment)")
    .option("--chain-id <id>", "chain the World contract is on (default: the network's)")
    .option("--engine <engine>", "for example mud@2.2.23", "")
    .option("--git-commit <sha>", "commit the build comes from (default: HEAD)")
    .option("--parent-version <versionId>", "the version this one derives from")
    .option("--car <file>", "also write the build as a CAR file")
    .option("--allow-dirty", "release with uncommitted changes")
    .option("--dry-run", "compute the CID without registering anything")
    .action(
      run<ReleaseOptions>(async (ctx, options) => {
        const worldAddress = options.worldAddress ?? ctx.worldAddress();
        if (!worldAddress) throw new Error("No World address: pass --world-address, or a --deployment file with world.address");
        const gitCommit = options.gitCommit ?? headCommit(process.cwd(), options.allowDirty === true);
        const build = await packBuild(options.dir, options.car);
        const packed = { files: build.files, bytes: build.bytes, car: options.car };
        if (options.dryRun) return { clientCid: build.cid, gitCommit, ...packed };

        const registered = await registerCandidate(ctx, {
          world: options.world,
          chainId: options.chainId ?? String(ctx.network.chainId),
          worldAddress,
          gitCommit,
          semver: options.semver,
          clientCid: build.cid,
          engine: options.engine,
          parentVersion: options.parentVersion,
        });
        return { ...registered, ...packed };
      }),
    );
};
