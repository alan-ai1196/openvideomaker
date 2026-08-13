import { OperationError } from '../errors.js';
import type { ApplyFn } from '../types.js';
import type {
  ScriptAddLineParams,
  ScriptCreateParams,
  ScriptRemoveLineParams,
  ScriptRemoveParams,
  ScriptRenameParams,
  ScriptUpdateLineParams,
} from '@openvideomaker/schema';

export const applyScriptCreate: ApplyFn<ScriptCreateParams> = (project, params, ctx) => {
  const script = params.script;
  if (project.scripts[script.id]) throw new OperationError('op.validation', 'script id already used: ' + script.id);
  project.scripts[script.id] = script;
  project.updatedAt = ctx.now;
};

export const applyScriptRemove: ApplyFn<ScriptRemoveParams> = (project, params, ctx) => {
  if (!project.scripts[params.scriptId]) throw new OperationError('op.not-found', 'script not found: ' + params.scriptId);
  delete project.scripts[params.scriptId];
  project.updatedAt = ctx.now;
};

export const applyScriptRename: ApplyFn<ScriptRenameParams> = (project, params, ctx) => {
  const script = project.scripts[params.scriptId];
  if (!script) throw new OperationError('op.not-found', 'script not found: ' + params.scriptId);
  script.name = params.name;
  script.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyScriptAddLine: ApplyFn<ScriptAddLineParams> = (project, params, ctx) => {
  const script = project.scripts[params.scriptId];
  if (!script) throw new OperationError('op.not-found', 'script not found: ' + params.scriptId);
  if (script.lines.some((line) => line.id === params.line.id)) {
    throw new OperationError('op.validation', 'line id already used: ' + params.line.id);
  }
  script.lines.push(params.line);
  script.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyScriptUpdateLine: ApplyFn<ScriptUpdateLineParams> = (project, params, ctx) => {
  const script = project.scripts[params.scriptId];
  if (!script) throw new OperationError('op.not-found', 'script not found: ' + params.scriptId);
  const line = script.lines.find((l) => l.id === params.lineId);
  if (!line) throw new OperationError('op.not-found', 'line not found: ' + params.lineId);
  const patch = params.patch;
  if (patch.text !== undefined) line.text = patch.text;
  if (patch.characterId !== undefined) line.characterId = patch.characterId ?? undefined;
  if (patch.voiceId !== undefined) line.voiceId = patch.voiceId ?? undefined;
  if (patch.startUs !== undefined) line.startUs = patch.startUs ?? undefined;
  if (patch.durationUs !== undefined) line.durationUs = patch.durationUs ?? undefined;
  if (patch.note !== undefined) line.note = patch.note;
  script.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};

export const applyScriptRemoveLine: ApplyFn<ScriptRemoveLineParams> = (project, params, ctx) => {
  const script = project.scripts[params.scriptId];
  if (!script) throw new OperationError('op.not-found', 'script not found: ' + params.scriptId);
  const index = script.lines.findIndex((l) => l.id === params.lineId);
  if (index < 0) throw new OperationError('op.not-found', 'line not found: ' + params.lineId);
  script.lines.splice(index, 1);
  script.updatedAt = ctx.now;
  project.updatedAt = ctx.now;
};
