import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/strings';

/**
 * Job Center: every long-running unit of work is visible here - the
 * same job shape for generation and rendering, with progress, state
 * and cancellation. A failed or cancelled job never touches the
 * project; results always arrive through the typed operation layer.
 */
export function JobCenter() {
  const controller = useStudio();
  const { t } = useI18n();
  const jobs = controller.jobs;
  if (jobs.length === 0) {
    return (
      <div className="empty-panel">
        <p>{t('jobs.empty')}</p>
        <p className="empty-hint">{t('jobs.empty.hint')}</p>
      </div>
    );
  }
  return (
    <div className="job-list">
      {jobs.map((job) => {
        const running = job.state === 'preparing' || job.state === 'running';
        return (
          <section key={job.id} className={'job-card job-' + job.state}>
            <header className="job-head">
              <span className="job-label">{job.label}</span>
              <span className="job-state">{t(('jobs.state.' + job.state) as MessageKey)}</span>
            </header>
            {running ? (
              <div className="job-progress" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="job-progress-bar" style={{ width: Math.round(job.progress * 100) + '%' }} />
              </div>
            ) : null}
            {job.error ? <p className="job-error">{job.error}</p> : null}
            <footer className="job-foot">
              <span className="job-kind">{job.kind === 'generate' ? 'AI' : job.kind === 'render' ? 'Render' : 'Install'}</span>
              {running ? (
                <button type="button" className="button button-secondary" onClick={() => controller.cancelJob(job.id)}>
                  {t('jobs.cancel')}
                </button>
              ) : null}
            </footer>
          </section>
        );
      })}
    </div>
  );
}