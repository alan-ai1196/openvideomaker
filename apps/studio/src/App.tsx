import { useEffect } from 'react';
import { StudioProvider, useStudio } from './studio/context';
import { I18nProvider, useI18n } from './i18n/context';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/controls';

export default function App() {
  return (
    <I18nProvider>
      <StudioProvider>
        <Studio />
      </StudioProvider>
    </I18nProvider>
  );
}

function Studio() {
  const controller = useStudio();
  const { t } = useI18n();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      if (typing) return;

      if (e.code === 'Space') {
        e.preventDefault();
        controller.togglePlay();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        controller.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        controller.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        controller.redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const clipId = controller.selectedClipId;
        if (!clipId) return;
        e.preventDefault();
        if (e.shiftKey) {
          const sequenceId = controller.activeSequence()?.id;
          if (sequenceId) {
            controller.mutate((tx) => tx.removeClip({ sequenceId, clipId }));
            controller.selectClip(null);
          }
        } else {
          controller.rippleDeleteSelected();
        }
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        if (controller.selectedClipId) {
          e.preventDefault();
          controller.splitSelectedAtPlayhead();
        }
        return;
      }
      if (e.key === 'Escape') {
        controller.selectClip(null);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        controller.setPlayhead(0);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        controller.zoomBy(1.25);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        controller.zoomBy(1 / 1.25);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);

  return (
    <div className="studio">
      <TopBar />
      <LeftPanel />
      <Preview />
      <Inspector />
      <Timeline />
      <StatusBar />
      {controller.lastError ? (
        <Toast
          title={t('toast.error.title')}
          message={controller.lastError.message + '. ' + t('toast.error.hint')}
          code={controller.lastError.code}
          onDismiss={() => controller.clearError()}
        />
      ) : null}
    </div>
  );
}
