#!/usr/bin/env node
/**
 * ovm-doctor: probe this machine and report what it can actually do.
 *
 *   ovm-doctor           human-readable report
 *   ovm-doctor --json    machine-readable device graph
 *   ovm-doctor --strict  exit 1 when the probe produced warnings
 */
import { probeDeviceGraph } from './probe.js';
import { formatDoctor } from './doctor.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const graph = await probeDeviceGraph();
  if (json) {
    console.log(JSON.stringify(graph, null, 2));
  } else {
    console.log(formatDoctor(graph));
  }
  if (strict && graph.warnings.length > 0) process.exit(1);
}

void main();
