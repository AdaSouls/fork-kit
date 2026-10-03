import { describe, expect, it } from "vitest";
import { almaIdHash, assertAlmaId, buildCoreDoc, controllerOf, docHash, toAlmaIdHash } from "../src/alma.js";

// The values AlmaAnchorRegistry holds for alma:main:org:aldea-world on a local chain (anchored by its deploy script)
const ORG = "alma:main:org:aldea-world";
const ORG_HASH = "0x14ce70465772a811ec913739ff8441c5b1a09d96e6f9b87345e4a5fa4434c318";
const CONTROLLER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("ALMA identifiers", () => {
  it("hashes an identifier as the registry does", () => {
    expect(almaIdHash(ORG)).toBe(ORG_HASH);
    expect(toAlmaIdHash(ORG)).toBe(ORG_HASH);
    expect(toAlmaIdHash(ORG_HASH.toUpperCase().replace("0X", "0x"))).toBe(ORG_HASH);
  });

  it("refuses what the registry would refuse", () => {
    for (const id of ["alma:main:org:", "alma:main:org:Nocturna", "alma:test:org:nocturna", "alma:main:organization:nocturna", `alma:main:org:${"a".repeat(65)}`, "nocturna"]) {
      expect(() => assertAlmaId(id)).toThrow(/not an ALMA identifier/);
    }
    expect(() => assertAlmaId("alma:main:human:abc", "org")).toThrow(/alma:main:org:/);
    expect(assertAlmaId("alma:main:org:nocturna-2", "org")).toBe("alma:main:org:nocturna-2");
  });
});

describe("core documents", () => {
  const doc = buildCoreDoc({ id: ORG, type: "org", createdAt: "2026-09-27T00:00:00Z", chainId: 31337, controller: CONTROLLER.toLowerCase() as `0x${string}` });

  it("names the controller as a checksummed did:pkh", () => {
    expect(doc.controllers).toEqual([{ id: `did:pkh:eip155:31337:${CONTROLLER}`, kind: "evm", primary: true }]);
    expect(controllerOf(doc)).toBe(CONTROLLER);
  });

  it("hashes the canonical document, whatever the key order", () => {
    expect(docHash(doc)).toBe("0x68aefab4291f1817e8334b9f585a20220a293540c3ad5b2575800a7b3327e8df");
    const { controllers, ...rest } = doc;
    expect(docHash({ controllers, ...rest } as typeof doc)).toBe(docHash(doc));
  });
});
