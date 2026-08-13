import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { Clip, ClipId, Track, TrackId } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { IconButton } from './controls';
import { ZoomInIcon, ZoomOutIcon } from './icons';
import { durationToPx, formatTimecode, pxToUs, rulerLabel, rulerStepSeconds, snapToFrame, usToPx } from '../timeline/math';

const TRACK_HEADER_W = 168;
const MIN_DRAG_PX = 3;

type DragState =
  | { type: 'playhead' }
  | { type: 'move'; clipId: ClipId; trackId: TrackId; grabOffsetUs: number; previewStartUs: number; moved: boolean }
  | { type: 'trim'; clipId: ClipId; trackId: TrackId; edge: 'in' | 'out'; previewStartUs: number; previewDurationUs: number; moved: boolean };

function clipLabel(controller: ReturnType<typeof useStudio>, clip: Clip): string {
  if (clip.kind === 'media') return controller.project.assets[clip.assetId]?.name ?? 'Media';
  if (clip.kind === 'text') return clip.content;
  if (clip.kind === 'caption') return 'Captions';
  return 'Color';
}

export function Timeline() {
  const controller = useStudio();
  const { t } = useI18n();
  const sequence = controller.activeSequence();
  const project = controller.project;
  const fps = project.settings.fps;
  const pxPerSec = controller.zoomPxPerSec;
  const durationUs = controller.sequenceDurationUs;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollPx, setScrollPx] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const updateDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = { pxPerSec, scrollPx };

  const commitDrag = useCallback(() => {
    const current = dragRef.current;
    if (!current || !sequence) return;
    updateDrag(null);
    if (current.type === 'move' && current.moved) {
      controller.mutate((tx) =>
        tx.moveClip({ sequenceId: sequence.id, clipId: current.clipId, trackId: current.trackId, start: current.previewStartUs }),
      );
    } else if (current.type === 'trim' && current.moved) {
      controller.mutate((tx) =>
        tx.trimClip({
          sequenceId: sequence.id,
          clipId: current.clipId,
          ...(current.edge === 'in' ? { start: current.previewStartUs } : { duration: current.previewDurationUs }),
        }),
      );
    }
  }, [controller, sequence, updateDrag]);

  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') updateDrag(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [updateDrag]);

  if (!sequence) {
    return (
      <section className="timeline">
        <div className="empty-panel">
          <p>{t('timeline.empty')}</p>
        </div>
      </section>
    );
  }

  const totalContentPx = durationToPx(durationUs, pxPerSec);
  const maxScroll = Math.max(0, totalContentPx - viewportWidth + TRACK_HEADER_W);

  const zoomBy = (factor: number) => {
    const leftUs = pxToUs(0, view);
    const nextPxPerSec = pxPerSec * factor;
    controller.setZoom(nextPxPerSec);
    const nextMax = Math.max(0, durationToPx(durationUs, nextPxPerSec) - viewportWidth + TRACK_HEADER_W);
    setScrollPx(Math.min(nextMax, usToPx(leftUs, { pxPerSec: nextPxPerSec, scrollPx: 0 })));
  };

  const fit = () => {
    const seconds = Math.max(1, durationUs / 1_000_000);
    const target = Math.max(4, Math.min(400, (viewportWidth - 80) / seconds));
    controller.setZoom(target);
    setScrollPx(0);
  };

  const onWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomBy(factor);
    } else {
      setScrollPx((s) => Math.max(0, Math.min(maxScroll, s + e.deltaY + e.deltaX)));
    }
  };

  const pointerToUs = (clientX: number): number => {
    const el = viewportRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return snapToFrame(pxToUs(clientX - rect.left, view), fps);
  };

  const startPlayheadDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateDrag({ type: 'playhead' });
    controller.setPlayhead(pointerToUs(e.clientX));
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag || !sequence) return;
    if (drag.type === 'playhead') {
      controller.setPlayhead(pointerToUs(e.clientX));
      return;
    }
    if (drag.type === 'move') {
      const us = pointerToUs(e.clientX);
      const start = Math.max(0, us - drag.grabOffsetUs);
      updateDrag({ ...drag, previewStartUs: start, moved: true });
      return;
    }
    if (drag.type === 'trim') {
      const us = Math.max(0, pointerToUs(e.clientX));
      if (drag.edge === 'in') {
        updateDrag({ ...drag, previewStartUs: us, moved: true });
      } else {
        updateDrag({ ...drag, previewDurationUs: Math.max(1, us - drag.previewStartUs), moved: true });
      }
    }
  };

  const findClip = (clipId: string): { track: Track; clip: Clip } | undefined => {
    for (const track of sequence.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return undefined;
  };

  const startClipDrag = (e: ReactPointerEvent, clipId: ClipId, trackId: TrackId, edge?: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    controller.selectClip(clipId);
    const found = findClip(clipId);
    if (!found) return;
    if (edge === 'in') {
      updateDrag({ type: 'trim', clipId, trackId, edge, previewStartUs: found.clip.start, previewDurationUs: found.clip.duration, moved: false });
    } else if (edge === 'out') {
      updateDrag({ type: 'trim', clipId, trackId, edge, previewStartUs: found.clip.start, previewDurationUs: found.clip.duration, moved: false });
    } else {
      const grabOffsetUs = Math.max(0, pointerToUs(e.clientX) - found.clip.start);
      updateDrag({ type: 'move', clipId, trackId, grabOffsetUs, previewStartUs: found.clip.start, moved: false });
    }
  };

  const clipPosition = (clip: Clip) => {
    const d = drag && (drag.type === 'move' || drag.type === 'trim') && drag.clipId === clip.id ? drag : null;
    const startUs = d?.type === 'move' ? d.previewStartUs : d?.type === 'trim' ? d.previewStartUs : clip.start;
    const durUs = d?.type === 'trim' ? d.previewDurationUs : clip.duration;
    return { left: usToPx(startUs, view), width: Math.max(2, durationToPx(durUs, pxPerSec)) };
  };

  const stepSeconds = rulerStepSeconds(pxPerSec);
  const ticks: number[] = [];
  const durationSeconds = Math.ceil(durationUs / 1_000_000);
  for (let s = 0; s <= durationSeconds; s += stepSeconds) ticks.push(s);
  if (ticks.length > 400) {
    ticks.length = 0;
    for (let s = 0; s <= durationSeconds; s += stepSeconds * 4) ticks.push(s);
  }

  return (
    <section className="timeline">
      <div className="timeline-header">
        <span className="timeline-title">{sequence.name}</span>
        <div className="timeline-zoom">
          <IconButton icon={<ZoomOutIcon />} label={t('timeline.zoomOut')} onClick={() => zoomBy(1 / 1.25)} />
          <span className="zoom-readout">{Math.round(pxPerSec)} px/s</span>
          <IconButton icon={<ZoomInIcon />} label={t('timeline.zoomIn')} onClick={() => zoomBy(1.25)} />
          <button className="button button-ghost" type="button" onClick={fit}>
            {t('timeline.fit')}
          </button>
        </div>
      </div>
      <div className="timeline-body" onWheel={onWheel} onPointerMove={onPointerMove} onPointerUp={commitDrag}>
        <div className="timeline-headers" style={{ width: TRACK_HEADER_W }}>
          <div className="track-header ruler-corner" />
          {sequence.tracks.map((track) => (
            <div className={'track-header' + (track.muted ? ' muted' : '')} key={track.id}>
              <span className="track-header-name">{track.name}</span>
              <span className="track-header-kind">{track.kind}</span>
              {track.locked ? <span className="track-header-lock" title="Locked">Locked</span> : null}
            </div>
          ))}
        </div>
        <div ref={viewportRef} className="timeline-viewport">
          <div className="timeline-content" style={{ width: Math.max(totalContentPx, viewportWidth) }}>
            <div className="ruler" onPointerDown={startPlayheadDrag}>
              {ticks.map((s) => {
                const us = s * 1_000_000;
                if (us > durationUs) return null;
                return (
                  <span className="ruler-tick" key={s} style={{ left: usToPx(us, view) }}>
                    <span className="ruler-tick-line" />
                    <span className="ruler-tick-label">{rulerLabel(s)}</span>
                  </span>
                );
              })}
            </div>
            {sequence.tracks.map((track) => (
              <div
                className={'lane' + (track.kind === 'audio' ? ' lane-audio' : '')}
                key={track.id}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('.clip')) return;
                  controller.setPlayhead(pointerToUs(e.clientX));
                  controller.selectClip(null);
                }}
              >
                {track.clips.map((clip) => {
                  const pos = clipPosition(clip);
                  const selected = controller.selectedClipId === clip.id;
                  return (
                    <div
                      className={'clip clip-kind-' + clip.kind + (selected ? ' selected' : '') + (clip.enabled ? '' : ' disabled')}
                      key={clip.id}
                      style={{ left: pos.left, width: pos.width }}
                      onPointerDown={(e) => startClipDrag(e, clip.id, track.id)}
                      role="button"
                      aria-label={clipLabel(controller, clip)}
                    >
                      <span className="clip-label">{clipLabel(controller, clip)}</span>
                      {clip.kind === 'caption' ? (
                        <span className="clip-captions">
                          {clip.segments.map((segment, index) => (
                            <span
                              className="clip-caption-segment"
                              key={index}
                              style={{
                                left: (segment.start / clip.duration) * 100 + '%',
                                width: Math.max(2, ((segment.end - segment.start) / clip.duration) * 100) + '%',
                              }}
                            />
                          ))}
                        </span>
                      ) : null}
                      {selected ? (
                        <>
                          <span
                            className="clip-handle clip-handle-in"
                            onPointerDown={(e) => startClipDrag(e, clip.id, track.id, 'in')}
                            aria-label="Trim start"
                          />
                          <span
                            className="clip-handle clip-handle-out"
                            onPointerDown={(e) => startClipDrag(e, clip.id, track.id, 'out')}
                            aria-label="Trim end"
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="playhead" style={{ left: usToPx(controller.playheadUs, view) }} onPointerDown={startPlayheadDrag}>
              <span className="playhead-cap" />
            </div>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span className="timeline-time">{formatTimecode(controller.playheadUs, fps)}</span>
      </div>
    </section>
  );
}
