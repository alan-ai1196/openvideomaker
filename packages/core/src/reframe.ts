import type { ClipId, SequenceId } from '@openvideomaker/schema';
import { ProjectSession } from './session.js';

/**
 * Reframe the active sequence to a vertical composition: sets the
 * project size to WxH (default 1080x1920) and center-crops every media
 * clip with known source dimensions to the new aspect ratio - the
 * classic 16:9 to 9:16 transformation, one undoable transaction over
 * ordinary clip.crop operations. Clips without dimensions (and clips
 * already matching the target aspect) are left untouched.
 */
export interface ReframeToVerticalOptions {
  sequenceId?: SequenceId;
  width?: number;
  height?: number;
}

export interface ReframeToVerticalResult {
  sequenceId: SequenceId;
  reframedClips: number;
}

export function reframeToVertical(session: ProjectSession, options: ReframeToVerticalOptions = {}): ReframeToVerticalResult | null {
  const sequenceId = (options.sequenceId ?? session.project.activeSequenceId ?? (Object.keys(session.project.sequences)[0] as SequenceId | undefined)) as SequenceId | undefined;
  if (!sequenceId) return null;
  const sequence = session.project.sequences[sequenceId];
  if (!sequence) return null;
  const targetW = options.width ?? 1080;
  const targetH = options.height ?? 1920;
  const targetAspect = targetW / targetH;
  const crops: Array<{ clipId: ClipId; crop: { left: number; top: number; right: number; bottom: number } }> = [];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== 'media') continue;
      const media = session.project.assets[clip.assetId]?.media;
      const w = media?.width;
      const h = media?.height;
      if (!w || !h) continue;
      const srcAspect = w / h;
      if (Math.abs(srcAspect - targetAspect) < 0.02) continue;
      const crop = { left: 0, top: 0, right: 0, bottom: 0 };
      if (srcAspect > targetAspect) {
        // Wider than target: crop the sides.
        const kept = targetAspect / srcAspect;
        crop.left = (1 - kept) / 2;
        crop.right = crop.left;
      } else {
        // Taller than target: crop top and bottom.
        const kept = srcAspect / targetAspect;
        crop.top = (1 - kept) / 2;
        crop.bottom = crop.top;
      }
      crops.push({ clipId: clip.id, crop });
    }
  }
  session.transaction((tx) => {
    tx.setProjectSettings({ settings: { width: targetW, height: targetH } });
    for (const entry of crops) {
      tx.setClipCrop({ sequenceId, clipId: entry.clipId, crop: entry.crop });
    }
  });
  return { sequenceId, reframedClips: crops.length };
}
