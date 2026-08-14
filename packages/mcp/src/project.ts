import { existsSync, readFileSync } from 'node:fs';
import { ProjectSession } from '@openvideomaker/core';
import { ProjectStore } from '@openvideomaker/persistence';
import type { ProjectLog } from '@openvideomaker/schema';

/**
 * Open an EXISTING project for an MCP server: a saved project folder
 * (SQLite + log) or a .ovm.json export. Shared by ovm-mcp and ovm mcp
 * so agents always attach to the same project semantics as the Studio.
 */
export function openProjectForMcp(target: string): ProjectSession {
  if (!target || !existsSync(target)) {
    throw new Error('--project requires an existing project folder or .ovm.json file');
  }
  if (target.toLowerCase().endsWith('.json')) {
    const loaded = JSON.parse(readFileSync(target, 'utf8')) as { project?: unknown; log?: unknown };
    if (!loaded.project || !Array.isArray(loaded.log)) {
      throw new Error('not a valid .ovm.json export (project + log required)');
    }
    return ProjectSession.open(loaded.project as never, loaded.log as unknown as ProjectLog);
  }
  const store = ProjectStore.open(target);
  const loaded = store.load();
  store.close();
  return ProjectSession.open(loaded.project, loaded.log);
}