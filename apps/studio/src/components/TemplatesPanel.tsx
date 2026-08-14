import { PROJECT_TEMPLATES } from '@openvideomaker/core';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/strings';

/**
 * Templates: creation presets that build ORDINARY editable tracks,
 * settings and scripts through the core operation layer - nothing is
 * locked in, everything can be changed or undone afterwards.
 */
export function TemplatesPanel() {
  const controller = useStudio();
  const { t } = useI18n();
  return (
    <div className="template-list">
      <p className="panel-hint">{t('templates.hint')}</p>
      <section className="template-card">
        <header className="template-head">
          <span className="template-name">{t('templates.reframe')}</span>
        </header>
        <p className="template-desc">{t('templates.reframe.desc')}</p>
        <button
          type="button"
          className="button button-secondary template-reframe"
          title={t('templates.reframe')}
          onClick={() => controller.reframeToVertical()}
        >
          {t('templates.reframe')}
        </button>
      </section>
      {PROJECT_TEMPLATES.map((template) => (
        <section key={template.id} className="template-card">
          <header className="template-head">
            <span className="template-name">{t(('templates.' + template.id) as MessageKey)}</span>
          </header>
          <p className="template-desc">{t(('templates.' + template.id + '.desc') as MessageKey)}</p>
          <div className="template-meta">
            {template.settings.width}x{template.settings.height} &middot; {template.tracks.map((track) => track.name).join(' + ')}
          </div>
          <button
            type="button"
            className="button button-secondary"
            title={t('templates.apply')}
            onClick={() => controller.applyTemplate(template.id)}
          >
            {t('templates.apply')}
          </button>
        </section>
      ))}
    </div>
  );
}
