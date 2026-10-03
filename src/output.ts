import { BaseError, ContractFunctionRevertedError } from "viem";

/** A command's result: printed as aligned `key  value` lines, or as one JSON object with `--json` (for CI). */
export type Result = Record<string, unknown>;

export function printResult(result: Result, json: boolean, write: (line: string) => void = console.log) {
  if (json) return write(JSON.stringify(result));
  const entries = Object.entries(result).filter(([, value]) => value !== undefined && value !== null);
  const width = Math.max(...entries.map(([key]) => key.length));
  for (const [key, value] of entries) write(`${key.padEnd(width)}  ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
}

/** What went wrong, in one line: a contract's custom error by name and arguments when the call reverted. */
export function errorMessage(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const { data } = revert;
      if (data?.errorName) return `the contract rejected the call: ${data.errorName}(${(data.args ?? []).map(String).join(", ")})`;
      return `the contract rejected the call: ${revert.reason ?? revert.shortMessage}`;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}
