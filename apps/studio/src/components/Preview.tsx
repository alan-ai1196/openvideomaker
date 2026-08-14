import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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
 * element, driven by the same playhead the timeline uses. Stills render
 * through an img element. Text and caption clips render as overlays, and
 * the active media clip's crop is shown for real - the cropped region
 * fills the fitted source box exactly like the render pipeline frames it
 * (the same clip.crop fractions the render plan turns into crop filters).
 * This is browser-mode preview; the desktop app can add WebCodecs/proxy
 * paths behind the same controller.
 */
export function Preview() {
  const controller = useStudio();
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);

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
  const mediaAsset = videoActive ? project.assets[videoActive.clip.assetId] : null;
  const isImage = mediaAsset?.kind === 'image';
  const mediaSrc = videoActive ? cache.get(videoActive.clip.assetId).objectUrl : undefined;

  // Track the frame's padding-box size: the media element is fitted with
  // object-fit: contain against it, and the crop viewport must match the
  // fitted source rectangle exactly.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    // Images never drive the video element (a still shows via the img).
    syncEl(video, videoActive && !isImage ? videoActive : undefined, videoActive && !isImage ? mediaSrc : undefined);
    syncEl(audio, audioActive, audioActive ? cache.get(audioActive.clip.assetId).objectUrl : undefined);
  });

  const width = project.settings.width;
  const height = project.settings.height;

  // Crop framing: the viewport is the fitted source rectangle inside the
  // frame; the media element is scaled so the kept region fills it. The
  // percentages mirror how the render plan maps clip.crop fractions to
  // the final frame.
  const crop = videoActive?.clip.crop ?? null;
  let fittedBox: { x: number; y: number; w: number; h: number } | null = null;
  let cropStyle: CSSProperties | undefined;
  if (videoActive && mediaAsset?.media && crop && frameSize) {
    const srcW = mediaAsset.media.width ?? 0;
    const srcH = mediaAsset.media.height ?? 0;
    if (srcW > 0 && srcH > 0) {
      const scale = Math.min(frameSize.w / srcW, frameSize.h / srcH);
      const cw = srcW * scale;
      const ch = srcH * scale;
      fittedBox = { x: (frameSize.w - cw) / 2, y: (frameSize.h - ch) / 2, w: cw, h: ch };
      const kx = Math.max(1 - crop.left - crop.right, 0.0001);
      const ky = Math.max(1 - crop.top - crop.bottom, 0.0001);
      cropStyle = {
        width: 100 / kx + '%',
        height: 100 / ky + '%',
        left: (-100 * crop.left) / kx + '%',
        top: (-100 * crop.top) / ky + '%',
        right: 'auto',
        bottom: 'auto',
      };
    }
  }
  const cropped = !!(videoActive && mediaAsset && fittedBox && cropStyle);

  return (
    <main className="preview" aria-label={t('preview.placeholder')}>
      <div className="preview-stage" style={{ aspectRatio: width + ' / ' + height }}>
        <div className="preview-frame" ref={frameRef}>
          {cropped && mediaSrc ? (
            <div className="preview-crop" style={{ left: fittedBox!.x, top: fittedBox!.y, width: fittedBox!.w, height: fittedBox!.h }}>
              {isImage ? (
                <img className="preview-media preview-image visible" style={cropStyle} src={mediaSrc} alt="" />
              ) : (
                <video ref={videoRef} className="preview-media preview-video visible" style={cropStyle} playsInline />
              )}
            </div>
          ) : null}
          {!cropped ? (
            isImage ? (
              <img className={'preview-media preview-image' + (videoActive ? ' visible' : '')} src={mediaSrc} alt="" />
            ) : (
              <video ref={videoRef} className={'preview-video' + (videoActive ? ' visible' : '')} playsInline />
            )
          ) : null}
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
