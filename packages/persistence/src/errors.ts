import { OvmError } from '@openvideomaker/core';

/** Persistence failures: stable codes, human messages, structured details. */
export class StoreError extends OvmError {
  constructor(
    code: 'store.version' | 'store.corrupt' | 'store.diverged' | 'store.busy' | 'store.empty' | 'store.not-a-project',
    message: string,
    details?: unknown,
  ) {
    super(code, message, details);
  }
}