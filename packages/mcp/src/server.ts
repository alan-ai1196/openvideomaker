import { ProjectSession } from '@openvideomaker/core';
import { characterDraft } from '@openvideomaker/core';
import { applyEditScript, previewEditScript } from '@openvideomaker/agent';
import type { Registry } from '@openvideomaker/registry';
import type { EditScript } from '@openvideomaker/schema';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  MCP_PROTOCOL_VERSION,
  NotificationSchema,
  ResourceReadRequestSchema,
  type JsonSchema,
  type McpResource,
  type McpServerInfo,
  type McpTool,
} from './protocol.js';

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
});

const string = { type: 'string' } satisfies JsonSchema;
const integer = { type: 'integer' } satisfies JsonSchema;

/**
 * The OpenVideoMaker MCP server: semantic, compact tools over the SAME
 * typed operation layer the Studio uses. Agents inspect and edit
 * projects through EditScripts and typed operations - never raw state.
 */
export class McpServer {
  #session: ProjectSession | null = null;
  #registry: Registry;
  #tools = new Map<string, McpTool>();
  #resources = new Map<string, McpResource>();
  readonly info: McpServerInfo;

  constructor(options: { registry: Registry; info?: McpServerInfo; session?: ProjectSession }) {
    this.#registry = options.registry;
    this.#session = options.session ?? null;
    this.info = options.info ?? { name: 'openvideomaker', version: '0.1.0' };
    this.#registerTools();
    this.#resources.set('project://current', {
      uri: 'project://current',
      name: 'Current project',
      mimeType: 'application/json',
      read: () => (this.#session ? JSON.stringify({ project: this.#session.project }, null, 2) : '{}'),
    });
  }

  get session(): ProjectSession | null {
    return this.#session;
  }

  #requireSession(): ProjectSession {
    if (!this.#session) throw new Error('no project yet - call project.create first');
    return this.#session;
  }

  #registerTools(): void {
    const tool = (name: string, description: string, inputSchema: JsonSchema, handler: McpTool['handler']): void => {
      this.#tools.set(name, { name, description, inputSchema, handler });
    };

    tool('project.create', 'Create a new in-memory project and make it the current one.', objectSchema({
      name: string,
      width: integer,
      height: integer,
    }, ['name']), (args) => {
      this.#session = ProjectSession.create(String(args.name), {
        settings: {
          width: typeof args.width === 'number' ? args.width : 1920,
          height: typeof args.height === 'number' ? args.height : 1080,
        },
      });
      return { text: 'created project ' + this.#session.project.id + ' with one sequence' };
    });

    tool('project.inspect', 'Summarize the current project (ids, settings, entity counts, history depth).', objectSchema({}), () => {
      const session = this.#requireSession();
      const project = session.project;
      const counts = {
        sequences: Object.keys(project.sequences).length,
        tracks: Object.values(project.sequences).reduce((n, s) => n + s.tracks.length, 0),
        clips: Object.values(project.sequences).reduce((n, s) => n + s.tracks.reduce((m, t) => m + t.clips.length, 0), 0),
        assets: Object.keys(project.assets).length,
        characters: Object.keys(project.characters).length,
        transcripts: Object.keys(project.transcripts).length,
      };
      return {
        text: JSON.stringify({
          id: project.id,
          name: project.name,
          settings: project.settings,
          counts,
          checkpoint: session.checkpoint,
          canUndo: session.canUndo,
        }, null, 2),
      };
    });

    tool('project.dump', 'Return the full project JSON (the durable Video IR).', objectSchema({}), () => {
      return { text: JSON.stringify({ project: this.#requireSession().project }, null, 2) };
    });

    tool('timeline.inspect', 'Summarize the timeline: sequences, tracks and clips with times.', objectSchema({}), () => {
      const project = this.#requireSession().project;
      const sequences = Object.values(project.sequences).map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
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
            text: clip.kind === 'text' ? clip.content : clip.kind === 'caption' ? clip.segments.map((s) => s.text).join(' ') : undefined,
          })),
        })),
        markers: sequence.markers.map((m) => ({ id: m.id, time: m.time, name: m.name })),
      }));
      return { text: JSON.stringify({ activeSequenceId: project.activeSequenceId, sequences }, null, 2) };
    });

    tool('transcript.inspect', 'List transcripts (segments with timing, language, source).', objectSchema({}), () => {
      const project = this.#requireSession().project;
      const transcripts = Object.values(project.transcripts).map((t) => ({
        id: t.id,
        assetId: t.assetId,
        language: t.language,
        source: t.source.kind,
        segments: t.segments.map((s) => ({ id: s.id, startUs: s.startUs, endUs: s.endUs, text: s.text, speaker: s.speaker })),
      }));
      return { text: JSON.stringify(transcripts, null, 2) };
    });

    tool('character.inspect', 'List characters with voice and performance defaults.', objectSchema({}), () => {
      const project = this.#requireSession().project;
      return { text: JSON.stringify(Object.values(project.characters), null, 2) };
    });

    tool('character.create', 'Create a reusable character (typed, undoable operation).', objectSchema({
      name: string,
      description: string,
      provider: string,
      voiceId: string,
      consent: { type: 'boolean' },
    }, ['name']), (args) => {
      const session = this.#requireSession();
      const character = characterDraft({
        name: String(args.name),
        description: typeof args.description === 'string' ? args.description : undefined,
        voice: {
          provider: typeof args.provider === 'string' ? args.provider : 'system.tts',
          voiceId: typeof args.voiceId === 'string' ? args.voiceId : undefined,
          consent: { hasConsent: args.consent !== false },
        },
      });
      session.transaction((tx) => tx.createCharacter({ character }));
      return { text: 'created character ' + character.id };
    });

    tool('edit.preview', 'Dry-run an EditScript on a scratch copy and report operations and invariant violations.', objectSchema({ script: { type: 'object' } }), (args) => {
      const project = this.#requireSession().project;
      const preview = previewEditScript(project, args.script as EditScript);
      return { text: JSON.stringify(preview, null, 2) };
    });

    tool('edit.apply', 'Apply an EditScript as ONE undoable transaction (actor: agent).', objectSchema({ script: { type: 'object' } }), (args) => {
      const session = this.#requireSession();
      const result = applyEditScript(session, args.script as EditScript, { actorName: 'mcp-agent' });
      return { text: JSON.stringify(result, null, 2) };
    });

    tool('model.list', 'List registry models with trust states.', objectSchema({}), () => {
      const entries = this.#registry.entries.map((e) => ({
        id: e.id,
        name: e.displayName,
        category: e.category,
        capabilities: e.capabilities,
        trust: e.verification.trust,
      }));
      return { text: JSON.stringify(entries, null, 2) };
    });

    tool('model.search', 'Search models by capability or text query.', objectSchema({ capability: string, query: string, category: string }), (args) => {
      const results = this.#registry.search({
        capability: typeof args.capability === 'string' ? args.capability : undefined,
        query: typeof args.query === 'string' ? args.query : undefined,
        category: typeof args.category === 'string' ? (args.category as never) : undefined,
      });
      return { text: JSON.stringify(results.map((e) => ({ id: e.id, name: e.displayName, capabilities: e.capabilities, trust: e.verification.trust })), null, 2) };
    });

    tool('model.info', 'Return one registry entry in full.', objectSchema({ modelId: string }, ['modelId']), (args) => {
      const entry = this.#registry.byId(String(args.modelId));
      return { text: entry ? JSON.stringify(entry, null, 2) : 'model not found: ' + String(args.modelId) };
    });
  }

  /** Handle one newline-delimited JSON-RPC message; returns the response line or null. */
  async handleLine(line: string): Promise<string | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return this.#error(null, -32700, 'parse error');
    }
    const notification = NotificationSchema.safeParse(message);
    if (notification.success) return null;
    const record = message as { id?: unknown; method?: unknown; params?: unknown };
    if (typeof record.method !== 'string') return this.#error(record.id as string | number | undefined, -32600, 'invalid request');
    try {
      if (record.method === 'initialize') {
        const parsed = InitializeRequestSchema.safeParse(message);
        if (!parsed.success) return this.#error(record.id as string | number, -32602, 'invalid initialize params');
        return this.#result(record.id as string | number, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: this.info,
        });
      }
      if (record.method === 'ping') return this.#result(record.id as string | number, {});
      if (record.method === 'tools/list') {
        return this.#result(record.id as string | number, {
          tools: [...this.#tools.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
      }
      if (record.method === 'tools/call') {
        const parsed = CallToolRequestSchema.safeParse(message);
        if (!parsed.success) return this.#error(record.id as string | number, -32602, 'invalid tools/call params');
        const tool = this.#tools.get(parsed.data.params.name);
        if (!tool) return this.#error(record.id as string | number, -32602, 'unknown tool: ' + parsed.data.params.name);
        const text = tool.handler(parsed.data.params.arguments);
        const resolved = await Promise.resolve(text);
        return this.#result(record.id as string | number, { content: [{ type: 'text', text: resolved.text }] });
      }
      if (record.method === 'resources/list') {
        const staticResources = [...this.#resources.values()].map((r) => ({ uri: r.uri, name: r.name, ...(r.mimeType ? { mimeType: r.mimeType } : {}) }));
        const modelResources = this.#registry.entries.map((e) => ({ uri: 'model://' + e.id, name: e.displayName, mimeType: 'application/json' }));
        return this.#result(record.id as string | number, { resources: [...staticResources, ...modelResources] });
      }
      if (record.method === 'resources/read') {
        const parsed = ResourceReadRequestSchema.safeParse(message);
        if (!parsed.success) return this.#error(record.id as string | number, -32602, 'invalid resources/read params');
        const uri = parsed.data.params.uri;
        if (uri.startsWith('model://')) {
          const entry = this.#registry.byId(uri.slice('model://'.length));
          if (!entry) return this.#error(record.id as string | number, -32602, 'unknown resource: ' + uri);
          return this.#result(record.id as string | number, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(entry, null, 2) }] });
        }
        const resource = this.#resources.get(uri);
        if (!resource) return this.#error(record.id as string | number, -32602, 'unknown resource: ' + uri);
        return this.#result(record.id as string | number, {
          contents: [{ uri: resource.uri, ...(resource.mimeType ? { mimeType: resource.mimeType } : {}), text: resource.read() }],
        });
      }
      return this.#error(record.id as string | number, -32601, 'method not found: ' + record.method);
    } catch (err) {
      // Tool errors are reported as MCP content errors, not protocol failures.
      if (record.method === 'tools/call') {
        return this.#result(record.id as string | number, {
          content: [{ type: 'text', text: 'error: ' + (err as Error).message }],
          isError: true,
        });
      }
      return this.#error(record.id as string | number, -32603, (err as Error).message);
    }
  }

  #result(id: string | number, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
  }

  #error(id: string | number | null | undefined, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  }
}
