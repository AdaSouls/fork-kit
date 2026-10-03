#!/usr/bin/env node
import { createProgram } from "./program.js";

await createProgram({
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  exit: (code) => {
    process.exitCode = code;
  },
  env: process.env,
}).parseAsync();
