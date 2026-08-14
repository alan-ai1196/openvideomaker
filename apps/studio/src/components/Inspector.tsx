import { useEffect, useState } from 'react';
import type { AssetId, Clip } from '@openvideomaker/schema';
import { alignTranscriptToShots } from '@openvideomaker/media/shot-analysis';
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

/**
 * Media intelligence: clickable shot list for the selected clip, with the
 * durable transcript's speech aligned per shot (Level 2 view over the
 * transcript - never a copy), plus the two shot-based edit commands:
 * split at shots and remove silences. Both run through the core operation
 * layer, so they are ordinary undoable edits.
 */
function ShotsSection({ controller, clip }: { controller: ReturnType<typeof useStudio>; clip: Extract<Clip, { kind: 'media' }> }) {
  const { t } = useI18n();
  const cached = controller.mediaCache.get(clip.assetId);
  const shots = cached.analysis?.shots;
  const visibleDurationUs = clip.duration / clip.speed;
  const transcript = Object.values(controller.project.transcripts).find((tr) => tr.assetId === clip.assetId);
  const shotTexts = transcript && shots
    ? alignTranscriptToShots(shots, transcript.segments.map((seg) => ({ startUs: seg.startUs, endUs: seg.endUs, text: seg.text })))
    : null;
  const srcStart = clip.inPoint;
  const srcEnd = clip.inPoint + visibleDurationUs;
  let silenceUs = 0;
  for (const region of cached.analysis?.audioRegions ?? []) {
    if (!region.silent) continue;
    const s = Math.max(region.startUs, srcStart);
    const e = Math.min(region.endUs, srcEnd);
    if (e > s) silenceUs += e - s;
  }
  const canSplit = !!shots && shots.length >= 2 && shots.some((shot, i) => {
    if (i === 0) return false;
    const offsetUs = shot.startUs - clip.inPoint;
    return offsetUs > 0 && offsetUs < visibleDurationUs;
  });
  if ((!shots || shots.length < 2) && silenceUs === 0) return null;
  return (
    <div className="field">
      <span className="field-label">{t('inspector.shots')}{shots ? ` (${shots.length})` : ''}</span>
      {shots && shots.length >= 2 ? (
        <ul className="shot-list">
          {shots.map((shot, index) => {
            const offsetUs = shot.startUs - clip.inPoint;
            if (offsetUs < 0 || offsetUs > visibleDurationUs) return null;
            const atUs = Math.round(clip.start + offsetUs * clip.speed);
            const text = shotTexts?.[index]?.text ?? '';
            return (
              <li key={index}>
                <button type="button" className="shot-item" title={t('inspector.shots.hint')} onClick={() => controller.setPlayhead(atUs)}>
                  {(shot.startUs / 1_000_000).toFixed(1)}s
                  {text ? <span className="shot-text">“{text}”</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="shot-actions">
        {canSplit ? (
          <button type="button" className="button button-secondary shot-action" title={t('inspector.shots.split.hint')} onClick={() => controller.splitSelectedAtShots()}>
            {t('inspector.shots.split')}
          </button>
        ) : null}
        {silenceUs > 0 ? (
          <button type="button" className="button button-secondary shot-action" title={t('inspector.shots.removeSilence.hint')} onClick={() => controller.removeSilenceFromSelected()}>
            {t('inspector.shots.removeSilence')} (-{(silenceUs / 1_000_000).toFixed(1)}s)
          </button>
        ) : null}
      </div>
    </div>
  );
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
  const [redubAudioId, setRedubAudioId] = useState<AssetId | ''>('');
  const [redubRunning, setRedubRunning] = useState(false);
  const [redubProgress, setRedubProgress] = useState(0);
  const [redubDone, setRedubDone] = useState(false);

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
      {clip.kind === 'media' ? <ShotsSection controller={controller} clip={clip} /> : null}
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


      {clip.kind === 'media' && controller.localGeneration ? (
        <div className="inspector-ai">
          <span className="field-label">{t('inspector.ai.actions')}</span>
          {clip.kind === 'media' && controller.project.assets[clip.assetId]?.source.kind !== 'file' ? (
            <p className="inspector-ai-hint">{t('inspector.lipsync.nofile')}</p>
          ) : (
            <div className="inspector-redub">
              <select
                className="inspector-redub-audio"
                value={redubAudioId}
                aria-label={t('inspector.lipsync.pickAudio')}
                disabled={redubRunning}
                onChange={(e) => {
                  setRedubAudioId((e.target.value || '') as AssetId | '');
                  setRedubDone(false);
                }}
              >
                <option value="">{t('inspector.lipsync.pickAudio')}</option>
                {Object.values(controller.project.assets)
                  .filter((asset) => asset.kind === 'audio' && asset.source.kind === 'file')
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
              </select>
              <button
                type="button"
                className="button button-secondary"
                disabled={!redubAudioId || redubRunning || !controller.generationAvailable('avatar.lip_sync')}
                title={controller.generationAvailable('avatar.lip_sync') ? t('inspector.lipsync') : t('inspector.lipsync.disabled')}
                onClick={() => {
                  if (!redubAudioId) return;
                  setRedubRunning(true);
                  setRedubDone(false);
                  setRedubProgress(0);
                  void controller.lipSyncClip(clip.id, redubAudioId, (progress) => setRedubProgress(progress)).then((result) => {
                    setRedubRunning(false);
                    if (result.ok) setRedubDone(true);
                  });
                }}
              >
                {redubRunning ? t('inspector.lipsync.running') + ' ' + Math.round(redubProgress * 100) + '%' : t('inspector.lipsync')}
              </button>
              {redubDone && !redubRunning ? <span className="inspector-ai-done">{t('inspector.lipsync.done')}</span> : null}
            </div>
          )}
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
