import { useEffect, useRef } from 'react';
import type { CaptionSegment, Clip } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { formatTimecode } from '../timeline/math';

interface ActiveMedia {
  clip: Extract<Clip, { kind: 'media' }>;
  trackKind: string;
  trackMuted: boolean;
  sourceUs: number;
}

function sourceUsAt(controller: ReturnType<typeof useStudio>, clip: Extract<Clip, { kind: 'media' }>): number {
  return clip.inPoint + (controller.playheadUs - clip.start) * clip.speed;
}

/**
 * Preview stage with real playback: a shared video element plus an audio
 * element, driven by the same playhead the timeline uses. Text and caption
 * clips render as overlays. This is browser-mode preview; the desktop app
 * can add WebCodecs/proxy paths behind the same controller.
 */
export function Preview() {
  const controller = useStudio();
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const project = controller.project;
  const sequence = controller.activeSequence();
  const playhead = controller.playheadUs;
  const fps = project.settings.fps;
  const cache = controller.mediaCache;

  const active = new Map<string, ActiveMedia>();
  const overlays: Clip[] = [];
  if (sequence) {
    for (const track of sequence.tracks) {
      for (const clip of track.clips) {
        if (!clip.enabled || playhead < clip.start || playhead >= clip.start + clip.duration) continue;
        if (clip.kind === 'media') {
          active.set(track.kind === 'audio' ? 'audio' : 'video', { clip, trackKind: track.kind, trackMuted: track.muted, sourceUs: sourceUsAt(controller, clip) });
        } else if (clip.kind === 'text' || clip.kind === 'caption') {
          overlays.push(clip);
        }
      }
    }
  }
  const videoActive = active.get('video');
  const audioActive = active.get('audio');

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    const syncEl = (el: HTMLMediaElement, media: ActiveMedia | undefined, src: string | undefined) => {
      if (media && src) {
        if (el.dataset.src !== src) {
          el.src = src;
          el.dataset.src = src;
          // Seek once metadata is available; before that, currentTime
          // assignments are ignored by the browser.
          el.onloadedmetadata = () => {
            el.currentTime = media.sourceUs / 1_000_000;
            el.onloadedmetadata = null;
          };
        }
        const target = media.sourceUs / 1_000_000;
        if (el.readyState >= 1 && Math.abs(el.currentTime - target) > 0.12) el.currentTime = target;
        if (controller.playing && el.paused && el.readyState >= 1) void el.play().catch(() => undefined);
        if (!controller.playing && !el.paused) el.pause();
        const muted = el === video ? media.trackMuted || media.clip.audio?.muted || !media.clip.audio : media.trackMuted || media.clip.audio?.muted || !media.clip.audio;
        el.muted = muted;
        if (media.clip.audio) el.volume = Math.min(1, media.clip.audio.gain);
      } else {
        if (!el.paused) el.pause();
        if (el.dataset.src !== '') {
          el.removeAttribute('src');
          el.dataset.src = '';
          el.onloadedmetadata = null;
        }
      }
    };
    syncEl(video, videoActive, videoActive ? cache.get(videoActive.clip.assetId).objectUrl : undefined);
    syncEl(audio, audioActive, audioActive ? cache.get(audioActive.clip.assetId).objectUrl : undefined);
  });

  const width = project.settings.width;
  const height = project.settings.height;

  return (
    <main className="preview" aria-label={t('preview.placeholder')}>
      <div className="preview-stage" style={{ aspectRatio: width + ' / ' + height }}>
        <div className="preview-frame">
          <video ref={videoRef} className={'preview-video' + (videoActive ? ' visible' : '')} playsInline />
          <audio ref={audioRef} />
          {!videoActive && !audioActive ? (
            <div className="preview-empty">
              <span className="preview-empty-title">{t('preview.placeholder')}</span>
              <span className="preview-empty-hint">{t('preview.hint.import')}</span>
            </div>
          ) : null}
          {overlays.map((clip) => <Overlay key={clip.id} clip={clip} playhead={playhead} />)}
        </div>
      </div>
      <div className="preview-status">
        <span>{formatTimecode(playhead, fps)}</span>
        <span>{width} × {height}</span>
      </div>
    </main>
  );
}

function Overlay({ clip, playhead }: { clip: Clip; playhead: number }) {
  if (clip.kind === 'text') {
    return (
      <div
        className="preview-overlay preview-overlay-text"
        style={{ left: clip.style.positionX * 100 + '%', top: clip.style.positionY * 100 + '%', fontSize: clip.style.fontSize * 0.6 }}
      >
        {clip.content}
      </div>
    );
  }
  if (clip.kind === 'caption') {
    const relative = playhead - clip.start;
    const segment = clip.segments.find((s: CaptionSegment) => relative >= s.start && relative < s.end);
    if (!segment) return null;
    return (
      <div className="preview-overlay preview-overlay-caption">
        {segment.text}
      </div>
    );
  }
  return null;
}
