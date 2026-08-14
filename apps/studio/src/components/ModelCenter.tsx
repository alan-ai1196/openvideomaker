import { useMemo, useState } from 'react';
import { Registry, CATEGORY_LABELS, type ModelEntry } from '@openvideomaker/registry';
import MODEL_ENTRIES from '@openvideomaker/registry/data.json';
import { useI18n } from '../i18n/context';
import { useStudio } from '../studio/context';
import type { MessageKey } from '../i18n/strings';

const registry = Registry.fromData(MODEL_ENTRIES);

export const MODEL_CENTER_ERRORS = registry.errors;

/**
 * Model Center: capability-first browsing. Cards show what creators need
 * (what it does, trust, license) and hide framework details behind the
 * 'evidence' line. Install runs in the desktop app; the browser Studio
 * says so honestly instead of faking it.
 */
export function ModelCenter() {
  const { t } = useI18n();
  const [category, setCategory] = useState<ModelEntry['category'] | 'all'>('all');
  const entries = useMemo(
    () => (category === 'all' ? registry.entries : registry.search({ category })),
    [category],
  );

  return (
    <div className="model-center">
      <div className="model-categories">
        <button type="button" className={'model-category' + (category === 'all' ? ' selected' : '')} onClick={() => setCategory('all')}>
          {t('modelcenter.all')} ({registry.entries.length})
        </button>
        {(Object.keys(CATEGORY_LABELS) as Array<ModelEntry['category']>).map((id) => (
          <button key={id} type="button" className={'model-category' + (category === id ? ' selected' : '')} onClick={() => setCategory(id)}>
            {CATEGORY_LABELS[id]} ({registry.search({ category: id }).length})
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <div className="empty-panel">
          <p>{t('modelcenter.empty')}</p>
        </div>
      ) : (
        <div className="model-cards">
          {entries.map((entry) => (
            <ModelCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCard({ entry }: { entry: ModelEntry }) {
  const { t } = useI18n();
  const controller = useStudio();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const runnableHere = controller.generationModels.some((m) => m.modelId === entry.id && m.capability === 'audio.tts');
  const canGenerate = controller.localGeneration && runnableHere;
  const generateTitle = generating
    ? t('modelcenter.generating')
    : !controller.localGeneration
      ? t(entry.verification.trust === 'verified' ? 'modelcenter.generate.disabled' : 'modelcenter.generate.disabled.unverified')
      : runnableHere
        ? t('modelcenter.generate.sample')
        : t('modelcenter.generate.disabled.capability');
  const generateSample = async (): Promise<void> => {
    setGenerating(true);
    setProgress(0);
    await controller.generateModelSample(entry.id, (p) => setProgress(p));
    setGenerating(false);
  };
  const installed = controller.installedModels.has(entry.id);
  const installing = controller.jobs.some((job) => job.kind === 'install' && job.desktopId === entry.id && (job.state === 'preparing' || job.state === 'running'));
  const installable = (entry.files?.length ?? 0) > 0;
  const install = async (): Promise<void> => {
    await controller.installModel(entry.id);
  };
  return (
    <article className="model-card">
      <div className="model-card-head">
        <span className="model-card-name">{entry.displayName}</span>
        <span className={'trust-badge trust-' + entry.verification.trust}>{entry.verification.trust}</span>
      </div>
      <p className="model-card-desc">{entry.description}</p>
      <div className="model-card-meta">
        <span className="model-chip">{t('modelcenter.capabilities')}: {entry.capabilities.join(', ')}</span>
        <span className="model-chip">{t('modelcenter.hardware')}: {entry.hardware.map((h) => h.platform + '/' + h.status).join(', ')}</span>
        <span className="model-chip">
          {t('modelcenter.license')}: {entry.license.name}
          {entry.license.note ? ' - ' + entry.license.note : ''}
        </span>
      </div>
      <div className="model-card-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={installed || installing || !installable || !controller.localGeneration}
          title={
            installed
              ? t('modelcenter.installed')
              : installing
                ? t('modelcenter.installing')
                : !installable
                  ? t('modelcenter.install.disabled.unverified')
                  : t('modelcenter.install.disabled')
          }
          onClick={() => void install()}
        >
          {installed ? t('modelcenter.installed') : installing ? t('modelcenter.installing') : t('modelcenter.install')}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={!canGenerate || generating}
          title={generateTitle}
          onClick={() => void generateSample()}
        >
          {generating ? t('modelcenter.generating') + ' ' + Math.round(progress * 100) + '%' : t('modelcenter.generate')}
        </button>
        <span className="model-card-evidence" title={entry.verification.evidence}>
          {entry.verification.evidence}
        </span>
      </div>
    </article>
  );
}
