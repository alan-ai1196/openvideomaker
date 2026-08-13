import {
  captionClip,
  collectViolations,
  InvariantError,
  mediaClip,
  ProjectSession,
  textClip,
  type Violation,
} from '@openvideomaker/core';
import {
  newTrackId,
  EditScriptSchema,
  type ClipId,
  type EditScript,
  type OperationType,
  type Project,
  type RawOperation,
  type SequenceId,
  type TrackId,
} from '@openvideomaker/schema';

/**
 * Compiles a restricted declarative EditScript into the typed
 * operation vocabulary. There is NO code evaluation anywhere in this
 * path: steps are data, validated by zod, and resolved against the
 * current project plus the entities the script itself creates
 * (variable bindings). The result is an ordinary operation
 * transaction - undoable, replayable, reviewable.
 */

const VARIABLE = /^\$[a-zA-Z][a-zA-Z0-9_]*$/;

export interface LocatedClip {
  sequenceId: SequenceId;
  trackId: TrackId;
  clipId: ClipId;
}

export function findClip(project: Project, clipId: string): LocatedClip | null {
  for (const [sequenceId, sequence] of Object.entries(project.sequences)) {
    for (const track of sequence.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { sequenceId: sequenceId as SequenceId, trackId: track.id, clipId: clip.id };
    }
  }
  return null;
}

export function findTrack(project: Project, trackId: string): { sequenceId: SequenceId; trackId: TrackId } | null {
  for (const [sequenceId, sequence] of Object.entries(project.sequences)) {
    if (sequence.tracks.some((t) => t.id === trackId)) {
      return { sequenceId: sequenceId as SequenceId, trackId: trackId as TrackId };
    }
  }
  return null;
}

interface TrackBinding {
  kind: 'track';
  sequenceId: SequenceId;
  trackId: TrackId;
}

interface ClipBinding {
  kind: 'clip';
  sequenceId: SequenceId;
  trackId: TrackId;
  clipId: ClipId;
}

type Binding = TrackBinding | ClipBinding;

export interface CompileResult {
  ok: boolean;
  errors: string[];
  operations: RawOperation[];
}

