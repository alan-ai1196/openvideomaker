#!/usr/bin/env node
/**
 * ovm: doctor | models | render | mcp. A thin command surface - every
 * subcommand delegates to the same packages the Studio uses.
 */
import { runOvm } from './commands.js';

runOvm(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    console.error('ovm failed:', (err as Error).message);
    process.exitCode = 1;
  });
