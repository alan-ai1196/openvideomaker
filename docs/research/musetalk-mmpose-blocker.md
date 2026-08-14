# MuseTalk adapter: blocked on mmpose/chumpy (Windows py3.12, isolated runtimes)

## Problem

Add a second avatar.lip_sync runner (MuseTalk v1.5) behind the same
capability, following the LatentSync adapter pattern.

## Evidence

- Inspected upstream (TMElyralab/MuseTalk @ main): the v1.5 inference path
  (scripts/inference.py) calls get_landmark_and_bbox, which extracts
  landmarks with mmpose (rtmpose wholebody) and bounding boxes with
  face_alignment (SFD). The mmpose import is unconditional at module
  level, so it cannot be skipped.
- uv pip install --dry-run of mmpose==1.3.2 (py3.12) fails: it depends on
  chumpy==0.70, whose build does not declare pip and fails to compile on
  modern Python (executed 2026-08-14). mmcv/mmdet themselves resolve, but
  chumpy is a hard blocker for mmpose.
- The v1.0 path additionally needs the full dwpose pipeline; the face
  parser path (BiSeNet) is fine on its own but cannot replace the
  landmark step without changing crop geometry (quality divergence).

## Implications for OpenVideoMaker

- The registry entry for MuseTalk keeps a fully measured file manifest
  (unet 3.4GB, whisper-tiny, face-parse, face-alignment, SD VAE - all
  sha256-pinned from official hubs), so installation is ready the moment
  a runner exists; the entry stays unverified and no adapter is shipped,
  so the Studio honestly reports 'no runner adapter' rather than
  pretending support.
- A future adapter can either (a) vendor a landmark fallback that matches
  rtmpose indices from face-alignment landmarks with measured quality, or
  (b) run in a non-isolated runtime where mmpose installs (documented
  trust tradeoff).

## Rejected approaches

- Replacing rtmpose landmarks with face-alignment's 68 points silently:
  changes the crop upper bound; material behavior divergence without
  measured parity.
- Bundling a patched chumpy: out of scope for the runner isolation model.

## Open questions

- Whether mmpose ships wheels that drop chumpy in a future release;
  re-check before retrying.
