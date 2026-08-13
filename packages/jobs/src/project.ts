import { readFileSync } from 'node:fs';
import { attachAsrResult, generatedAsset, syncCaptionsFromTranscript, type ProjectSession } from '@openvideomaker/core';
import { probeMediaPath } from '@openvideomaker/media';
import type { AssetId, AssetKind, GenerationInput, GenerationProvenance, SequenceId, TrackId, TranscriptId } from '@openvideomaker/schema';
import { GenerationError } from './runner.js';
import type { GenerationJob } from './job.js';

/**
 * Land generation results in a project through the typed operation
 * layer. Generated media is never an anonymous file: every asset
 * carries the job's provenance (capability, model+revision, runner,
 * settings, inputs) and is importable/editable like any other asset.
 * ASR jobs additionally produce a durable, editable transcript.
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

interface ParsedTranscript {
  language?: string;
  segments: Array<{ text: string; startMs: number; endMs: number }>;
}

function parseTranscriptOutput(job: GenerationJob): ParsedTranscript {
  const { path } = requireOutput(job, 'transcript');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { language?: unknown; segments?: unknown };
  if (!Array.isArray(raw.segments)) throw new GenerationError('jobs.output-invalid', 'transcript has no segments array');
  const segments = raw.segments.map((segment, index) => {
    const s = segment as { text?: unknown; startMs?: unknown; endMs?: unknown };
    if (typeof s.text !== 'string' || typeof s.startMs !== 'number' || typeof s.endMs !== 'number') {
      throw new GenerationError('jobs.output-invalid', 'malformed transcript segment ' + index);
    }
    return { text: s.text, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) };
  });
  return { language: typeof raw.language === 'string' ? raw.language : undefined, segments };
}

export interface AttachTranscriptOptions {
  /** The source audio asset id; also recorded in the provenance inputs. */
  audioAssetId: AssetId;
  /** Also sync caption clips from the transcript (default true). */
  createCaptions?: boolean;
  sequenceId?: SequenceId;
  trackId?: TrackId;
}

/**
 * Turn an ASR job's transcript.json into a durable transcript document
 * linked to the audio asset (replacing any previous transcript for
 * that asset), and optionally sync caption clips from it. The document
 * itself is created by the shared core command, so node-side and
 * renderer-side attachments land through identical typed operations.
 */
export function attachGeneratedTranscript(session: ProjectSession, job: GenerationJob, options: AttachTranscriptOptions): TranscriptId {
  const { provenance } = requireOutput(job, 'transcript');
  const parsed = parseTranscriptOutput(job);
  const inputs: GenerationInput[] = [{ kind: 'audio', role: 'source', assetId: options.audioAssetId }];
  return attachAsrResult(session, {
    audioAssetId: options.audioAssetId,
    language: parsed.language,
    segments: parsed.segments,
    provenance: { ...provenance, inputs },
    sequenceId: options.sequenceId,
    trackId: options.trackId,
    createCaptions: options.createCaptions,
  }).transcriptId;
}

export interface AttachCaptionsOptions {
  /** The source audio asset id; required to link the transcript document. */
  audioAssetId: AssetId;
  sequenceId?: SequenceId;
  trackId?: TrackId;
}

export interface AttachCaptionsResult {
  transcriptId: TranscriptId;
  trackId: TrackId;
  segmentCount: number;
}

/**
 * Attach an ASR job: creates the durable transcript document and syncs
 * caption clips from it through the core command - the Studio caption
 * pipeline consumes the same clips. Re-runs replace the previous
 * transcript and caption set.
 */
export function attachTranscriptCaptions(session: ProjectSession, job: GenerationJob, options: AttachCaptionsOptions): AttachCaptionsResult {
  const transcriptId = attachGeneratedTranscript(session, job, {
    audioAssetId: options.audioAssetId,
    createCaptions: false,
    sequenceId: options.sequenceId,
  });
  const sync = syncCaptionsFromTranscript(session, { transcriptId, sequenceId: options.sequenceId, trackId: options.trackId });
  if (!sync) throw new GenerationError('jobs.output-invalid', 'no sequence to attach captions to');
  const transcript = session.project.transcripts[transcriptId];
  return { transcriptId, trackId: sync.trackId, segmentCount: transcript?.segments.length ?? 0 };
}

function defaultName(job: GenerationJob, outputKey: string): string {
  const short = job.modelId.split('/').pop() ?? job.modelId;
  return short + ' ' + outputKey;
}
