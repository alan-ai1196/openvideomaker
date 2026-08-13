#!/usr/bin/env node
/**
 * Regenerate docs/models.md from the registry (the registry is the single
 * source of truth; this file is derived and drift-checked in tests).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRegistryFromDir, generateModelDocs } from '@openvideomaker/registry/node';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const registry = loadRegistryFromDir(scriptDir + '../packages/registry/src/data');
if (registry.errors.length > 0) {
  console.error('registry is invalid:');
  for (const error of registry.errors) console.error(' - ' + error);
  process.exit(1);
}
const docs = generateModelDocs(registry);
writeFileSync(scriptDir + '../docs/models.md', docs, 'utf8');
console.log('docs/models.md regenerated (' + registry.entries.length + ' models)');
