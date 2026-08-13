import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDoctor, probeDeviceGraph } from '@openvideomaker/devices';
import { loadRegistryFromDir } from '@openvideomaker/registry/node';
import { buildRenderPlan, render } from '@openvideomaker/render';
import { COMMON_FPS, ProjectSchema } from '@openvideomaker/schema';
import { McpServer } from '@openvideomaker/mcp';
import { attachStdio } from '@openvideomaker/mcp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const registryDataDir = resolve(repoRoot, 'packages/registry/src/data');

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runDoctor(args: string[]): Promise<number> {
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const graph = await probeDeviceGraph();
  if (json) console.log(JSON.stringify(graph, null, 2));
  else console.log(formatDoctor(graph));
  return strict && graph.warnings.length > 0 ? 1 : 0;
}

export function runModels(args: string[]): number {
  const registry = loadRegistryFromDir(registryDataDir);
  if (registry.errors.length > 0) {
    console.error('registry invalid:');
    for (const error of registry.errors) console.error(' - ' + error);
    return 1;
  }
  const capability = argValue(args, '--capability');
  const category = argValue(args, '--category');
  // Positional args = everything that is not a flag or a flag's value.
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) {
      i++;
      continue;
    }
    positional.push(args[i]!);
  }
  const sub = positional[0] ?? 'list';
  if (sub === 'list' || sub === 'search') {
    const query = sub === 'search' ? positional[1] : undefined;
    const entries = registry.search({ capability, category: category as never, query });
    const summary = entries.map((e) => ({
      id: e.id,
      name: e.displayName,
      category: e.category,
      capabilities: e.capabilities,
      trust: e.verification.trust,
    }));
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  if (sub === 'info') {
    const entry = registry.byId(positional[1] ?? '');
    if (!entry) {
      console.error('model not found: ' + (positional[1] ?? ''));
      return 1;
    }
    console.log(JSON.stringify(entry, null, 2));
    return 0;
  }
  console.error('usage: ovm models list|search [query] [--capability <id>] [--category <id>] | info <modelId>');
  return 2;
}

export async function runRender(args: string[]): Promise<number> {
  const input = args.find((a) => a.endsWith('.json'));
  const output = argValue(args, '-o') ?? argValue(args, '--out') ?? 'out.mp4';
  if (!input) {
    console.error('usage: ovm render <project.json> -o <out.mp4> [--preset 1080p|vertical|square|source] [--quality draft|balanced|high] [--encoder auto|hardware|software]');
    return 2;
  }
  const data = JSON.parse(readFileSync(input, 'utf8')) as { project?: unknown };
  const project = ProjectSchema.parse(data.project);
  const preset = argValue(args, '--preset') ?? 'source';
  const presets: Record<string, { width: number; height: number }> = {
    '1080p': { width: 1920, height: 1080 },
    vertical: { width: 1080, height: 1920 },
    square: { width: 1080, height: 1080 },
    source: { width: project.settings.width, height: project.settings.height },
  };
  const size = presets[preset] ?? presets.source!;
  const plan = await buildRenderPlan(
    project,
    {
      width: size.width,
      height: size.height,
      fps: project.settings.fps ?? COMMON_FPS.FPS_30,
      sampleRate: project.settings.sampleRate ?? 48000,
      quality: (argValue(args, '--quality') as 'draft' | 'balanced' | 'high' | undefined) ?? 'balanced',
      encoderPreference: (argValue(args, '--encoder') as 'auto' | 'hardware' | 'software' | undefined) ?? 'auto',
      outputPath: resolve(output),
    },
    (assetId) => {
      const asset = project.assets[assetId];
      return asset?.source.kind === 'file' ? asset.source.path : null;
    },
  );
  console.log('encoder:', plan.encoder.label);
  console.log('sources:', plan.sources.length, '| duration:', (plan.durationUs / 1_000_000).toFixed(1) + 's');
  const job = await render(plan);
  if (job.state === 'completed') {
    console.log('rendered:', job.outputPath);
    return 0;
  }
  console.error('render failed:', job.error);
  return 1;
}

export function runMcp(): number {
  const registry = loadRegistryFromDir(registryDataDir);
  if (registry.errors.length > 0) {
    console.error('registry invalid: ' + registry.errors.join('; '));
    return 1;
  }
  const server = new McpServer({ registry });
  attachStdio(server);
  return 0;
}

/** Dispatch one ovm invocation; returns the process exit code. */
export async function runOvm(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'doctor':
      return runDoctor(rest);
    case 'models':
      return runModels(rest);
    case 'render':
      return runRender(rest);
    case 'mcp':
      return runMcp();
    default:
      console.error('usage: ovm <doctor|models|render|mcp> ...');
      return command ? 2 : 0;
  }
}
