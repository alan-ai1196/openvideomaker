import type { EditPlan, EditScript, EditStep, Project } from '@openvideomaker/schema';

export interface DemoEdit {
  plan: EditPlan;
  script: EditScript;
}

/**
 * A deterministic planner: inspects the CURRENT project and produces
 * concrete EditPlan/EditScript pairs. This is the engine the LLM
 * editing agent will eventually drive - today it demonstrates the
 * proposal pipeline honestly (see the Studio Agent panel note).
 */
export function suggestDemoEdits(project: Project): DemoEdit[] {
  const suggestions: DemoEdit[] = [];
  const sequenceId = Object.keys(project.sequences)[0];
  const sequence = sequenceId ? project.sequences[sequenceId] : undefined;
  if (!sequenceId || !sequence) return suggestions;
  const videoTrack = sequence.tracks.find((t) => t.kind === 'video');

  const firstClip = videoTrack?.clips[0];
  if (videoTrack && firstClip && firstClip.duration > 1_500_000) {
    const trimUs = 1_000_000;
    const later = videoTrack.clips.filter((c) => c.start >= firstClip.start + firstClip.duration);
    const steps: EditStep[] = [
      { op: 'clip.trim', clipId: firstClip.id, duration: firstClip.duration - trimUs },
      ...later.map((c) => ({ op: 'clip.move', clipId: c.id, start: c.start - trimUs }) as EditStep),
    ];
    suggestions.push({
      plan: {
        id: 'demo-tighten-intro',
        goal: 'Make the intro faster',
        evidence: [{ kind: 'clip', reference: firstClip.id, detail: 'first clip on the video track' }],
        constraints: ['Keep every clip fully editable', 'Never overwrite other clips'],
        intendedChanges: [
          'Trim the first clip by 1s',
          ...later.map((_, i) => 'Move clip ' + (i + 2) + ' 1s earlier'),
        ],
        expectedOutcome: 'The timeline is 1s shorter; every change stays undoable.',
        affectedArea: 'opening',
      },
      script: { schemaVersion: 1, goal: 'Make the intro faster', steps },
    });
  }

  const transcript = Object.values(project.transcripts)[0];
  if (transcript && transcript.segments.length > 0) {
    const steps: EditStep[] = [
      { op: 'track.create', sequenceId, kind: 'caption', name: 'Captions', as: '$captions' },
      ...transcript.segments.map((segment) => {
        const durationUs = Math.max(segment.endUs - segment.startUs, 1000);
        return {
          op: 'caption.insert',
          trackId: '$captions',
          start: segment.startUs,
          duration: durationUs,
          segments: [{ text: segment.text, start: 0, end: durationUs }],
        } as EditStep;
      }),
    ];
    suggestions.push({
      plan: {
        id: 'demo-captions',
        goal: 'Add captions from the transcript',
        evidence: [{ kind: 'transcript-range', reference: transcript.id, detail: 'existing transcript segments' }],
        constraints: ['Captions mirror the transcript timing'],
        intendedChanges: ['Create a caption track', 'Add ' + transcript.segments.length + ' caption clips from the transcript'],
        expectedOutcome: 'The timeline shows synced captions, still fully editable.',
        affectedArea: 'captions',
      },
      script: { schemaVersion: 1, goal: 'Add captions from the transcript', steps },
    });
  }

  return suggestions;
}
