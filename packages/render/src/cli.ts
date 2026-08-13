#!/usr/bin/env node
/**
 * Minimal render CLI: renders a project JSON file to video with the
 * same plan builder the Studio uses. Media assets must be real files.
 *
 *   ovm-render project.ovm.json -o out.mp4 [--preset 1080p|vertical|square|source] [--quality draft|balanced|high] [--encoder auto|hardware|software]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProjectSchema, COMMON_FPS } from '@openvideomaker/schema';
import { buildRenderPlan } from './plan.js';
import { render } from './render.js';

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args.find((a) => a.endsWith('.json'));
  const output = argValue(args, '-o') ?? argValue(args, '--out') ?? 'out.mp4';
  if (!input) {
    console.error('usage: ovm-render <project.json> -o <out.mp4> [--preset 1080p|vertical|square|source] [--quality draft|balanced|high]');
    process.exit(2);
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
  } else {
    console.error('render failed:', job.error);
    process.exit(1);
  }
}

void main();