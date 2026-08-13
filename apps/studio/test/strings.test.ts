import { describe, expect, it } from 'vitest';
import { messages, type MessageKey } from '../src/i18n/strings';

describe('i18n dictionaries', () => {
  it('covers every key in both languages', () => {
    const en = messages.en;
    const zh = messages['zh-CN'];
    const keys = Object.keys(en) as MessageKey[];
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      expect(typeof zh[key]).toBe('string');
      expect((zh[key] as string).length).toBeGreaterThan(0);
    }
  });

  it('keeps the app name a proper noun in both languages', () => {
    expect(messages.en['app.name']).toBe('OpenVideoMaker Studio');
    expect(messages['zh-CN']['app.name']).toBe('OpenVideoMaker Studio');
  });
});
