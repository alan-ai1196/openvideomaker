/**
 * Media intelligence Level 3 (honest lexical subset): transcript
 * search and keyword topics. Deterministic and model-free - latin
 * words plus CJK character bigrams, term-frequency ranking with
 * stopword filtering. A future embedding-based scorer can replace
 * these scorers behind the same result shapes; nothing here claims
 * semantic understanding.
 */

export interface TranscriptSegmentLike {
  id?: string;
  startUs: number;
  endUs: number;
  text: string;
}

export interface TopicKeyword {
  term: string;
  /** Number of segments mentioning the term. */
  mentions: number;
  /** Segment start times (asset space) where the term appears. */
  atUs: number[];
}

export interface SearchHit {
  segmentId: string | null;
  startUs: number;
  endUs: number;
  text: string;
  /** Fraction of the query's tokens found in this segment (0-1). */
  score: number;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'its', 'that', 'this', 'these', 'those',
  'we', 'you', 'i', 'he', 'she', 'they', 'them', 'their', 'my', 'your', 'our', 'me', 'him', 'her', 'us',
  'for', 'on', 'with', 'as', 'at', 'by', 'be', 'was', 'are', 'were', 'been', 'being', 'not', 'no', 'but', 'so',
  'if', 'then', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
  'what', 'when', 'where', 'who', 'how', 'why', 'there', 'here', 'the', 'all', 'any', 'some', 'from', 'into', 'about',
]);

const LATIN_RUN = /[a-z0-9']{2,}/g;
const CJK_RUN = /[\u3040-\u30ff\u3400-\u9fff]{2,}/g;

/**
 * Tokenize text into search terms: lowercase latin words (minus
 * stopwords) and CJK character bigrams, which is the standard
 * model-free segmentation for Chinese/Japanese text.
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const terms: string[] = [];
  for (const match of lower.matchAll(LATIN_RUN)) {
    if (!STOPWORDS.has(match[0])) terms.push(match[0]);
  }
  for (const run of lower.matchAll(CJK_RUN)) {
    const chars = run[0];
    for (let i = 0; i < chars.length - 1; i += 1) terms.push(chars.slice(i, i + 2));
  }
  return terms;
}

export interface ExtractKeywordsOptions {
  limit?: number;
}

/**
 * Frequency-ranked keyword topics over transcript segments: the top
 * terms by mention count, with the segment times they appear at.
 */
export function extractKeywords(segments: TranscriptSegmentLike[], options: ExtractKeywordsOptions = {}): TopicKeyword[] {
  const limit = options.limit ?? 8;
  const byTerm = new Map<string, { mentions: number; atUs: number[] }>();
  for (const segment of segments) {
    const seen = new Set<string>();
    for (const term of tokenize(segment.text)) {
      if (seen.has(term)) continue;
      seen.add(term);
      const entry = byTerm.get(term) ?? { mentions: 0, atUs: [] };
      entry.mentions += 1;
      entry.atUs.push(segment.startUs);
      byTerm.set(term, entry);
    }
  }
  return [...byTerm.entries()]
    .map(([term, entry]) => ({ term, mentions: entry.mentions, atUs: entry.atUs.sort((a, b) => a - b) }))
    .sort((a, b) => b.mentions - a.mentions || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export interface SearchTranscriptOptions {
  limit?: number;
}

/**
 * Rank transcript segments by token overlap with the query. When the
 * query carries no indexable tokens (e.g. all stopwords), it falls
 * back to a case-insensitive substring match so searching never
 * silently returns nothing.
 */
export function searchTranscript(segments: TranscriptSegmentLike[], query: string, options: SearchTranscriptOptions = {}): SearchHit[] {
  const limit = options.limit ?? 10;
  const queryTerms = tokenize(query);
  const hits: SearchHit[] = [];
  for (const segment of segments) {
    let score = 0;
    if (queryTerms.length > 0) {
      const terms = new Set(tokenize(segment.text));
      const found = queryTerms.filter((term) => terms.has(term)).length;
      score = found / queryTerms.length;
    } else if (query.trim().length > 0 && segment.text.toLowerCase().includes(query.trim().toLowerCase())) {
      score = 0.5;
    }
    if (score > 0) hits.push({ segmentId: segment.id ?? null, startUs: segment.startUs, endUs: segment.endUs, text: segment.text, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.startUs - b.startUs).slice(0, limit);
}
