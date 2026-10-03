import type { Command } from "commander";
import { isAddress, isHex, getAddress, type Address, type Hex } from "viem";
import type { Context } from "../context.js";
import type { Result } from "../output.js";

/** Registers a command group on the program; `run` gives each action its context and prints what it returns. */
export type Register = (program: Command, run: <Options>(action: (ctx: Context, options: Options) => Promise<Result>) => (options: Options) => Promise<void>) => void;

export const ZERO_32: Hex = `0x${"0".repeat(64)}`;
export const ZERO_ADDRESS: Address = `0x${"0".repeat(40)}`;

export function bytes32(name: string, value: string): Hex {
  if (!isHex(value) || value.length !== 66) throw new Error(`${name}: "${value}" is not a 32-byte hex id (0x and 64 hex characters)`);
  return value.toLowerCase() as Hex;
}

export function evmAddress(name: string, value: string): Address {
  if (!isAddress(value)) throw new Error(`${name}: "${value}" is not an address`);
  return getAddress(value);
}

/** The index of `value` in an on-chain enum's names. */
export function enumIndex(name: string, names: readonly string[], value: string): number {
  const index = names.indexOf(value.toLowerCase());
  if (index === -1) throw new Error(`${name}: "${value}" is not one of ${names.join(", ")}`);
  return index;
}

/** A transaction's hash and, on networks with an explorer, its link. */
export const txResult = (ctx: Context, hash: Hex): Result => ({ tx: hash, explorer: ctx.txUrl(hash) });
