import { useState, type ReactElement } from 'react';
import { Registry } from '@openvideomaker/registry';
import MODEL_ENTRIES from '@openvideomaker/registry/data.json';
import type { Character, VoiceConfig } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { TrashIcon } from './icons';

const registry = Registry.fromData(MODEL_ENTRIES);
const TTS_PROVIDERS = registry.byCapability('audio.tts');

/**
 * Character Studio: persistent, reusable characters (identity + voice
 * + performance defaults). Everything lands as typed project
 * operations, so every edit is undoable. Voiceover GENERATION runs in
 * the desktop app through the local jobs service; the browser Studio
 * says so instead of faking it.
 */
export function CharacterPanel() {
  const controller = useStudio();
  const { t } = useI18n();
  const characters = Object.values(controller.project.characters);

  return (
    <div className="character-list">
      <button type="button" className="button button-primary" onClick={() => controller.createCharacter()}>
        {t('character.new')}
      </button>
      {characters.length === 0 ? (
        <div className="empty-panel">
          <p>{t('character.empty')}</p>
          <p className="empty-hint">{t('character.empty.hint')}</p>
        </div>
      ) : (
        characters.map((character) => <CharacterCard key={character.id} character={character} />)
      )}
    </div>
  );
}

function CharacterCard({ character }: { character: Character }) {
  const controller = useStudio();
  const { t } = useI18n();
  const [line, setLine] = useState('');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const update = (patch: Parameters<typeof controller.updateCharacter>[1]): void => {
    controller.updateCharacter(character.id, patch);
  };
  const voice = (patch: Partial<VoiceConfig>): void => {
    controller.changeCharacterVoice(character.id, { ...character.voice, ...patch });
  };
  const modelId = character.voice.modelId ?? character.voice.provider;
  const runnable = controller.generationModels.some((m) => m.modelId === modelId && m.capability === 'audio.tts');
  const canGenerate = controller.localGeneration && runnable && !generating;
  const defaultLine = 'Hi, I am ' + character.name + '.';
  let generateTitle: string;
  if (generating) generateTitle = t('character.generate.running');
  else if (modelId === 'system.tts' || (controller.localGeneration && !runnable)) generateTitle = t('character.generate.disabled.provider');
  else if (!controller.localGeneration) generateTitle = t('character.generate.disabled');
  else generateTitle = t('character.generate.voiceover');

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setDone(false);
    setProgress(0);
    const result = await controller.generateVoiceover(character.id, line.trim() || defaultLine, (p) => setProgress(p));
    setGenerating(false);
    if (result.ok) setDone(true);
  };

  return (
    <section className="character-card">
      <header className="character-head">
        <InlineText className="character-name" value={character.name} onCommit={(name) => update({ name })} ariaLabel={t('character.name')} />
        <button type="button" className="icon-button" title={t('character.delete')} onClick={() => controller.removeCharacter(character.id)}>
          <TrashIcon />
        </button>
      </header>
      <InlineText className="character-desc" value={character.description ?? ''} placeholder={t('character.description')} onCommit={(description) => update({ description: description || undefined })} ariaLabel={t('character.description')} />

      <div className="character-section">
        <span className="character-section-label">{t('character.voice')}</span>
        <label className="character-field">
          <span>{t('character.voice.provider')}</span>
          <select value={character.voice.provider} onChange={(e) => voice({ provider: e.target.value })}>
            <option value="system.tts">system.tts</option>
            {TTS_PROVIDERS.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.displayName}</option>
            ))}
          </select>
        </label>
        <label className="character-field">
          <span>{t('character.voice.id')}</span>
          <input type="text" value={character.voice.voiceId ?? ''} placeholder="af_heart" onChange={(e) => voice({ voiceId: e.target.value || undefined })} />
        </label>
        <label className="character-field character-consent">
          <input
            type="checkbox"
            checked={character.voice.consent.hasConsent}
            onChange={(e) => voice({ consent: { hasConsent: e.target.checked, note: character.voice.consent.note } })}
          />
          <span>{t('character.voice.consent')}</span>
        </label>
      </div>

      <div className="character-section">
        <span className="character-section-label">{t('character.performance')}</span>
        <Slider label={t('character.realism')} value={character.defaults.realism} onCommit={(realism) => update({ defaults: { realism } })} />
        <Slider label={t('character.gesture')} value={character.defaults.gesture} onCommit={(gesture) => update({ defaults: { gesture } })} />
        <Slider label={t('character.headMotion')} value={character.defaults.headMotion} onCommit={(headMotion) => update({ defaults: { headMotion } })} />
        <label className="character-field">
          <span>{t('character.emotion')}</span>
          <input type="text" value={character.defaults.emotion ?? ''} onChange={(e) => update({ defaults: { emotion: e.target.value || undefined } })} />
        </label>
      </div>

      <details className="character-advanced">
        <summary>{t('character.advanced')}</summary>
        <label className="character-field">
          <span>{t('character.preferredCapability')}</span>
          <input type="text" value={character.defaults.preferredCapability ?? ''} placeholder="avatar.lip_sync" onChange={(e) => update({ defaults: { preferredCapability: e.target.value || undefined } })} />
        </label>
        <label className="character-field">
          <span>{t('character.preferredModel')}</span>
          <input type="text" value={character.defaults.preferredModelId ?? ''} onChange={(e) => update({ defaults: { preferredModelId: e.target.value || undefined } })} />
        </label>
      </details>

      <div className="character-generate">
        <input
          className="character-generate-line"
          type="text"
          value={line}
          placeholder={defaultLine}
          aria-label={t('character.voiceover.line')}
          disabled={generating}
          onChange={(e) => setLine(e.target.value)}
        />
        <button type="button" className="button button-secondary" disabled={!canGenerate} title={generateTitle} onClick={() => void generate()}>
          {generating ? t('character.generate.running') + ' ' + Math.round(progress * 100) + '%' : t('character.generate.voiceover')}
        </button>
        {done && !generating ? <span className="character-generate-done">{t('character.generate.done')}</span> : null}
      </div>
    </section>
  );
}

function InlineText({ value, onCommit, placeholder, className, ariaLabel }: { value: string; onCommit: (value: string) => void; placeholder?: string; className: string; ariaLabel: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    setEditing(false);
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  if (editing) {
    return (
      <input
        className={className + ' inline-editor' + (value ? '' : ' empty')}
        value={draft}
        placeholder={placeholder}
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
    <button type="button" className={className + (value ? '' : ' empty')} title={ariaLabel} onClick={() => {
      setDraft(value);
      setEditing(true);
    }}>
      {value || placeholder}
    </button>
  );
}

function Slider({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }): ReactElement {
  return (
    <label className="character-slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
      />
      <span className="character-slider-value">{Math.round(value * 100)}%</span>
    </label>
  );
}
