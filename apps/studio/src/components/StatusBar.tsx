import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { formatTimecode } from '../timeline/math';

export function StatusBar() {
  const controller = useStudio();
  const { t } = useI18n();
  const fps = controller.project.settings.fps;
  return (
    <footer className="statusbar">
      <span className={'status-dot' + (controller.lastError ? ' status-dot-error' : '')} />
      <span>{controller.lastError ? controller.lastError.code : t('statusbar.ready')}</span>
      <span className="statusbar-spacer" />
      <span>
        {t('statusbar.checkpoint')} {controller.checkpoint}
      </span>
      <span className="statusbar-sep">·</span>
      <span>
        {t('statusbar.zoom')} {Math.round(controller.zoomPxPerSec)}px/s
      </span>
      <span className="statusbar-sep">·</span>
      <span>{formatTimecode(controller.playheadUs, fps)}</span>
    </footer>
  );
}
