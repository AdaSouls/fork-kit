import canonicalizeJson from "canonicalize";
import { getAddress, isHex, keccak256, toBytes, type Address, type Hex } from "viem";

// canonicalize is CommonJS: under NodeNext its default import is typed as the module, not the function
const canonicalize = canonicalizeJson as unknown as (input: unknown) => string | undefined;

/**
 * ALMA identifiers and core documents, as AlmaAnchorRegistry anchors them: `alma:main:<human|org|agent>:<local id>`
 * with 1–64 characters of `[a-z0-9-]`, keyed on-chain by keccak256 of the identifier, with the document's hash
 * (keccak256 of its RFC 8785 serialization) stored next to it.
 */

export type AlmaSubjectType = "human" | "org" | "agent";

export const ALMA_CONTEXT = "https://alma.adasouls.io/ns/v1";
const ALMA_ID_RE = /^alma:main:(human|org|agent):[a-z0-9-]{1,64}$/;

export interface AlmaCoreDoc {
  "@context": typeof ALMA_CONTEXT;
  id: string;
  type: AlmaSubjectType;
  /** ISO 8601 UTC, to the second. */
  createdAt: string;
  controllers: { id: string; kind: "evm"; primary: boolean }[];
}

export function assertAlmaId(id: string, type?: AlmaSubjectType): string {
  const match = ALMA_ID_RE.exec(id);
  if (!match || (type !== undefined && match[1] !== type)) {
    throw new Error(`"${id}" is not an ALMA identifier: expected alma:main:${type ?? "<human|org|agent>"}:<1 to 64 of a-z, 0-9 and ->`);
  }
  return id;
}

/** keccak256(utf8(almaId)), the on-chain key of a subject. */
export const almaIdHash = (almaId: string): Hex => keccak256(toBytes(almaId));

/** An ALMA identifier or its 32-byte hash, as the hash. */
export function toAlmaIdHash(value: string): Hex {
  if (isHex(value) && value.length === 66) return value.toLowerCase() as Hex;
  return almaIdHash(assertAlmaId(value));
}

/** The core document of a subject whose only controller is an EVM account on `chainId`. */
export function buildCoreDoc(params: { id: string; type: AlmaSubjectType; createdAt: string; chainId: number; controller: Address }): AlmaCoreDoc {
  return {
    "@context": ALMA_CONTEXT,
    id: params.id,
    type: params.type,
    createdAt: params.createdAt,
    controllers: [{ id: `did:pkh:eip155:${params.chainId}:${getAddress(params.controller)}`, kind: "evm", primary: true }],
  };
}

/** keccak256(utf8(JCS(core))), the docHash anchored on-chain. */
export function docHash(doc: AlmaCoreDoc): Hex {
  const json = canonicalize(doc);
  if (json === undefined) throw new Error("The document cannot be canonicalized");
  return keccak256(toBytes(json));
}

/** The EVM address a core document names as its primary controller. */
export function controllerOf(doc: AlmaCoreDoc): Address | undefined {
  const id = doc.controllers.find((c) => c.primary && c.kind === "evm")?.id;
  const address = id?.split(":").at(-1);
  return address ? getAddress(address) : undefined;
}
