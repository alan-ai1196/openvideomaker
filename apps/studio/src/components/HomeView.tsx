import { useEffect } from 'react';
import { PROJECT_TEMPLATES, type TemplateId } from '@openvideomaker/core';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/strings';

/**
 * Home: the first screen - what do you want to make? Recent projects
 * (desktop), the five templates, import media, and a way back to the
 * editor. Everything here is an ordinary action over the same project;
 * nothing is a locked mode.
 */
export function HomeView({ onClose }: { onClose: () => void }) {
  const controller = useStudio();
  const { t } = useI18n();
  // Recents are fetched at startup too, but re-fetch when the home
  // opens so a save moments ago shows up immediately.
  useEffect(() => {
    void controller.refreshRecents();
  }, [controller]);
  const applyTemplate = (templateId: TemplateId): void => {
    controller.applyTemplate(templateId);
    onClose();
  };
  return (
    <div className="home-view">
      <div className="home-inner">
        <h1 className="home-title">OpenVideoMaker</h1>
        <p className="home-subtitle">{t('home.subtitle')}</p>
        <div className="home-grid">
          <section className="home-card home-recents">
            <h2 className="home-section">{t('home.recents')}</h2>
            {controller.recents.length > 0 ? (
              <ul className="home-recent-list">
                {controller.recents.map((recent) => (
                  <li key={recent.dir}>
                    <button type="button" className="home-recent" onClick={() => void controller.openRecentProject(recent.dir).then((result) => { if (result.ok) onClose(); })}>
                      <span className="home-recent-name">{recent.name}</span>
                      <span className="home-recent-dir">{recent.dir}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="home-hint">{t('home.recents.hint')}</p>
            )}
          </section>
          <section className="home-card">
            <h2 className="home-section">{t('home.templates')}</h2>
            <div className="home-template-grid">
              {PROJECT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="home-template"
                  onClick={() => applyTemplate(template.id)}
                >
                  <span className="home-template-name">{t(('templates.' + template.id) as MessageKey)}</span>
                  <span className="home-template-size">{template.settings.width}x{template.settings.height}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="home-actions">
          {controller.capabilities.localPersistence ? (
            <button type="button" className="button button-primary" onClick={() => void controller.importDesktopMedia().then(() => onClose())}>
              {t('home.import')}
            </button>
          ) : null}
          <button type="button" className="button button-secondary" onClick={onClose}>
            {t('home.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
