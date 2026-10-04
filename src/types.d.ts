// The package ships types that its "exports" map does not expose
declare module "@web3-storage/car-block-validator" {
  export function validateBlock(block: { cid: unknown; bytes: Uint8Array }): Promise<void>;
}
