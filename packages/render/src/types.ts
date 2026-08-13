/** Render failures: stable codes, human messages, structured details. */
export class RenderError extends Error {
  readonly code: 'render.no-sequence' | 'render.missing-source' | 'render.exec-failed' | 'render.cancelled';
  readonly details?: unknown;
  constructor(code: RenderError['code'], message: string, details?: unknown) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.details = details;
  }
}