import type { EditPlan, EditScript, EditStep, SequenceId } from '@openvideomaker/schema';

/**
 * Short-creation script builder: turns highlight ranges (source-time
 * ranges picked from media intelligence analysis) into a declarative
 * EditScript that assembles them into one new video track, back to back,
 * with optional captions from the transcript spans inside each range.
 * The script compiles to ordinary typed operations - the short is an
 * ordinary editable timeline, never a locked structure.
 */

export interface ShortRangeInput {
  startUs: number;
  endUs: number;
  text: string;
  spans: Array<{ startUs: number; endUs: number; text: string }>;
}

export interface BuildShortScriptInput {
  sequenceId: SequenceId;
  /** The analyzed source asset. */
  assetId: string;
  /** Playback speed of the source clip the ranges were derived from. */
  speed: number;
  ranges: ShortRangeInput[];
  trackName?: string;
  captionTrackName?: string;
  /** Default: captions are included when any range carries transcript spans. */
  includeCaptions?: boolean;
}

function formatDurationUs(us: number): string {
  const seconds = us / 1_000_000;
  return seconds >= 60 ? (seconds / 60).toFixed(1) + 'm' : seconds.toFixed(1) + 's';
}

/**
 * Build the EditScript for a highlights short. Ranges are source times;
 * each becomes a media.insert on the new track (sequential, back to
 * back), and transcript spans become caption segments with their real
 * relative timing preserved.
 */
export function buildShortEditScript(input: BuildShortScriptInput): EditScript {
  const speed = input.speed > 0 ? input.speed : 1;
  const includeCaptions = input.includeCaptions ?? input.ranges.some((r) => r.spans.length > 0);
  const steps: EditStep[] = [
    { op: 'track.create', sequenceId: input.sequenceId, kind: 'video', name: input.trackName ?? 'Highlights', as: '$short' },
  ];
  let cursor = 0;
  input.ranges.forEach((range, i) => {
    const duration = Math.max(Math.round((range.endUs - range.startUs) / speed), 1);
    steps.push({
      op: 'media.insert',
      trackId: '$short',
      assetId: input.assetId,
      start: cursor,
      duration,
      inPoint: range.startUs,
      as: '$clip' + i,
    });
    cursor += duration;
  });
  if (includeCaptions) {
    steps.push({
      op: 'track.create',
      sequenceId: input.sequenceId,
      kind: 'caption',
      name: input.captionTrackName ?? 'Short captions',
      as: '$caps',
    });
    let captionCursor = 0;
    for (const range of input.ranges) {
      const rangeDuration = Math.max(Math.round((range.endUs - range.startUs) / speed), 1);
      const segments = range.spans
        .filter((span) => span.endUs > range.startUs && span.startUs < range.endUs && span.text.trim().length > 0)
        .map((span) => ({
          text: span.text,
          start: Math.max(0, Math.round((span.startUs - range.startUs) / speed)),
          end: Math.min(rangeDuration, Math.max(1, Math.round((span.endUs - range.startUs) / speed))),
        }));
      if (segments.length > 0) {
        steps.push({ op: 'caption.insert', trackId: '$caps', start: captionCursor, duration: rangeDuration, segments });
      }
      captionCursor += rangeDuration;
    }
  }
  return { schemaVersion: 1, goal: 'Create a short from the best moments', steps };
}

export interface BuildShortProposalInput extends BuildShortScriptInput {
  /** Existing source clip id (evidence only - the script never mutates it). */
  sourceClipId?: string;
}

export interface ShortProposal {
  plan: EditPlan;
  script: EditScript;
}

/** Plan + script pair for the proposal pipeline (preview / apply / reject). */
export function buildShortProposal(input: BuildShortProposalInput): ShortProposal {
  const script = buildShortEditScript(input);
  const totalUs = input.ranges.reduce((sum, r) => sum + (r.endUs - r.startUs), 0);
  const evidence = input.ranges.map((range, i) => ({
    kind: 'time-range' as const,
    reference: input.sourceClipId,
    detail: 'highlight ' + (i + 1) + ': ' + formatDurationUs(range.startUs) + '-' + formatDurationUs(range.endUs) + (range.text ? ' ("' + range.text.slice(0, 80) + '")' : ''),
  }));
  const plan: EditPlan = {
    id: 'short-highlights',
    goal: 'Create a ' + formatDurationUs(totalUs) + ' short from the best moments',
    evidence,
    constraints: [
      'Every highlight stays a fully editable clip',
      'The source timeline is never modified',
      'Captions mirror the transcript timing',
    ],
    intendedChanges: [
      'Create a Highlights video track',
      'Assemble ' + input.ranges.length + ' highlight clip' + (input.ranges.length === 1 ? '' : 's') + ' back to back',
      ...(script.steps.some((s) => s.op === 'caption.insert') ? ['Add captions from the spoken text'] : []),
    ],
    expectedOutcome: 'A ' + formatDurationUs(totalUs) + ' highlight edit on its own track, fully editable and undoable.',
    affectedArea: 'highlights',
  };
  return { plan, script };
}
