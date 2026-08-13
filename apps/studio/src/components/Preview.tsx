import type { AssetKind } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { formatTimecode } from '../timeline/math';

const KIND_COLOR: Record<AssetKind, string> = {
  video: 'var(--accent)',
  audio: 'var(--success)',
  image: 'var(--warning)',
  subtitle: 'var(--text-secondary)',
  data: 'var(--text-tertiary)',
};

/**
 * Preview stage: shows the composition frame and the clip under the
 * playhead. Real media playback arrives with the preview slice; until
 * then this is an honest letterboxed stage, not a fake video.
 */
export function Preview() {
  const controller = useStudio();
  const { t } = useI18n();
  const project = controller.project;
  const sequence = controller.activeSequence();
  const playhead = controller.playheadUs;
  const fps = project.settings.fps;

  const underPlayhead = sequence
    ?.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    .filter(({ clip }) => clip.enabled && playhead >= clip.start && playhead < clip.start + clip.duration)
    .slice(0, 3);

  return (
    <main className="preview" aria-label={t('preview.placeholder')}>
      <div
        className="preview-stage"
        style={{ aspectRatio: project.settings.width + ' / ' + project.settings.height }}
      >
        <div className="preview-frame">
          {underPlayhead && underPlayhead.length > 0 ? (
            underPlayhead.map(({ track, clip }) => (
              <div className="preview-clip-chip" key={clip.id} style={{ borderColor: KIND_COLOR[clip.kind === 'media' ? assetKindOf(controller, clip.assetId) : 'video'] }}>
                <span className="preview-clip-track">{track.name}</span>
                <span className="preview-clip-name">{clipName(controller, clip.id)}</span>
              </div>
            ))
          ) : (
            <div className="preview-empty">
              <span className="preview-empty-title">{t('preview.placeholder')}</span>
              <span className="preview-empty-hint">{t('preview.hint')}</span>
            </div>
          )}
        </div>
      </div>
      <div className="preview-status">
        <span>{formatTimecode(playhead, fps)}</span>
        <span>{project.settings.width} × {project.settings.height}</span>
      </div>
    </main>
  );
}

function assetKindOf(controller: ReturnType<typeof useStudio>, assetId: string): AssetKind {
  return controller.project.assets[assetId]?.kind ?? 'data';
}

function clipName(controller: ReturnType<typeof useStudio>, clipId: string): string {
  const sequence = controller.activeSequence();
  if (!sequence) return clipId;
  for (const track of sequence.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) continue;
    if (clip.kind === 'media') return controller.project.assets[clip.assetId]?.name ?? 'Media';
    if (clip.kind === 'text') return clip.content;
    if (clip.kind === 'caption') return clip.segments.map((s) => s.text).join(' | ');
    return clip.color;
  }
  return clipId;
}
