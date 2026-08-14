import { useState } from 'react';
import { useStudio } from '../studio/context';
import { useI18n } from '../i18n/context';

/**
 * Device Center: the probed device graph (same logic as ovm doctor),
 * friendly first - a plain statement of what this computer can do,
 * details behind progressive disclosure. The raw report is available
 * for developers, never the default.
 */
export function DeviceCenter() {
  const controller = useStudio();
  const { t } = useI18n();
  const [cleaning, setCleaning] = useState(false);
  const report = controller.deviceReport;
  const storage = controller.storageReport;
  if (!report) {
    return (
      <div className="empty-panel">
        <p>{t('devices.empty')}</p>
        <p className="empty-hint">{t('devices.empty.hint')}</p>
      </div>
    );
  }
  const graph = report.graph;
  const gpuReady = graph.gpus.length > 0;
  const headline = gpuReady ? t('devices.ready.gpu') : t('devices.ready.edit');
  const giB = (bytes: number | undefined): string => (bytes === undefined ? '' : (bytes / 1024 ** 3).toFixed(1) + ' GB');
  return (
    <div className="device-list">
      <p className="device-headline">{headline}</p>
      <section className="device-card">
        <h3 className="device-section">{t('devices.section.computer')}</h3>
        <div className="device-rows">
          <DeviceRow label={t('devices.os')} value={graph.os.platform + ' ' + graph.os.release + ' (' + graph.os.arch + ')'} />
          <DeviceRow label={t('devices.cpu')} value={graph.os.cpuModel + ' - ' + graph.os.logicalCores + ' cores'} />
          <DeviceRow label={t('devices.memory')} value={giB(graph.os.totalMemoryBytes)} />
          {graph.gpus.map((gpu, i) => (
            <DeviceRow
              key={i}
              label={t('devices.gpu')}
              value={gpu.name + (gpu.vramBytes !== undefined ? ' - ' + giB(gpu.vramBytes) + ' VRAM' : '') + (gpu.driverVersion ? ' - driver ' + gpu.driverVersion : '') + (gpu.cudaVersion ? ' - CUDA ' + gpu.cudaVersion : '')}
            />
          ))}
        </div>
      </section>
      <section className="device-card">
        <h3 className="device-section">{t('devices.section.encoding')}</h3>
        <div className="device-rows">
          <DeviceRow label="ffmpeg" value={graph.ffmpegVersion ?? t('devices.notfound')} />
          <DeviceRow
            label={t('devices.encoders')}
            value={graph.encoders.length > 0 ? graph.encoders.map((e) => e.name + (e.hardware ? ' (HW)' : '')).join(', ') : t('devices.notfound')}
          />
        </div>
      </section>
      {graph.runtimes.length > 0 ? (
        <section className="device-card">
          <h3 className="device-section">{t('devices.section.runtimes')}</h3>
          <div className="device-rows">
            {graph.runtimes.map((runtime) => (
              <DeviceRow key={runtime.name} label={runtime.name} value={runtime.version + ' (' + runtime.command + ')'} />
            ))}
          </div>
        </section>
      ) : null}
      {report.recommendations.length > 0 ? (
        <section className="device-card">
          <h3 className="device-section">{t('devices.section.recommendations')}</h3>
          <ul className="device-notes">
            {report.recommendations.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {graph.warnings.length > 0 ? (
        <section className="device-card">
          <h3 className="device-section">{t('devices.section.warnings')}</h3>
          <ul className="device-notes device-notes-warn">
            {graph.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <details className="device-advanced">
        <summary>{t('devices.raw')}</summary>
        <pre className="device-report">{report.report}</pre>
      </details>
      {storage && controller.capabilities.localGeneration ? (
        <section className="device-card">
          <h3 className="device-section">{t('devices.section.storage')}</h3>
          <div className="device-rows">
            {storage.models.map((model) => (
              <DeviceRow key={model.modelId} label={model.modelId} value={formatBytes(model.bytes)} />
            ))}
            {storage.runtimes.map((runtime) => (
              <DeviceRow key={runtime.name} label={t('devices.storage.runtime') + ' ' + runtime.name} value={formatBytes(runtime.bytes)} />
            ))}
            <DeviceRow label={t('devices.storage.generated')} value={formatBytes(storage.generated.bytes) + ' (' + storage.generated.files + ')'} />
            <DeviceRow label={t('devices.storage.partials')} value={formatBytes(storage.partials.bytes)} />
            <DeviceRow label={t('devices.storage.total')} value={formatBytes(storage.totalBytes)} />
          </div>
          <button
            type="button"
            className="button button-secondary device-clean"
            disabled={cleaning || storage.partials.bytes === 0}
            title={t('devices.storage.clean.hint')}
            onClick={() => {
              setCleaning(true);
              void controller.cleanInterruptedDownloads().finally(() => setCleaning(false));
            }}
          >
            {t('devices.storage.clean')}
          </button>
        </section>
      ) : null}
            {controller.capabilities.localPersistence ? (
        <section className="device-card">
          <h3 className="device-section">{t('devices.section.developer')}</h3>
          {controller.projectDir ? (
            <div className="device-mcp">
              <p className="device-mcp-hint">{t('devices.mcp.hint')}</p>
              <code className="device-mcp-command">ovm mcp --project "{controller.projectDir}"</code>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void navigator.clipboard?.writeText('ovm mcp --project "' + controller.projectDir + '"')}
              >
                {t('devices.mcp.copy')}
              </button>
            </div>
          ) : (
            <p className="device-mcp-hint">{t('devices.mcp.unsaved')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** Human-friendly byte formatting (KB/MB/GB, one decimal). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function DeviceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="device-row">
      <span className="device-label">{label}</span>
      <span className="device-value">{value}</span>
    </div>
  );
}