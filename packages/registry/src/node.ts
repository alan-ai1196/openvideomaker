import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from './client.js';

/** Load and validate every JSON file in a data directory (Node side). */
export function loadRegistryFromDir(dir: string): Registry {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const data = files.map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));
  return Registry.fromData(data);
}

/** Generate the human-facing model docs from the registry (single source of truth). */
export function generateModelDocs(registry: Registry): string {
  const lines: string[] = [];
  lines.push('# Supported models');
  lines.push('');
  lines.push('Generated from the model registry - do not edit by hand. Run');
  lines.push('`node scripts/generate-model-docs.mjs` and commit the result.');
  lines.push('');
  lines.push('Every entry records its trust state honestly. `unverified` means the');
  lines.push('metadata below was checked against the upstream hub but OpenVideoMaker');
  lines.push('has not yet run the model. No entry here is presented as working until');
  lines.push('a runner slice verifies it.');
  lines.push('');
  for (const category of registry.categories()) {
    lines.push('## ' + category.label + ' (' + category.count + ')');
    lines.push('');
    for (const entry of registry.search({ category: category.id }).sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push('### ' + entry.displayName);
      lines.push('');
      lines.push('- **Id:** `' + entry.id + '` - **Trust:** ' + entry.verification.trust);
      lines.push('- **Upstream:** [' + entry.upstream.project + '](' + entry.upstream.url + ')');
      lines.push('- **License:** ' + entry.license.name + (entry.license.url ? ' (' + entry.license.url + ')' : '') + (entry.license.note ? ' - ' + entry.license.note : ''));
      lines.push('- **Capabilities:** ' + entry.capabilities.join(', '));
      lines.push('- **Runner:** ' + entry.runner.kind + (entry.runner.notes ? ' (' + entry.runner.notes + ')' : ''));
      lines.push('- **Hardware:** ' + entry.hardware.map((h) => h.platform + '/' + h.status).join(', '));
      if (entry.memory.note) lines.push('- **Memory:** ' + entry.memory.note);
      if (entry.limitations.length > 0) lines.push('- **Limitations:** ' + entry.limitations.join('; '));
      lines.push('- **Evidence:** ' + entry.verification.evidence);
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}