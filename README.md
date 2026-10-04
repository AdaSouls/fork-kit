# fork-kit

A command-line tool to put a world on the AdaSouls rails: give its owner a soul, anchor its organization in ALMA,
register the world in the Atlas (on its own or as a fork of another world), and publish its versions and clients.

The rails are the contracts in [`@adasouls/protocol`](https://github.com/AdaSouls/protocol): `AlmaAnchorRegistry`
(identities) and `AtlasRegistry` (worlds, versions, clients). Any world can use them;
[ALDEA World](https://github.com/ALDEA-DAO/aldea-world) is the first.

## Install

Requires Node 22.

```bash
pnpm add -D @adasouls/fork-kit      # or: npx @adasouls/fork-kit --help
```

## Registering a fork, start to finish

The key that signs is read from `FORK_KIT_PRIVATE_KEY`, never from a flag.

```bash
export FORK_KIT_PRIVATE_KEY=0x…

# 1. Your human soul: signs in with ALMA using the key and anchors the soul it gets
fork-kit soul create

# 2. The organization that will own the world (owned by your soul, controlled by the key)
fork-kit org anchor --id alma:main:org:nocturna --out nocturna.alma.json

# 3. The world, as a fork of another one
fork-kit world register --name "ALDEA Nocturna" --org alma:main:org:nocturna \
  --parent <worldId> --visibility public --metadata ipfs://…

# 4. A version: the World contract it runs on and the CID of its client build
fork-kit version register --world <worldId> --chain-id 84532 --world-address 0x… \
  --git-commit <full sha> --engine mud@2.2.23 --semver 0.1.0 --client-cid bafy…

# 5. Where that version is served
fork-kit client register --version <versionId> --url https://nocturna.example \
  --kind web --operator alma:main:org:nocturna

# Optional: let a CI key register versions
fork-kit maintainer add --world <worldId> --address 0x…
```

Each command prints the ids it created, the transaction hash and, on public networks, its explorer link. With
`--json` it prints one JSON object instead (`{ "error": "…" }` and exit code 1 on failure), for use in CI:

```bash
WORLD_ID=$(fork-kit --json world register --name "ALDEA Nocturna" --org alma:main:org:nocturna | jq -r .worldId)
```

## Releasing a build

`release` does step 4 for you from a build directory: it computes the build's IPFS CID and registers it as a candidate
version built from the current commit.

```bash
fork-kit release --world <worldId> --dir packages/client/dist --semver 0.2.0 \
  --world-address 0x… --engine mud@2.2.23 --car client.car
```

- The CID is the root of the directory packed as UnixFS (the same one `ipfs-car pack <dir> --hidden` gives), so it
  depends only on the files: anyone can rebuild the commit and compare.
- `--car <file>` also writes the build as a CAR file. Pin that file with any IPFS service to make the build reachable
  by its CID; `release` itself does not upload anything yet.
- The commit is `HEAD` (or `--git-commit`). With uncommitted changes to tracked files it stops, because the build
  would not match the commit it is registered with; `--allow-dirty` overrides.
- `--dry-run` prints the CID without registering anything. `--chain-id` defaults to the network's, and
  `--world-address` to `world.address` in the `--deployment` file.

## Publishing the official version

`publish` prepares the directory a world's site serves, and refuses to prepare anything the world did not make
official:

```bash
fork-kit publish --world <worldId> --car client.car --out site \
  --operator alma:main:org:nocturna --presence-url https://nocturna.example/presence \
  --if-changed https://nocturna.example
```

1. It reads the world's official version from the Atlas.
2. It takes that build's CAR (`--car`: a file, or an http(s) URL such as an IPFS gateway's `?format=car`), checks every
   block against its hash, unpacks it and recomputes the CID from the files. If that is not the CID the Atlas holds,
   it stops and `--out` is left as it was.
3. It writes `/version.json` (what the client claims to be: version id, CID, commit, semver) and, with `--operator`
   and `--presence-url`, the client manifest at `/.well-known/alma-world.json`. Both name the build's own CID, so they
   are added here and are not among the files the CID covers.

`--if-changed <site>` makes it a no-op (`changed: false`) when that site already serves the official version, which
is what a scheduled job wants. Deploying `--out` to a host is up to you.

A world's Portal reads other worlds' manifest and presence from the browser, so serve both with
`Access-Control-Allow-Origin: *`.

A version starts as a candidate. Making it the official one is up to the world's governor
(`AtlasRegistry.setOfficialVersion`), which for a governed world is a multisig or a council, not this tool.

## Networks and addresses

| `--network` | Chain | ALMA Auth / Resolver |
|---|---|---|
| `local` (default) | anvil, 31337, `http://127.0.0.1:8545` | `http://localhost:8787` |
| `base-sepolia` | 84532 | `https://auth.adasouls.io` |
| `base` | 8453 | `https://auth.adasouls.io` |

`--rpc-url` and `--resolver` override the endpoints. The rails' addresses are taken, in this order, from `--atlas` /
`--alma-registry`, from `FORK_KIT_ATLAS_ADDRESS` / `FORK_KIT_ALMA_REGISTRY_ADDRESS`, from `--deployment <file>` (a JSON
file with `atlasRegistry` and `almaAnchorRegistry`, at the top level or under `protocol`), and from the deployment
published with `@adasouls/protocol` for that chain.

Against a local ALDEA World stack (`pnpm dev` in aldea-world):

```bash
fork-kit --deployment ../aldea-world/packages/shared/src/deployments/31337.json soul create
```

## How `soul create` signs in

It runs the same OpenID Connect flow a world's page runs against ALMA Auth (authorization code with PKCE), answering
the wallet method with a Sign-In with Ethereum signature from the key. ALMA Auth must know the client it signs in as:
`--client-id` (default `fork-kit`) with the redirect URI `--redirect-uri` (default
`http://127.0.0.1/fork-kit/callback`, which is never opened).

The soul is anchored by the key itself, so the key must be the soul's controller. A Resolver that gives every new soul
a custodial smart account as controller will refuse; anchoring then has to happen from that account.

## Development

```bash
pnpm install
pnpm dev -- --help     # run from source
pnpm test
pnpm typecheck && pnpm build
```

## License

[MIT](LICENSE)
