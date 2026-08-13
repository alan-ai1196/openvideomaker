import { useState } from 'react';
import { usToSeconds } from '@openvideomaker/schema';
import type { CharacterId, LineId, ScriptId, ScriptLine } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';

/**
 * Script panel: ordered speech lines optionally linked to characters.
 * Editing lines is typed + undoable; 'Place on timeline' syncs them to
 * a Script text track in one reviewable step. Voiceover generation
 * itself runs in the desktop app.
 */
export function ScriptPanel() {
  const controller = useStudio();
  const { t } = useI18n();
  const scripts = Object.values(controller.project.scripts);
  return (
    <div className="script-list">
      <button type="button" className="button button-primary" onClick={() => controller.createScript()}>
        {t('script.new')}
      </button>
      {scripts.length === 0 ? (
        <div className="empty-panel">
          <p>{t('script.empty')}</p>
          <p className="empty-hint">{t('script.empty.hint')}</p>
        </div>
      ) : (
        scripts.map((script) => <ScriptCard key={script.id} scriptId={script.id} name={script.name} lines={script.lines} />)
      )}
    </div>
  );
}

function ScriptCard({ scriptId, name, lines }: { scriptId: ScriptId; name: string; lines: ScriptLine[] }) {
  const controller = useStudio();
  const { t } = useI18n();
  const characters = Object.values(controller.project.characters);
  const [draftText, setDraftText] = useState('');

  return (
    <section className="script-card">
      <header className="script-head">
        <span className="script-name">{name}</span>
        <button type="button" className="button button-secondary" onClick={() => controller.syncScriptToTimeline(scriptId)}>
          {t('script.place')}
        </button>
        <button type="button" className="icon-button" title={t('script.delete')} onClick={() => controller.removeScript(scriptId)}>
          ×
        </button>
      </header>
      <ul className="script-lines">
        {lines.map((line, index) => (
          <li key={line.id} className="script-line">
            <span className="script-line-index">{index + 1}</span>
            <InlineText value={line.text} onCommit={(text) => controller.updateScriptLine(scriptId, line.id, { text })} ariaLabel={t('script.line')} />
            <select
              className="script-line-character"
              value={line.characterId ?? ''}
              title={t('script.character')}
              onChange={(e) => controller.updateScriptLine(scriptId, line.id, { characterId: (e.target.value || null) as CharacterId | null })}
            >
              <option value="">-</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
            <input
              className="script-line-time"
              type="number"
              min={0}
              step={0.1}
              placeholder={t('script.start')}
              title={t('script.start')}
              value={line.startUs !== undefined ? usToSeconds(line.startUs).toFixed(1) : ''}
              onChange={(e) => {
                const seconds = Number(e.target.value);
                controller.updateScriptLine(scriptId, line.id, { startUs: Number.isFinite(seconds) ? Math.round(seconds * 1_000_000) : null });
              }}
            />
            <button type="button" className="script-line-seek" title={t('script.seek')} disabled={line.startUs === undefined} onClick={() => controller.setPlayhead(line.startUs ?? 0)}>
              ▶
            </button>
            <LineSpeechButton scriptId={scriptId} line={line} />
            <button type="button" className="script-line-remove" title={t('script.removeLine')} onClick={() => controller.removeScriptLine(scriptId, line.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="script-add">
        <input
          type="text"
          value={draftText}
          placeholder={t('script.addLine')}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draftText.trim()) {
              controller.addScriptLine(scriptId, draftText.trim());
              setDraftText('');
            }
          }}
        />
        <button
          type="button"
          className="button"
          disabled={!draftText.trim()}
          onClick={() => {
            controller.addScriptLine(scriptId, draftText.trim());
            setDraftText('');
          }}
        >
          {t('script.add')}
        </button>
      </div>
    </section>
  );
}

/**
 * Per-line local speech generation (desktop): the same TTS path the
 * Character Studio uses, placed through planScriptPlacements so text
 * clips and audio share one timing plan. Disabled honestly outside the
 * desktop app or when the line has no speakable character.
 */
function LineSpeechButton({ scriptId, line }: { scriptId: ScriptId; line: ScriptLine }) {
  const controller = useStudio();
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const character = line.characterId ? controller.project.characters[line.characterId] : undefined;
  const modelId = character?.voice.modelId ?? character?.voice.provider;
  const runnable = Boolean(modelId) && controller.generationModels.some((m) => m.modelId === modelId && m.capability === 'audio.tts');
  const available = controller.localGeneration && runnable;
  let title: string;
  if (!controller.localGeneration) title = t('script.generate.disabled');
  else if (!line.characterId || !runnable) title = t('script.generate.disabled.character');
  else title = t('script.generate');
  const run = async (): Promise<void> => {
    setRunning(true);
    setDone(false);
    setProgress(0);
    const result = await controller.generateScriptLineSpeech(scriptId, line.id, (p) => setProgress(p));
    setRunning(false);
    if (result.ok) setDone(true);
  };
  return (
    <button
      type="button"
      className="script-line-speech"
      title={title}
      disabled={!available || running}
      onClick={() => void run()}
    >
      {running ? t('script.generating') + ' ' + Math.round(progress * 100) + '%' : done ? '✓ ' + t('script.generated') : '♪ ' + t('script.generate')}
    </button>
  );
}

function InlineText({ value, onCommit, ariaLabel }: { value: string; onCommit: (value: string) => void; ariaLabel: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
  };
  if (editing) {
    return (
      <input
        className="script-line-editor"
        value={draft}
        aria-label={ariaLabel}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }
  return (
    <button type="button" className="script-line-text" title={ariaLabel} onClick={() => {
      setDraft(value);
      setEditing(true);
    }}>
      {value}
    </button>
  );
}
