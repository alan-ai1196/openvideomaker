import type { EditPlan, EditScript, Project } from '@openvideomaker/schema';
import { EditScriptSchema } from '@openvideomaker/schema';
import type { ProjectSession } from '@openvideomaker/core';
import { compileEditScript } from './editScript.js';

/**
 * The LLM planner: an OpenAI-compatible chat endpoint turns a natural
 * goal + a compact project description into a declarative EditScript,
 * which is then VALIDATED and COMPILED by the same deterministic
 * pipeline the demo planner uses. The model never touches the project:
 * its only output is data, validated at the boundary, and the only
 * thing that ever mutates state is the typed operation layer.
 */
export interface LlmPlannerOptions {
  /** OpenAI-compatible chat completions endpoint (full URL). */
  endpoint: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  /** Injectable transport (tests); defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export type LlmPlanResult =
  | { ok: true; plan: EditPlan; script: EditScript }
  | { ok: false; code: string; message: string };

const EDIT_SCRIPT_INSTRUCTIONS = [
  'You are an editing planner for OpenVideoMaker. You turn a creator goal into a declarative EditScript (JSON).',
  'You NEVER write code, never access files, and never invent entities: every id below comes from the project description.',
  'Respond with ONLY a JSON object of this shape:',
  '{ "schemaVersion": 1, "goal": "<short goal>", "steps": [ ... ] }',
  'Steps are objects discriminated by "op". Available ops (times are INTEGER microseconds; 1s = 1000000):',
  '- { "op": "track.create", "sequenceId": "<sequence id>", "kind": "video|audio|text|caption", "name": "<optional>", "as": "$name" }',
  '- { "op": "clip.remove", "clipId": "<clip id>" }',
  '- { "op": "clip.move", "clipId": "<clip id>", "start": <us> }',
  '- { "op": "clip.trim", "clipId": "<clip id>", "start": <us, optional>, "duration": <us, optional>, "inPoint": <us, optional> }',
  '- { "op": "media.insert", "trackId": "<track id>", "assetId": "<asset id>", "start": <us>, "duration": <us, optional>, "inPoint": <us, optional>, "as": "$name" }',
  '- { "op": "text.insert", "trackId": "<track id>", "start": <us>, "duration": <us>, "content": "<text>", "as": "$name" }',
  '- { "op": "caption.insert", "trackId": "<track id>", "start": <us>, "duration": <us>, "segments": [ { "text": "<text>", "start": <us within clip>, "end": <us within clip> } ], "as": "$name" }',
  'Rules: reuse EXISTING ids whenever possible; only use $variables to refer to entities created earlier in the same script; keep edits minimal and reversible; never overlap clips on a track (use clip.move to make room); be precise with timing from the project description.',
].join(String.fromCharCode(10));

/**
 * A compact, id-complete project description for the planner: enough to
 * reference every entity precisely without dumping media data.
 */
export function describeProjectForPlanner(project: Project): string {
  const sequences = Object.entries(project.sequences).map(([id, sequence]) => ({
    id,
    tracks: sequence.tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        kind: clip.kind,
        start: clip.start,
        duration: clip.duration,
        assetId: clip.kind === 'media' ? clip.assetId : undefined,
        content: clip.kind === 'text' ? clip.content : undefined,
        segmentCount: clip.kind === 'caption' ? clip.segments.length : undefined,
      })),
    })),
  }));
  const assets = Object.entries(project.assets).map(([id, asset]) => ({
    id,
    kind: asset.kind,
    name: asset.name,
    durationUs: asset.media?.durationUs,
  }));
  const transcripts = Object.values(project.transcripts).map((transcript) => ({
    id: transcript.id,
    assetId: transcript.assetId,
    language: transcript.language,
    segments: transcript.segments.map((segment) => ({ startUs: segment.startUs, endUs: segment.endUs, text: segment.text })),
  }));
  const scripts = Object.values(project.scripts).map((script) => ({
    id: script.id,
    name: script.name,
    lines: script.lines.map((line) => ({ text: line.text, characterId: line.characterId, startUs: line.startUs, durationUs: line.durationUs })),
  }));
  return JSON.stringify({
    name: project.name,
    sequences,
    assets,
    transcripts,
    scripts,
    characters: Object.values(project.characters).map((character) => ({ id: character.id, name: character.name })),
  });
}

function stepSummary(op: string, step: Record<string, unknown>): string {
  const clip = typeof step.clipId === 'string' ? ' ' + step.clipId : '';
  const track = typeof step.trackId === 'string' ? ' ' + step.trackId : '';
  return op + (clip || track);
}

export class LlmPlanner {
  readonly options: LlmPlannerOptions;

  constructor(options: LlmPlannerOptions) {
    this.options = options;
  }

  async #complete(messages: Array<{ role: string; content: string }>): Promise<string> {
    const fetchFn = this.options.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000);
    try {
      const response = await fetchFn(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: 'Bearer ' + this.options.apiKey } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error('LLM endpoint responded ' + response.status + (body ? ': ' + body.slice(0, 300) : ''));
      }
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) throw new Error('LLM endpoint returned no content');
      return content;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('LLM request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  /** Plan an edit: LLM -> validated EditScript -> compiled against the REAL project. */
  async plan(session: ProjectSession, goal: string): Promise<LlmPlanResult> {
    const description = describeProjectForPlanner(session.project as Project);
    const messages = [
      { role: 'system', content: EDIT_SCRIPT_INSTRUCTIONS },
      { role: 'user', content: 'Goal: ' + goal + String.fromCharCode(10) + 'Project: ' + description },
    ];
    let content: string;
    try {
      content = await this.#complete(messages);
    } catch (err) {
      return { ok: false, code: 'llm.unreachable', message: err instanceof Error ? err.message : String(err) };
    }
    // One repair round: the model sees the exact validation error.
    let parsed = EditScriptSchema.safeParse(this.#extractJson(content));
    if (!parsed.success) {
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content:
          'Your response was invalid JSON for the EditScript format. Errors: ' +
          parsed.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ') +
          '. Reply with ONLY the corrected JSON object.',
      });
      try {
        content = await this.#complete(messages);
      } catch (err) {
        return { ok: false, code: 'llm.unreachable', message: err instanceof Error ? err.message : String(err) };
      }
      parsed = EditScriptSchema.safeParse(this.#extractJson(content));
    }
    if (!parsed.success) {
      return {
        ok: false,
        code: 'llm.invalid-script',
        message:
          'the model produced an invalid edit script: ' +
          parsed.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; '),
      };
    }
    const script = parsed.data;
    const compiled = compileEditScript(session.project as Project, script);
    if (!compiled.ok) {
      return { ok: false, code: 'llm.invalid-script', message: compiled.errors.join('; ') };
    }
    const plan: EditPlan = {
      id: 'llm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      goal: goal.slice(0, 300),
      evidence: [{ kind: 'note', detail: 'goal-driven plan over the current project' }],
      constraints: ['Every change stays undoable and editable', 'Never overwrite or destroy existing media'],
      intendedChanges: script.steps.map((step) => stepSummary(step.op, step as unknown as Record<string, unknown>)),
      expectedOutcome: goal + ' - ' + script.steps.length + ' typed, undoable operation(s).',
      affectedArea: 'project',
    };
    return { ok: true, plan, script };
  }

  #extractJson(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
      throw new Error('no JSON object in the model response');
    }
  }
}
