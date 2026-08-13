import { OPERATION_TYPES } from '@openvideomaker/schema';
import { applyRegistry } from '@openvideomaker/core';
import { describe, expect, it } from 'vitest';

describe('apply registry coverage', () => {
  it('has an implementation for every declared operation type', () => {
    const missing = OPERATION_TYPES.filter((type) => !applyRegistry.has(type));
    expect(missing).toEqual([]);
  });
});