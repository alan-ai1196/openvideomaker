import { describe, expect, it } from 'vitest';
import { extractKeywords, searchTranscript, tokenize } from '@openvideomaker/media';

describe('tokenize', () => {
  it('keeps meaningful latin words and drops stopwords', () => {
    const terms = tokenize('OpenVideoMaker keeps everything editable - the AI does its part.');
    expect(terms).toContain('openvideomaker');
    expect(terms).toContain('editable');
    expect(terms).toContain('keeps');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('does');
    expect(terms).not.toContain('its');
  });

  it('segments CJK text into character bigrams', () => {
    const terms = tokenize('今天天气很好');
    expect(terms).toEqual(['今天', '天天', '天气', '气很', '很好']);
  });
});

describe('extractKeywords', () => {
  it('ranks terms by mention count with segment times', () => {
    const segments = [
      { id: 's1', startUs: 0, endUs: 1_000_000, text: 'The forest scene is calm.' },
      { id: 's2', startUs: 1_000_000, endUs: 2_000_000, text: 'The ocean scene is wide.' },
      { id: 's3', startUs: 2_000_000, endUs: 3_000_000, text: 'A forest and a mountain.' },
    ];
    const keywords = extractKeywords(segments, { limit: 3 });
    expect(keywords[0]?.term).toBe('forest');
    expect(keywords[0]?.mentions).toBe(2);
    expect(keywords[0]?.atUs).toEqual([0, 2_000_000]);
    expect(keywords.some((k) => k.term === 'scene')).toBe(true);
  });
});

describe('searchTranscript', () => {
  it('ranks segments by query-term coverage and limits results', () => {
    const segments = [
      { id: 'a', startUs: 0, endUs: 1_000_000, text: 'The cat sits on the mat.' },
      { id: 'b', startUs: 1_000_000, endUs: 2_000_000, text: 'A dog runs.' },
      { id: 'c', startUs: 2_000_000, endUs: 3_000_000, text: 'The cat runs fast.' },
    ];
    const hits = searchTranscript(segments, 'cat runs');
    expect(hits.map((h) => h.segmentId)).toEqual(['c', 'a', 'b']);
    expect(hits[0]?.score).toBe(1);
    expect(hits[1]?.score).toBe(0.5);
    expect(hits[2]?.score).toBe(0.5);
    const limited = searchTranscript(segments, 'cat runs', { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('searches CJK bigrams', () => {
    const segments = [{ id: 'x', startUs: 0, endUs: 1_000_000, text: '今天天气很好' }];
    expect(searchTranscript(segments, '天气')[0]?.segmentId).toBe('x');
  });

  it('falls back to substring matching when the query has no indexable terms', () => {
    const segments = [{ id: 'y', startUs: 0, endUs: 1_000_000, text: 'OpenVideoMaker is the editor.' }];
    const hits = searchTranscript(segments, 'the');
    expect(hits[0]?.segmentId).toBe('y');
    expect(hits[0]?.score).toBe(0.5);
  });
});
