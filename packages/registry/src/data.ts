import whisper from './data/whisper-large-v3.json';
import paraformer from './data/paraformer-zh.json';
import kokoro from './data/kokoro-tts.json';
import latentsync from './data/latentsync.json';
import musetalk from './data/musetalk.json';
import rmbg from './data/rmbg.json';
import ltx from './data/ltx-video.json';
import wan from './data/wan-video.json';
import flux from './data/flux-schnell.json';

/**
 * The bundled registry data (single source of truth, version-controlled).
 * Imported by both the Studio bundle and Node tooling.
 */
export const MODEL_ENTRIES: unknown[] = [
  whisper,
  paraformer,
  kokoro,
  latentsync,
  musetalk,
  rmbg,
  ltx,
  wan,
  flux,
];
