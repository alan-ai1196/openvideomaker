import { describe, expect, it } from 'vitest';
import {
  AssetSchema,
  ClipSchema,
  DEFAULT_TRANSFORM,
  newAssetId,
  newClipId,
  newSequenceId,
  newTrackId,
  OperationSchema,
  ProjectSchema,
  type Asset,
  type Clip,
} from '@openvideomaker/schema';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: newAssetId(),
    kind: 'video',
    name: 'clip.mp4',
    source: { kind: 'file', path: 'C:/media/clip.mp4' },
    media: { durationUs: 10_000_000, hasVideo: true, hasAudio: true, width: 1920, height: 1080 },
    origin: { kind: 'import' },
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMediaClip(overrides: Partial<Clip> = {}): Clip {
  return ClipSchema.parse({
    kind: 'media',
    id: newClipId(),
    trackId: newTrackId(),
    start: 0,
    duration: 1_000_000,
    assetId: newAssetId(),
    inPoint: 0,
    ...overrides,
  });
}

describe('ProjectSchema', () => {
  it('parses a minimal project with defaults', () => {
    const project = ProjectSchema.parse({
      formatVersion: 1,
      id: 'proj_0123456789abcdef',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: {},
    });
    expect(project.settings.width).toBe(1920);
    expect(project.settings.height).toBe(1080);
    expect(project.settings.fps).toEqual({ num: 30, den: 1 });
    expect(project.sequences).toEqual({});
    expect(project.activeSequenceId).toBeNull();
  });

  it('rejects invalid entity ids', () => {
    expect(() =>
      ProjectSchema.parse({
        formatVersion: 1,
        id: 'not-an-id',
        name: 'Test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('ClipSchema', () => {
  it('applies clip defaults', () => {
    const clip = makeMediaClip();
    expect(clip.speed).toBe(1);
    expect(clip.enabled).toBe(true);
    expect(clip.opacity).toBe(1);
    expect(clip.transform).toEqual(DEFAULT_TRANSFORM);
    expect(clip.effects).toEqual([]);
    expect(clip.transitionIn).toBeNull();
  });

  it('parses caption clips with segments', () => {
    const clip = ClipSchema.parse({
      kind: 'caption',
      id: newClipId(),
      trackId: newTrackId(),
      start: 0,
      duration: 3_000_000,
      segments: [{ text: 'hello', start: 0, end: 1_500_000 }],
    });
    expect(clip.kind).toBe('caption');
    expect(clip.segments[0]?.text).toBe('hello');
  });

  it('rejects invalid opacity', () => {
    expect(() => makeMediaClip({ opacity: 1.5 })).toThrow();
  });

  it('rejects non-positive duration', () => {
    expect(() => makeMediaClip({ duration: 0 })).toThrow();
  });
});

describe('OperationSchema', () => {
  const envelope = { opId: 'op_0123456789abcdef', at: '2026-01-01T00:00:00.000Z', actor: { kind: 'user' as const } };

  it('accepts a clip.insert operation', () => {
    const clip = makeMediaClip();
    const op = OperationSchema.parse({
      ...envelope,
      type: 'clip.insert',
      params: { sequenceId: newSequenceId(), trackId: clip.trackId, clip },
    });
    expect(op.type).toBe('clip.insert');
  });

  it('rejects an operation with wrong params shape', () => {
    expect(() =>
      OperationSchema.parse({
        ...envelope,
        type: 'clip.insert',
        params: { sequenceId: 'nope' },
      }),
    ).toThrow();
  });

  it('rejects an unknown operation type', () => {
    expect(() =>
      OperationSchema.parse({ ...envelope, type: 'clip.explode', params: {} }),
    ).toThrow();
  });

  it('requires trim to change something', () => {
    expect(() =>
      OperationSchema.parse({
        ...envelope,
        type: 'clip.trim',
        params: { sequenceId: newSequenceId(), clipId: newClipId() },
      }),
    ).toThrow();
  });
});

describe('asset provenance', () => {
  it('builds generated assets with provenance', () => {
    const generated = AssetSchema.parse({
      id: newAssetId(),
      kind: 'video',
      name: 'generated.mp4',
      source: { kind: 'cas', ref: 'abc123def456' },
      origin: {
        kind: 'generated',
        provenance: {
          capability: 'avatar.lip_sync',
          model: { id: 'hf/example/latentsync' },
          runner: { kind: 'local-python' },
          settings: {},
          inputs: [],
          generatedAt: '2026-01-01T00:00:00.000Z',
          regenerable: true,
        },
      },
      importedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(generated.origin.kind).toBe('generated');
    expect(generated.origin.provenance.capability).toBe('avatar.lip_sync');
  });

  it('rejects generated origin without provenance', () => {
    expect(() =>
      AssetSchema.parse({
        ...makeAsset(),
        origin: { kind: 'generated' },
      }),
    ).toThrow();
  });
});