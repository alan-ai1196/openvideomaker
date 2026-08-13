import { useEffect, useState } from 'react';
import type { Clip } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { Button } from './controls';
import { TrashIcon } from './icons';

function findSelectedClip(controller: ReturnType<typeof useStudio>): Clip | undefined {
  const id = controller.selectedClipId;
  if (!id) return undefined;
  const sequence = controller.activeSequence();
  if (!sequence) return undefined;
  for (const track of sequence.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return clip;
  }
  return undefined;
}

function usToSecondsInput(us: number): string {
  return (us / 1_000_000).toFixed(3);
}

function secondsInputToUs(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000);
}

/** Contextual Inspector: edits apply through the operation layer immediately. */
export function Inspector() {
  const controller = useStudio();
  const { t } = useI18n();
  const clip = findSelectedClip(controller);
  const sequenceId = controller.activeSequence()?.id;

  const [startDraft, setStartDraft] = useState('');
  const [durationDraft, setDurationDraft] = useState('');
  const [inPointDraft, setInPointDraft] = useState('');
  const [textDraft, setTextDraft] = useState('');

  useEffect(() => {
    if (clip) {
      setStartDraft(usToSecondsInput(clip.start));
      setDurationDraft(usToSecondsInput(clip.duration));
      setInPointDraft(clip.kind === 'media' ? usToSecondsInput(clip.inPoint) : '');
      setTextDraft(clip.kind === 'text' ? clip.content : '');
    }
  }, [clip?.id, clip?.start, clip?.duration, clip?.kind]);

  if (!clip || !sequenceId) {
    return (
      <aside className="inspector">
        <h2 className="panel-heading">{t('inspector.clip')}</h2>
        <div className="empty-panel">
          <p>{t('inspector.nothing')}</p>
          <p className="empty-hint">{t('inspector.hint')}</p>
        </div>
      </aside>
    );
  }

  const applyTrim = () => {
    const start = secondsInputToUs(startDraft);
    const duration = secondsInputToUs(durationDraft);
    const inPoint = clip.kind === 'media' ? secondsInputToUs(inPointDraft) : undefined;
    controller.mutate((tx) => {
      tx.trimClip({
        sequenceId,
        clipId: clip.id,
        ...(start !== null && start !== clip.start ? { start } : {}),
        ...(duration !== null && duration !== clip.duration ? { duration } : {}),
        ...(clip.kind === 'media' && inPoint !== null && inPoint !== clip.inPoint ? { inPoint } : {}),
      });
    });
  };

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <h2 className="panel-heading">{t('inspector.clip')}</h2>
        <span className={'clip-kind-badge clip-kind-badge-' + clip.kind}>{clip.kind}</span>
      </div>

      {clip.kind === 'media' ? (
        <div className="inspector-name">{controller.project.assets[clip.assetId]?.name ?? clip.assetId}</div>
      ) : null}
      {clip.kind === 'text' ? (
        <label className="field">
          <span className="field-label">{t('inspector.text.content')}</span>
          <textarea
            value={textDraft}
            rows={2}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={() => {
              if (textDraft !== clip.content) {
                controller.mutate((tx) => tx.editText({ sequenceId, clipId: clip.id, content: textDraft }));
              }
            }}
          />
        </label>
      ) : null}
      {clip.kind === 'caption' ? (
        <div className="field">
          <span className="field-label">{t('inspector.caption.segments')}</span>
          <ul className="segment-list">
            {clip.segments.map((segment, index) => (
              <li key={index}>
                <span className="segment-time">
                  {(segment.start / 1_000_000).toFixed(1)}–{(segment.end / 1_000_000).toFixed(1)}s
                </span>
                <span className="segment-text">{segment.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('inspector.start')} (s)</span>
          <input value={startDraft} onChange={(e) => setStartDraft(e.target.value)} onBlur={applyTrim} onKeyDown={(e) => e.key === 'Enter' && applyTrim()} />
        </label>
        <label className="field">
          <span className="field-label">{t('inspector.duration')} (s)</span>
          <input value={durationDraft} onChange={(e) => setDurationDraft(e.target.value)} onBlur={applyTrim} onKeyDown={(e) => e.key === 'Enter' && applyTrim()} />
        </label>
      </div>
      {clip.kind === 'media' ? (
        <label className="field">
          <span className="field-label">{t('inspector.inPoint')} (s)</span>
          <input value={inPointDraft} onChange={(e) => setInPointDraft(e.target.value)} onBlur={applyTrim} onKeyDown={(e) => e.key === 'Enter' && applyTrim()} />
        </label>
      ) : null}

      <label className="field">
        <span className="field-label">
          {t('inspector.opacity')} — {Math.round(clip.opacity * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(clip.opacity * 100)}
          onChange={(e) => {
            const opacity = Number(e.target.value) / 100;
            controller.mutate((tx) => tx.setClipOpacity({ sequenceId, clipId: clip.id, opacity }));
          }}
        />
      </label>

      <label className="field">
        <span className="field-label">
          {t('inspector.speed')} — {clip.speed.toFixed(2)}×
        </span>
        <input
          type="range"
          min={25}
          max={200}
          value={Math.round(clip.speed * 100)}
          onChange={(e) => {
            const speed = Number(e.target.value) / 100;
            controller.mutate((tx) => tx.setClipSpeed({ sequenceId, clipId: clip.id, speed }));
          }}
        />
      </label>

      {clip.audio ? (
        <label className="field">
          <span className="field-label">
            {t('inspector.gain')} — {clip.audio.gain.toFixed(2)}
          </span>
          <input
            type="range"
            min={0}
            max={200}
            value={Math.round(clip.audio.gain * 100)}
            onChange={(e) => {
              const gain = Number(e.target.value) / 100;
              controller.mutate((tx) => tx.setClipAudio({ sequenceId, clipId: clip.id, audio: { ...clip.audio!, gain } }));
            }}
          />
        </label>
      ) : null}

      <label className="field-check">
        <input
          type="checkbox"
          checked={clip.enabled}
          onChange={(e) => controller.mutate((tx) => tx.enableClip({ sequenceId, clipId: clip.id, enabled: e.target.checked }))}
        />
        <span>{t('inspector.enabled')}</span>
      </label>

      <div className="inspector-actions">
        <Button label={t('inspector.split')} onClick={() => controller.splitSelectedAtPlayhead()}>
          {t('inspector.split')}
        </Button>
        <Button variant="danger" icon={<TrashIcon />} label={t('inspector.delete')} onClick={() => {
          controller.rippleDeleteSelected();
        }}>
          {t('inspector.delete')}
        </Button>
      </div>
    </aside>
  );
}
