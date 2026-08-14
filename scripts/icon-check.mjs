#!/usr/bin/env node
/**
 * Verify the packaged application icon: extract the exe's associated
 * icon (Windows Shell), rasterize it, and compare its regions against
 * the source build/icon.png - objective proof the installer ships OUR
 * icon, not Electron's default. Re-runnable after pnpm desktop:package.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const exe = resolve(root, 'apps/desktop/release/win-unpacked/OpenVideoMaker.exe');
const sourcePng = resolve(root, 'apps/desktop/build/icon.png');
const outDir = resolve(root, '.research/icon-check');
mkdirSync(outDir, { recursive: true });
if (!existsSync(exe)) throw new Error('packaged app missing - run pnpm desktop:package first');
if (!existsSync(sourcePng)) throw new Error('icon.png missing - run node scripts/generate-icons.mjs first');

console.log('[1/3] extracting the exe icon');
const extractedPng = resolve(outDir, 'extracted.png');
const script = "Add-Type -AssemblyName System.Drawing; " +
  "$i = [System.Drawing.Icon]::ExtractAssociatedIcon('" + exe.replace(/'/g, "''") + "'); " +
  "$b = $i.ToBitmap(); $b.Save('" + extractedPng.replace(/'/g, "''") + "', [System.Drawing.Imaging.ImageFormat]::Png); $i.Dispose(); $b.Dispose();";
const encoded = Buffer.from(script, 'utf16le').toString('base64');
const extracted = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 120_000 });
if (extracted.status !== 0) throw new Error('icon extraction failed: ' + extracted.stderr.toString());
console.log('[1/3] extracted to ' + extractedPng);

console.log('[2/3] rasterizing both images to raw RGB at 256px');
const raw = (path) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vf', 'scale=256:256', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const a = raw(extractedPng);
const b = raw(sourcePng);
if (a.length !== 256 * 256 * 3 || a.length !== b.length) throw new Error('unexpected raw sizes: ' + a.length + ' vs ' + b.length);

console.log('[3/3] comparing regions');
const regionDiff = (x0, y0, x1, y1) => {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * 256 + x) * 3;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  }
  return sum / n;
};
const center = regionDiff(64, 64, 192, 192);
const corner = regionDiff(0, 0, 40, 40);
console.log('mean abs channel diff - center: ' + center.toFixed(2) + ', corner: ' + corner.toFixed(2));
// Downscaled extraction smooths pixels, so allow modest drift; Electron's
// default icon would differ by 100+ per channel, so this is decisive.
if (center > 24) throw new Error('center region differs from the source icon (mean ' + center.toFixed(2) + ') - wrong icon in the exe?');
if (corner > 24) throw new Error('corner region differs from the source icon (mean ' + corner.toFixed(2) + ') - wrong icon in the exe?');
// Signature checks: graphite-dark corners + accent-blue center content.
const mean = (x0, y0, x1, y1) => {
  const s = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * 256 + x) * 3;
      s[0] += a[i]; s[1] += a[i + 1]; s[2] += a[i + 2];
      n += 1;
    }
  }
  return s.map((v) => v / n);
};
const cornerMean = mean(8, 8, 48, 48);
const playMean = mean(96, 100, 160, 156);
console.log('corner rgb: ' + cornerMean.map((v) => v.toFixed(1)).join(',') + '; play-area rgb: ' + playMean.map((v) => v.toFixed(1)).join(','));
if ((cornerMean[0] + cornerMean[1] + cornerMean[2]) / 3 > 70) throw new Error('corner is not the graphite tile - unexpected icon');
if (playMean[2] - playMean[0] < 10) throw new Error('play area lacks the accent blue - unexpected icon');
console.log('ICON OK');
