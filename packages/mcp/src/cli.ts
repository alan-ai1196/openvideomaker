#!/usr/bin/env node
/**
 * ovm-mcp: OpenVideoMaker's MCP server (stdio). Agents inspect and
 * edit projects through semantic tools over the same typed operation
 * layer the Studio uses - never through raw state or duplicated logic.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '@openvideomaker/registry';
import { McpServer } from './server.js';
import { attachStdio } from './stdio.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const dataPath = join(here, '../../registry/src/data/index.json');
const registry = Registry.fromData(JSON.parse(readFileSync(dataPath, 'utf8')));
const server = new McpServer({ registry });
attachStdio(server);
