import { describe, expect, it } from 'vitest';
import { runModels, runOvm } from '@openvideomaker/cli';

function capture(fn: () => void): { out: string; err: string } {
  const logs: string[] = [];
  const errs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line: string) => logs.push(line);
  console.error = (line: string) => errs.push(line);
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { out: logs.join('\n'), err: errs.join('\n') };
}

describe('ovm models', () => {
  it('lists all registry models with trust states', () => {
    const { out } = capture(() => runModels(['list']));
    const entries = JSON.parse(out) as Array<{ id: string; trust: string }>;
    expect(entries.length).toBe(9);
    expect(entries.filter((e) => e.trust === 'verified').map((e) => e.id)).toEqual([
      'hf/hexgrad/Kokoro-82M',
      'hf/bytedance/latentsync-1.5',
      'ms/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
      'hf/openai/whisper-large-v3',
    ]);
  });

  it('searches by capability and query', () => {
    const { out } = capture(() => runModels(['search', '--capability', 'audio.asr']));
    const entries = JSON.parse(out) as Array<{ id: string }>;
    expect(entries.map((e) => e.id)).toContain('hf/openai/whisper-large-v3');
    const { out: out2 } = capture(() => runModels(['search', 'whisper']));
    expect(JSON.parse(out2)[0].id).toBe('hf/openai/whisper-large-v3');
  });

  it('shows usage for unknown subcommands', () => {
    const { err } = capture(() => runModels(['bogus']));
    expect(err).toContain('usage: ovm models');
  });
});

describe('ovm dispatch', () => {
  it('rejects unknown top-level commands with exit code 2', async () => {
    const code = await runOvm(['bogus']);
    expect(code).toBe(2);
  });

  it('runs models through the dispatch', async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => logs.push(line);
    try {
      const code = await runOvm(['models', 'list']);
      expect(code).toBe(0);
    } finally {
      console.log = original;
    }
  });
});