export function compileEditScript(project: Project, script: EditScript): CompileResult {
  const parsed = EditScriptSchema.safeParse(script);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message),
      operations: [],
    };
  }
  const errors: string[] = [];
  const operations: RawOperation[] = [];
  const bindings = new Map<string, Binding>();

  const resolveClip = (value: string): LocatedClip | null => {
    if (VARIABLE.test(value)) {
      const binding = bindings.get(value);
      if (binding?.kind === 'clip') return { sequenceId: binding.sequenceId, trackId: binding.trackId, clipId: binding.clipId };
      return null;
    }
    return findClip(project, value);
  };

  const resolveTrack = (value: string): { sequenceId: SequenceId; trackId: TrackId } | null => {
    if (VARIABLE.test(value)) {
      const binding = bindings.get(value);
      if (binding?.kind === 'track') return { sequenceId: binding.sequenceId, trackId: binding.trackId };
      return null;
    }
    return findTrack(project, value);
  };

  for (const [index, step] of parsed.data.steps.entries()) {
    const label = 'step ' + (index + 1) + ' (' + step.op + ')';
    switch (step.op) {
      case 'track.create': {
        const located = resolveTrack(step.sequenceId) ?? findTrack(project, step.sequenceId);
        const sequenceId = (located?.sequenceId ?? step.sequenceId) as SequenceId;
        if (!project.sequences[sequenceId]) {
          errors.push(label + ': unknown sequence ' + step.sequenceId);
          break;
        }
        const trackId = newTrackId();
        operations.push({ type: 'track.create', params: { sequenceId, trackId, kind: step.kind, ...(step.name ? { name: step.name } : {}) } });
        if (step.as) bindings.set(step.as, { kind: 'track', sequenceId, trackId });
        break;
      }
      case 'clip.remove': {
        const found = resolveClip(step.clipId);
        if (!found) {
          errors.push(label + ': clip not found ' + step.clipId);
          break;
        }
        operations.push({ type: 'clip.remove', params: { sequenceId: found.sequenceId, clipId: found.clipId } });
        break;
      }
      case 'clip.move': {
        const found = resolveClip(step.clipId);
        if (!found) {
          errors.push(label + ': clip not found ' + step.clipId);
          break;
        }
        operations.push({ type: 'clip.move', params: { sequenceId: found.sequenceId, clipId: found.clipId, start: step.start } });
        break;
      }
      case 'clip.trim': {
        const found = resolveClip(step.clipId);
        if (!found) {
          errors.push(label + ': clip not found ' + step.clipId);
          break;
        }
        operations.push({
          type: 'clip.trim',
          params: {
            sequenceId: found.sequenceId,
            clipId: found.clipId,
            ...(step.start !== undefined ? { start: step.start } : {}),
            ...(step.duration !== undefined ? { duration: step.duration } : {}),
            ...(step.inPoint !== undefined ? { inPoint: step.inPoint } : {}),
          },
        });
        break;
      }
      case 'media.insert': {
        const located = resolveTrack(step.trackId);
        if (!located) {
          errors.push(label + ': track not found ' + step.trackId);
          break;
        }
        const asset = project.assets[step.assetId];
        if (!asset) {
          errors.push(label + ': asset not found ' + step.assetId);
          break;
        }
        const duration = step.duration ?? asset.media?.durationUs ?? 1_000_000;
        const clip = mediaClip({ trackId: located.trackId, assetId: asset.id, start: step.start, duration, inPoint: step.inPoint ?? 0 });
        operations.push({ type: 'clip.insert', params: { sequenceId: located.sequenceId, trackId: located.trackId, clip } });
        if (step.as) bindings.set(step.as, { kind: 'clip', sequenceId: located.sequenceId, trackId: located.trackId, clipId: clip.id });
        break;
      }
      case 'text.insert': {
        const located = resolveTrack(step.trackId);
        if (!located) {
          errors.push(label + ': track not found ' + step.trackId);
          break;
        }
        const clip = textClip({ trackId: located.trackId, start: step.start, duration: step.duration, content: step.content, ...(step.style ? { style: step.style } : {}) });
        operations.push({ type: 'clip.insert', params: { sequenceId: located.sequenceId, trackId: located.trackId, clip } });
        if (step.as) bindings.set(step.as, { kind: 'clip', sequenceId: located.sequenceId, trackId: located.trackId, clipId: clip.id });
        break;
      }
      case 'caption.insert': {
        const located = resolveTrack(step.trackId);
        if (!located) {
          errors.push(label + ': track not found ' + step.trackId);
          break;
        }
        const clip = captionClip({ trackId: located.trackId, start: step.start, duration: step.duration, segments: step.segments });
        operations.push({ type: 'clip.insert', params: { sequenceId: located.sequenceId, trackId: located.trackId, clip } });
        if (step.as) bindings.set(step.as, { kind: 'clip', sequenceId: located.sequenceId, trackId: located.trackId, clipId: clip.id });
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors, operations };
}

export interface ApplyEditScriptResult {
  ok: boolean;
  errors: string[];
  appliedTypes: OperationType[];
}

/** Compile and apply a script as one atomic, undoable transaction. */
export function applyEditScript(session: ProjectSession, script: EditScript, options?: { actorName?: string }): ApplyEditScriptResult {
  const compiled = compileEditScript(session.project, script);
  if (!compiled.ok) return { ok: false, errors: compiled.errors, appliedTypes: [] };
  try {
    const result = session.apply(compiled.operations, { actor: { kind: 'agent', name: options?.actorName ?? 'agent' }, note: script.goal });
    return { ok: true, errors: [], appliedTypes: result.operations.map((op) => op.type) };
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], appliedTypes: [] };
  }
}

export interface PreviewResult {
  ok: boolean;
  errors: string[];
  appliedTypes: OperationType[];
  violations: Violation[];
}

/** Dry-run on a scratch copy: never mutates the live project. */
export function previewEditScript(project: Project, script: EditScript): PreviewResult {
  const compiled = compileEditScript(project, script);
  if (!compiled.ok) return { ok: false, errors: compiled.errors, appliedTypes: [], violations: [] };
  const scratch = ProjectSession.open(structuredClone(project) as Project, []);
  try {
    const result = scratch.apply(compiled.operations, { actor: { kind: 'agent' } });
    return {
      ok: true,
      errors: [],
      appliedTypes: result.operations.map((op) => op.type),
      violations: collectViolations(scratch.project) as Violation[],
    };
  } catch (err) {
    const violations = err instanceof InvariantError ? (err.violations as Violation[]) : [];
    return { ok: false, errors: [(err as Error).message], appliedTypes: [], violations };
  }
}
