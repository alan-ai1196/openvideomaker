import type { ModelEntry } from './schema';

/**
 * The capability catalog: what upper layers (UI, MCP, agents) ask for.
 * Models never appear here; entries reference these ids. Input/output
 * kinds use media-oriented vocabulary, not framework vocabulary.
 */
export interface Capability {
  id: string;
  label: string;
  category: ModelEntry['category'];
  inputs: string[];
  outputs: string[];
}

export const CAPABILITIES: Capability[] = [
  { id: 'audio.asr', label: 'Speech to text', category: 'speech', inputs: ['audio'], outputs: ['transcript'] },
  { id: 'audio.tts', label: 'Text to speech', category: 'speech', inputs: ['text'], outputs: ['audio'] },
  { id: 'avatar.lip_sync', label: 'Lip sync', category: 'lip-sync', inputs: ['video', 'audio'], outputs: ['video'] },
  { id: 'video.text_to_video', label: 'Text to video', category: 'video-generation', inputs: ['prompt'], outputs: ['video'] },
  { id: 'image.generate', label: 'Image generation', category: 'images', inputs: ['prompt'], outputs: ['image'] },
  { id: 'media.background_remove', label: 'Background removal', category: 'enhancement', inputs: ['image'], outputs: ['image'] },
  { id: 'video.upscale', label: 'Upscale', category: 'enhancement', inputs: ['image'], outputs: ['image'] },
];

export const CATEGORY_LABELS: Record<ModelEntry['category'], string> = {
  speech: 'Speech',
  'lip-sync': 'Lip Sync',
  'video-generation': 'Video Generation',
  images: 'Images',
  enhancement: 'Enhancement',
};

export function capabilityById(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}
