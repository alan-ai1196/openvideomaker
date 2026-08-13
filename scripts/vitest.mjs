#!/usr/bin/env node
/**
 * Cross-platform vitest launcher.
 *
 * Node >= 23.6 enables native TypeScript type-stripping by default, which
 * interferes with vitest 4's module runner on some platforms (tests load
 * but register zero suites: "No test suite found in file"). We disable
 * native stripping only when the current Node exposes it, so this script
 * stays a no-op on Node versions where the flag does not exist (Node 20/22).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const vitestEntry = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const inherited = (process.env.NODE_OPTIONS ?? '').split(/\s+/).filter(Boolean);
const features = process.features;
const hasNativeTs = typeof features === 'object' && features !== null && features.typescript === 'strip';
if (hasNativeTs && !inherited.some((opt) => opt.includes('strip-types'))) {
  inherited.push('--no-experimental-strip-types');
}

const child = spawn(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: inherited.join(' ') },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});