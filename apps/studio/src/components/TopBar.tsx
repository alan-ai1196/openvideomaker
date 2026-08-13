import { useRef, useState } from 'react';
import { ProjectSchema } from '@openvideomaker/schema';
import { StudioController } from '../studio/controller';
import { useStudio, useStudioReplace } from '../studio/context';
import { useI18n } from '../i18n/context';
import { Button, IconButton, Kbd } from './controls';
import { DownloadIcon, KeyboardIcon, MoonIcon, PauseIcon, PlayIcon, RedoIcon, SkipStartIcon, SunIcon, UndoIcon, UploadIcon } from './icons';
import { formatTimecode } from '../timeline/math';
import { useTheme } from '../theme';

export function TopBar() {
  const controller = useStudio();
  const replace = useStudioReplace();
  const { t, language, setLanguage } = useI18n();
  const [theme, setTheme] = useTheme();
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const project = controller.project;
  const fps = project.settings.fps;

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== project.name) {
      controller.mutate((tx) => tx.renameProject({ name }));
    }
    setEditingName(false);
  };

  const saveFile = () => {
    const blob = new Blob([controller.exportProject()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (project.name || 'project').replace(/[^\w-]+/g, '_') + '.ovm.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as { project?: unknown; log?: unknown };
      const parsed = ProjectSchema.parse(data.project);
      const log = Array.isArray(data.log) ? data.log : [];
      replace(StudioController.open(parsed, log as never));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      controller.reportError('Could not open project: ' + message, 'schema.parse');
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <rect x="6" y="6" width="20" height="13" rx="2.5" stroke="#0d1420" strokeWidth="2.2" />
            <path d="M13.5 10.5l6 3-6 3z" fill="#0d1420" />
            <rect x="6" y="22" width="9" height="3" rx="1.5" fill="#0d1420" />
            <rect x="17" y="22" width="9" height="3" rx="1.5" fill="#fff" />
          </svg>
        </span>
        {editingName ? (
          <input
            className="project-name-input"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
            aria-label={t('project.rename')}
          />
        ) : (
          <button
            className="project-name"
            type="button"
            title={t('project.rename')}
            onDoubleClick={() => {
              setDraftName(project.name);
              setEditingName(true);
            }}
          >
            {project.name}
          </button>
        )}
      </div>

      <div className="topbar-transport">
        <IconButton icon={<SkipStartIcon />} label={t('shortcuts.home')} onClick={() => controller.setPlayhead(0)} />
        <IconButton
          className="transport-play"
          icon={controller.playing ? <PauseIcon /> : <PlayIcon />}
          label={t('topbar.play')}
          onClick={() => controller.togglePlay()}
        />
        <span className="transport-time">{formatTimecode(controller.playheadUs, fps)}</span>
      </div>

      <div className="topbar-actions">
        <IconButton icon={<UndoIcon />} label={t('topbar.undo')} disabled={!controller.canUndo} onClick={() => controller.undo()} />
        <IconButton icon={<RedoIcon />} label={t('topbar.redo')} disabled={!controller.canRedo} onClick={() => controller.redo()} />
        <span className="topbar-sep" />
        <IconButton icon={<DownloadIcon />} label={t('topbar.save')} onClick={saveFile} />
        <IconButton icon={<UploadIcon />} label={t('topbar.open')} onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = '';
          }}
        />
        <IconButton icon={<KeyboardIcon />} label={t('topbar.shortcuts')} onClick={() => setShowShortcuts(true)} />
        <select
          className="language-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as 'en' | 'zh-CN')}
          aria-label={t('topbar.language')}
        >
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
        <IconButton icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />} label={t('topbar.theme')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <Button variant="primary" label={t('topbar.export')} disabled title={t('topbar.export.disabled')}>
          {t('topbar.export')}
        </Button>
      </div>

      {showShortcuts ? <ShortcutsPopover onClose={() => setShowShortcuts(false)} /> : null}
    </header>
  );
}

function ShortcutsPopover({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const rows: Array<[string, string]> = [
    [t('shortcuts.play'), 'Space'],
    [t('shortcuts.undo'), 'Ctrl+Z'],
    [t('shortcuts.redo'), 'Ctrl+Shift+Z'],
    [t('shortcuts.delete'), 'Del'],
    [t('shortcuts.deselect'), 'Esc'],
    [t('shortcuts.home'), 'Home'],
    [t('shortcuts.zoom'), '+ / -'],
  ];
  return (
    <div className="popover-backdrop" onClick={onClose}>
      <div className="popover" role="dialog" aria-label={t('shortcuts.title')} onClick={(e) => e.stopPropagation()}>
        <div className="popover-title">{t('shortcuts.title')}</div>
        {rows.map(([label, keys]) => (
          <div className="popover-row" key={label}>
            <span>{label}</span>
            <Kbd>{keys}</Kbd>
          </div>
        ))}
        <button className="button button-primary" type="button" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
