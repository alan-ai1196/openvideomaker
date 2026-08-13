import { useRef, useState, type DragEvent, type ReactElement } from 'react';
import { usToSeconds } from '@openvideomaker/schema';
import type { AssetKind } from '@openvideomaker/schema';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';
import { Button } from './controls';
import { ModelCenter } from './ModelCenter';
import { AgentIcon, CaptionsIcon, FilmIcon, GridIcon, PersonIcon, ScriptIcon, SparkIcon, TranscriptIcon, TypeIcon, UploadIcon, WaveIcon } from './icons';
import { TranscriptPanel } from './TranscriptPanel';
import { CharacterPanel } from './CharacterPanel';
import { AgentPanel } from './AgentPanel';
import { ScriptPanel } from './ScriptPanel';
import type { MessageKey } from '../i18n/strings';

type PanelId = 'media' | 'text' | 'captions' | 'transcript' | 'script' | 'audio' | 'avatars' | 'ai' | 'agent' | 'templates';

const TABS: Array<{ id: PanelId; key: MessageKey; icon: (p: { className?: string }) => ReactElement }> = [
  { id: 'media', key: 'panel.media', icon: (p) => <FilmIcon {...p} /> },
  { id: 'text', key: 'panel.text', icon: (p) => <TypeIcon {...p} /> },
  { id: 'captions', key: 'panel.captions', icon: (p) => <CaptionsIcon {...p} /> },
  { id: 'transcript', key: 'panel.transcript', icon: (p) => <TranscriptIcon {...p} /> },
  { id: 'script', key: 'panel.script', icon: (p) => <ScriptIcon {...p} /> },
  { id: 'audio', key: 'panel.audio', icon: (p) => <WaveIcon {...p} /> },
  { id: 'avatars', key: 'panel.avatars', icon: (p) => <PersonIcon {...p} /> },
  { id: 'ai', key: 'panel.ai', icon: (p) => <SparkIcon {...p} /> },
  { id: 'agent', key: 'panel.agent', icon: (p) => <AgentIcon {...p} /> },
  { id: 'templates', key: 'panel.templates', icon: (p) => <GridIcon {...p} /> },
];

const KIND_LABEL: Record<AssetKind, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
  subtitle: 'Subtitle',
  data: 'Data',
};

export function LeftPanel() {
  const controller = useStudio();
  const { t } = useI18n();
  const [active, setActive] = useState<PanelId>('media');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assets = Object.values(controller.project.assets);

  const importFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      void controller.importMediaFile(file);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) importFiles(e.dataTransfer.files);
  };

  return (
    <aside className="leftpanel">
      <nav className="leftrail" aria-label={t('panel.media')}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={'rail-button' + (active === tab.id ? ' active' : '')}
            title={t(tab.key)}
            aria-label={t(tab.key)}
            aria-current={active === tab.id}
            onClick={() => setActive(tab.id)}
          >
            {tab.icon({})}
          </button>
        ))}
      </nav>
      <div
        className={'leftpanel-content' + (dragging ? ' drop-active' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <h2 className="panel-heading">{t(TABS.find((tab) => tab.id === active)!.key)}</h2>
        {active === 'media' ? (
          <>
            <Button
              variant="primary"
              icon={<UploadIcon />}
              label={t('panel.import')}
              onClick={() => {
                if (controller.capabilities.localPersistence) void controller.importDesktopMedia();
                else fileInputRef.current?.click();
              }}
            >
              {t('panel.import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*,image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) importFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {assets.length === 0 ? (
              <EmptyPanel text={t('panel.empty.media')} hint={t('panel.drop.hint')} />
            ) : (
              <ul className="asset-list">
                {assets.map((asset) => (
                  <li key={asset.id}>
                    <button
                      className="asset-item"
                      type="button"
                      title={t('panel.add.to.timeline')}
                      onClick={() => controller.addAssetToTimeline(asset.id)}
                    >
                      <span className={'asset-kind asset-kind-' + asset.kind}>{KIND_LABEL[asset.kind]}</span>
                      <span className="asset-name">{asset.name}</span>
                      {asset.media?.durationUs !== undefined && asset.media.durationUs > 0 ? (
                        <span className="asset-duration">{usToSeconds(asset.media.durationUs).toFixed(1)}s</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : active === 'transcript' ? (
          <TranscriptPanel />
        ) : active === 'script' ? (
          <ScriptPanel />
        ) : active === 'avatars' ? (
          <CharacterPanel />
        ) : active === 'ai' ? (
          <ModelCenter />
        ) : active === 'agent' ? (
          <AgentPanel />
        ) : (
          <EmptyPanel text={t('panel.empty.generic')} hint={t('panel.empty.hint')} />
        )}
      </div>
    </aside>
  );
}

function EmptyPanel({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="empty-panel">
      <p>{text}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
    </div>
  );
}
