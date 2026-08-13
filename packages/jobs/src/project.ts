import { readFileSync } from 'node:fs';
import { generatedAsset, captionClip, type ProjectSession } from '@openvideomaker/core';
import { probeMediaPath } from '@openvideomaker/media';
import type { AssetId, AssetKind, GenerationInput, GenerationProvenance, SequenceId, TrackId } from '@openvideomaker/schema';
import { GenerationError } from './runner.js';
import type { GenerationJob } from './job.js';

/**
 * Land generation results in a project through the typed operation
 * layer. Generated media is never an anonymous file: every asset
 * carries the job's provenance (capability, model+revision, runner,
 * settings, inputs) and is importable/editable like any other asset.
 */

export interface AttachMediaOptions {
  name?: string;
}

function requireOutput(job: GenerationJob, outputKey: string): { path: string; provenance: GenerationProvenance } {
    const output = job.outputs[outputKey];
    if (!output) throw new GenerationError('jobs.output-missing', 'job has no output ' + outputKey);
    if (!job.provenance) throw new GenerationError('jobs.not-completed', 'job has no provenance; it must complete first');
    return { path: output.path, provenance: job.provenance };
}

/** Probe a generated media output and import it as an asset with provenance. */
export async function attachGeneratedMedia(session: ProjectSession, job: GenerationJob, outputKey: string, options: AttachMediaOptions = {}): Promise<AssetId> {
    const { path, provenance } = requireOutput(job, outputKey);
    const probe = await probeMediaPath(path);
    const kind: AssetKind = probe.kind === 'video' ? 'video' : probe.kind === 'audio' ? 'audio' : probe.kind === 'image' ? 'image' : 'data';
    const name = options.name ?? defaultName(job, outputKey);
    const asset = generatedAsset({
      kind,
      name,
      source: { kind: 'file', path },
      media: probe.media,
      capability: provenance.capability,
      model: provenance.model,
      runner: provenance.runner,
      settings: provenance.settings,
      inputs: provenance.inputs,
      regenerable: provenance.regenerable,
      device: provenance.device,
      generatedAt: provenance.generatedAt,
    });
    session.transaction((tx) => {
      tx.importAsset({ asset });
    });
    return asset.id;
}

/** Import a non-media generated file (e.g. SRT subtitles) as an asset with provenance. */
export function attachGeneratedFile(session: ProjectSession, job: GenerationJob, outputKey: string, kind: AssetKind, options: AttachMediaOptions = {}): AssetId {
    const { path, provenance } = requireOutput(job, outputKey);
    const name = options.name ?? defaultName(job, outputKey);
    const asset = generatedAsset({
      kind,
      name,
      source: { kind: 'file', path },
      capability: provenance.capability,
      model: provenance.model,
      runner: provenance.runner,
      settings: provenance.settings,
      inputs: provenance.inputs,
      regenerable: provenance.regenerable,
      device: provenance.device,
      generatedAt: provenance.generatedAt,
    });
    session.transaction((tx) => {
      tx.importAsset({ asset });
    });
    return asset.id;
}

export interface AttachCaptionsOptions {
  sequenceId?: SequenceId;
  trackId?: TrackId;
  trackName?: string;
  /** The source audio asset id, recorded in each clip's provenance. */
  audioAssetId?: AssetId;
}

export interface AttachCaptionsResult {
  trackId: string;
  clipIds: string[];
  segmentCount: number;
}

/**
 * Convert an ASR job's transcript.json output into caption clips on a
 * caption track - the Studio caption pipeline consumes the same clips.
 * Every clip records the generation provenance.
 */
export function attachTranscriptCaptions(session: ProjectSession, job: GenerationJob, options: AttachCaptionsOptions = {}): AttachCaptionsResult {
    const { path, provenance } = requireOutput(job, 'transcript');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { segments?: unknown };
    const segments = raw.segments;
    if (!Array.isArray(segments)) throw new GenerationError('jobs.output-invalid', 'transcript has no segments array');
    const parsed = segments.map((segment, index) => {
      const s = segment as { text?: unknown; startMs?: unknown; endMs?: unknown };
      if (typeof s.text !== 'string' || typeof s.startMs !== 'number' || typeof s.endMs !== 'number') {
        throw new GenerationError('jobs.output-invalid', 'malformed transcript segment ' + index);
      }
      return { text: s.text, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) };
    });
    const inputs: GenerationInput[] = options.audioAssetId ? [{ kind: 'audio', role: 'source', assetId: options.audioAssetId }] : provenance.inputs;
    let sequenceId: SequenceId | undefined = options.sequenceId ?? session.project.activeSequenceId ?? undefined;
    if (!sequenceId) {
      sequenceId = Object.keys(session.project.sequences)[0] as SequenceId | undefined;
    }
    if (!sequenceId) throw new GenerationError('jobs.output-invalid', 'no sequence to attach captions to');

    let trackId: TrackId | undefined = options.trackId;
    const clipIds: string[] = [];
    session.transaction((tx) => {
      if (!trackId) {
        trackId = tx.newTrackId();
        tx.createTrack({ sequenceId, trackId, kind: 'caption', name: options.trackName ?? 'Captions' });
      }
      for (const segment of parsed) {
        const durationUs = Math.max((segment.endMs - segment.startMs) * 1000, 1000);
        const clip = captionClip({
          trackId,
          start: segment.startMs * 1000,
          duration: durationUs,
          segments: [{ text: segment.text, start: 0, end: durationUs }],
        });
        clip.provenance = {
          capability: provenance.capability,
          model: provenance.model,
          runner: provenance.runner,
          settings: provenance.settings,
          inputs,
          generatedAt: provenance.generatedAt,
          regenerable: provenance.regenerable,
          device: provenance.device,
        };
        tx.insertClip({ sequenceId, trackId, clip });
        clipIds.push(clip.id);
      }
    });
    return { trackId: trackId!, clipIds, segmentCount: parsed.length };
}

function defaultName(job: GenerationJob, outputKey: string): string {
    const short = job.modelId.split('/').pop() ?? job.modelId;
    return short + ' ' + outputKey;
}
