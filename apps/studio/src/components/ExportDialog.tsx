import { useState } from 'react';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/strings';
import { Button } from './controls';

export interface ExportPreset {
  id: 'source' | '1080p' | 'vertical' | 'square';
  width: number;
  height: number;
}

export function exportPresets(projectWidth: number, projectHeight: number): ExportPreset[] {
  return [
    { id: '1080p', width: 1920, height: 1080 },
    { id: 'vertical', width: 1080, height: 1920 },
    { id: 'square', width: 1080, height: 1080 },
    { id: 'source', width: projectWidth, height: projectHeight },
  ];
}

interface ExportDialogProps {
  onClose: () => void;
}

/**
 * Export dialog: simple presets first, advanced details later (goal 93).
 * In browser mode the dialog is honest: it prepares the project for the
 * local renderer instead of pretending to encode inside the page.
 */
export function ExportDialog({ onClose }: ExportDialogProps) {
  const controller = useStudio();
  const { t } = useI18n();
  const project = controller.project;
  const presets = exportPresets(project.settings.width, project.settings.height);
  const [presetId, setPresetId] = useState<ExportPreset['id']>('1080p');
  const [quality, setQuality] = useState<'draft' | 'balanced' | 'high'>('balanced');
  const [renderState, setRenderState] = useState<{ state: string; progress: number } | null>(null);
  const [renderedPath, setRenderedPath] = useState<string | null>(null);
  const localRender = controller.capabilities.localRender;
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;
  const fileName = (project.name || 'project').replace(/[^\w-]+/g, '_');

  const command = 'ovm-render ' + fileName + '.ovm.json -o ' + fileName + '.mp4 --preset ' + preset.id + ' --quality ' + quality;

  const renderLocal = async (): Promise<void> => {
    setRenderedPath(null);
    setRenderState({ state: 'preparing', progress: 0 });
    const result = await controller.renderDesktop(
      { width: preset.width, height: preset.height, quality },
      (progress) => setRenderState({ state: progress.state, progress: progress.progress }),
    );
    if (result.ok && result.outputPath) setRenderedPath(result.outputPath);
    setRenderState(null);
  };

  const downloadProject = () => {
    const blob = new Blob([controller.exportProject()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName + '.ovm.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="popover-backdrop" onClick={onClose}>
      <div className="export-dialog" role="dialog" aria-label={t('export.title')} onClick={(e) => e.stopPropagation()}>
        <div className="popover-title">{t('export.title')}</div>

        <div className="export-section-label">{t('export.preset')}</div>
        <div className="export-presets">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={'export-preset' + (presetId === p.id ? ' selected' : '')}
              onClick={() => setPresetId(p.id)}
            >
              <span className="export-preset-name">{t(('export.preset.' + p.id) as MessageKey)}</span>
              <span className="export-preset-size">{p.width} × {p.height}</span>
            </button>
          ))}
        </div>

        <div className="export-section-label">{t('export.quality')}</div>
        <div className="export-qualities">
          {(['draft', 'balanced', 'high'] as const).map((q) => (
            <button key={q} type="button" className={'export-quality' + (quality === q ? ' selected' : '')} onClick={() => setQuality(q)}>
              {t(('export.quality.' + q) as MessageKey)}
            </button>
          ))}
        </div>

        {localRender ? (
          <div className="export-note">
            <strong>{renderState ? t('export.rendering') : t('export.render.local')}</strong>
            {renderState ? (
              <div className="export-progress">
                <div className="export-progress-bar" style={{ width: Math.round(renderState.progress * 100) + '%' }} />
              </div>
            ) : null}
            {renderedPath ? <p>{t('export.rendered')}: <code>{renderedPath}</code></p> : null}
          </div>
        ) : (
          <div className="export-note">
            <strong>{t('export.browser.title')}</strong>
            <p>{t('export.browser.hint')}</p>
            <code className="export-command">{command}</code>
          </div>
        )}

        <div className="export-actions">
          <Button label={t('export.cancel')} onClick={onClose}>
            {t('export.cancel')}
          </Button>
          {localRender ? (
            <Button variant="primary" label={t('export.render')} disabled={renderState !== null} onClick={() => void renderLocal()}>
              {t('export.render')}
            </Button>
          ) : null}
          <Button variant={localRender ? 'ghost' : 'primary'} label={t('export.download')} onClick={downloadProject}>
            {t('export.download')}
          </Button>
        </div>
      </div>
    </div>
  );
}
