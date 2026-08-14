import { useState } from 'react';
import { usToSeconds, type AssetId, type SegmentId, type TranscriptId } from '@openvideomaker/schema';
import { extractKeywords, searchTranscript } from '@openvideomaker/media/topics';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/strings';

/**
 * Transcript panel: durable, editable transcripts linked to media
 * assets. Click a segment to seek, click its text to correct it, and
 * sync caption clips onto the timeline. Transcribing itself runs in
 * the desktop app (local jobs); the browser Studio never pretends to
 * run ASR - it edits transcripts that already exist.
 */
export function TranscriptPanel() {
  const controller = useStudio();
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ transcriptId: TranscriptId; segmentId: SegmentId } | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const transcripts = Object.values(controller.project.transcripts);
  const allSegments = transcripts.flatMap((transcript) =>
    transcript.segments.map((segment) => ({ ...segment, transcriptId: transcript.id })),
  );
  const candidates = Object.values(controller.project.assets).filter((asset) =>
    (asset.kind === 'video' || asset.kind === 'audio') &&
    asset.source.kind === 'file' &&
    !controller.project.assetTranscripts[asset.id],
  );

  const commit = (transcriptId: TranscriptId, segmentId: SegmentId): void => {
    controller.setTranscriptSegmentText(transcriptId, segmentId, draft.trim());
    setEditing(null);
  };

  const hits = query.trim().length > 0 ? searchTranscript(allSegments, query, { limit: 12 }) : [];
  return (
    <div className="transcript-list">
      <div className="transcript-tools">
        <input
          className="transcript-search"
          type="search"
          value={query}
          placeholder={t('transcript.search.placeholder')}
          aria-label={t('transcript.search.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits.length > 0 ? (
          <ul className="transcript-hits">
            {hits.map((hit) => (
              <li key={(hit.segmentId ?? '') + hit.startUs}>
                <button type="button" className="transcript-hit" onClick={() => controller.setPlayhead(hit.startUs)}>
                  <span className="transcript-hit-time">{usToSeconds(hit.startUs).toFixed(1)}s</span>
                  <span className="transcript-hit-text">{hit.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {candidates.length > 0 ? (
        <section className="transcribe-card">
          <header className="transcribe-head">
            <span>{t('transcript.transcribe.hint')}</span>
          </header>
          {candidates.map((asset) => (
            <TranscribeRow key={asset.id} assetId={asset.id} name={asset.name} />
          ))}
        </section>
      ) : null}
      {transcripts.length === 0 && candidates.length === 0 ? (
        <div className="empty-panel">
          <p>{t('transcript.empty')}</p>
          <p className="empty-hint">{t('transcript.empty.hint')}</p>
        </div>
      ) : null}
      {transcripts.map((transcript) => {
        const asset = controller.project.assets[transcript.assetId];
        const keywords = extractKeywords(transcript.segments, { limit: 6 });
        return (
          <section key={transcript.id} className="transcript-card">
            <header className="transcript-head">
              <span className="transcript-asset" title={transcript.assetId}>{asset?.name ?? transcript.id}</span>
              {transcript.language ? <span className="transcript-chip">{transcript.language}</span> : null}
              <span className="transcript-chip">{t(('transcript.source.' + transcript.source.kind) as MessageKey)}</span>
              <button type="button" className="button button-secondary" onClick={() => controller.syncCaptionsFromTranscript(transcript.id)}>
                {t('transcript.syncCaptions')}
              </button>
            </header>
            {keywords.length > 0 ? (
              <div className="transcript-keywords">
                {keywords.map((keyword) => (
                  <button
                    key={keyword.term}
                    type="button"
                    className="transcript-keyword"
                    title={t('transcript.keywords.hint')}
                    onClick={() => setQuery(keyword.term)}
                  >
                    {keyword.term}
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="transcript-segments">
              {transcript.segments.map((segment) => (
                <li key={segment.id} className="transcript-segment">
                  <button type="button" className="transcript-time" onClick={() => controller.setPlayhead(segment.startUs)}>
                    {usToSeconds(segment.startUs).toFixed(1)}s
                  </button>
                  {editing && editing.transcriptId === transcript.id && editing.segmentId === segment.id ? (
                    <textarea
                      className="transcript-editor"
                      value={draft}
                      rows={2}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(transcript.id, segment.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          commit(transcript.id, segment.id);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="transcript-text"
                      title={t('transcript.edit.hint')}
                      onClick={() => {
                        setEditing({ transcriptId: transcript.id, segmentId: segment.id });
                        setDraft(segment.text);
                      }}
                    >
                      {segment.text}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** One media asset without a transcript, with a live local ASR affordance. */
function TranscribeRow({ assetId, name }: { assetId: AssetId; name: string }) {
  const controller = useStudio();
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const available = controller.localGeneration && controller.generationAvailable('audio.asr');
  const run = async (): Promise<void> => {
    setRunning(true);
    setProgress(0);
    await controller.transcribeAsset(assetId, { onProgress: (p) => setProgress(p) });
    setRunning(false);
  };
  return (
    <div className="transcribe-row">
      <span className="transcribe-name">{name}</span>
      <button
        type="button"
        className="button button-secondary"
        disabled={!available || running}
        title={available ? t('transcript.transcribe') : t('transcript.transcribe.disabled')}
        onClick={() => void run()}
      >
        {running ? t('transcript.transcribing') + ' ' + Math.round(progress * 100) + '%' : t('transcript.transcribe')}
      </button>
    </div>
  );
}
