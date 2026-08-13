import { useState } from 'react';
import { usToSeconds, type SegmentId, type TranscriptId } from '@openvideomaker/schema';
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
  const transcripts = Object.values(controller.project.transcripts);

  const commit = (transcriptId: TranscriptId, segmentId: SegmentId): void => {
    controller.setTranscriptSegmentText(transcriptId, segmentId, draft.trim());
    setEditing(null);
  };

  if (transcripts.length === 0) {
    return (
      <div className="empty-panel">
        <p>{t('transcript.empty')}</p>
        <p className="empty-hint">{t('transcript.empty.hint')}</p>
      </div>
    );
  }

  return (
    <div className="transcript-list">
      {transcripts.map((transcript) => {
        const asset = controller.project.assets[transcript.assetId];
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
