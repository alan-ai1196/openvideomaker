#!/usr/bin/env node
/**
 * ovm-mcp: OpenVideoMaker's MCP server (stdio). Agents inspect and
 * edit projects through semantic tools over the same typed operation
 * layer the Studio uses - never through raw state or duplicated logic.
 * With --project it serves an EXISTING project (a saved project folder
 * or a .ovm.json export) instead of an empty in-memory one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '@openvideomaker/registry';
import { McpServer } from './server.js';
import { attachStdio } from './stdio.js';
import { openProjectForMcp } from './project.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const dataPath = join(here, '../../registry/src/data/index.json');
const registry = Registry.fromData(JSON.parse(readFileSync(dataPath, 'utf8')));

const projectArgIndex = process.argv.indexOf('--project');
let session = undefined;
if (projectArgIndex >= 0) {
  try {
    session = openProjectForMcp(process.argv[projectArgIndex + 1] ?? '');
  } catch (err) {
    console.error('ovm-mcp: ' + (err as Error).message);
    process.exit(2);
  }
}

const server = new McpServer({ registry, ...(session ? { session } : {}) });
attachStdio(server);
