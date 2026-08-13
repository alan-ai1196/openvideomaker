import { createInterface } from 'node:readline';
import { frame, type FileRef, type HostRequest, type RunnerEvent } from './protocol.js';

export interface RunnerHandlers {
  describe: () => Promise<{ protocolVersion: 1; capabilities: string[]; models?: string[]; runner: { name: string; version: string } }> | { protocolVersion: 1; capabilities: string[]; models?: string[]; runner: { name: string; version: string } };
  prepare?: (params: unknown) => Promise<{ estimate?: { seconds?: number; note?: string } }> | { estimate?: { seconds?: number; note?: string } };
  execute: (params: unknown, events: { progress: (event: Omit<RunnerEvent, 'kind'> & { kind: 'progress' }) => void; log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void }) => Promise<{ outputs: Record<string, FileRef>; metadata?: Record<string, unknown> }> | { outputs: Record<string, FileRef>; metadata?: Record<string, unknown> };
  health?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

/**
 * Reference runner-side helper for Node-based runners. Runners in other
 * languages implement the same NDJSON contract by hand (see
 * docs/architecture/MODEL_RUNTIME.md); the wire format is the contract,
 * not this helper.
 */
export function serveRunner(handlers: RunnerHandlers): void {
  const write = (message: unknown): void => {
    process.stdout.write(frame(message));
  };
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let request: HostRequest;
    try {
      request = JSON.parse(line) as HostRequest;
    } catch {
      write({ id: null, ok: false, error: { code: 'protocol', message: 'unparseable request' } });
      return;
    }
    void (async () => {
      try {
        switch (request.method) {
          case 'describe':
            write({ id: request.id, ok: true, ...(await handlers.describe()) });
            break;
          case 'prepare':
            write({ id: request.id, ok: true, ...(await handlers.prepare?.(request.params)) });
            break;
          case 'execute':
            write({
              id: request.id,
              ok: true,
              ...(await handlers.execute(request.params, {
                progress: (event) => write(event),
                log: (level, message) => write({ kind: 'log', level, message }),
              })),
            });
            break;
          case 'health':
            write({ id: request.id, ok: true, ...(await handlers.health?.()) });
            break;
          case 'cancel':
            write({ kind: 'cancelled' });
            break;
          case 'dispose':
            write({ id: request.id, ok: true });
            break;
        }
      } catch (err) {
        write({ id: request.id, ok: false, error: { code: 'runner.failed', message: err instanceof Error ? err.message : String(err) } });
      }
    })();
  });
}
