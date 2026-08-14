#!/usr/bin/env node
/**
 * Render the app icon: apps/desktop/build/icon.svg -> icon.png (1024x1024)
 * via a headless Chromium screenshot, so the single SVG source stays the
 * design truth and electron-builder derives .ico/.icns from the PNG.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const svgPath = resolve(root, 'apps/desktop/build/icon.svg');
const pngPath = resolve(root, 'apps/desktop/build/icon.png');

const svg = readFileSync(svgPath, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent('<style>html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent}</style>' + svg, { waitUntil: 'load' });
  const buffer = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(pngPath, buffer);
  console.log('wrote ' + pngPath + ' (' + buffer.length + ' bytes)');
} finally {
  await browser.close();
}

// NSIS installers need a real .ico (electron-builder converts the PNG
// only for the exe itself). Render a single 256px icon via GDI+.
const icoPath = resolve(root, 'apps/desktop/build/icon.ico');
const ps = "Add-Type -AssemblyName System.Drawing; " +
  "$src = [System.Drawing.Image]::FromFile('" + pngPath.replace(/'/g, "''") + "'); " +
  "$bmp = New-Object System.Drawing.Bitmap 256,256; " +
  "$g = [System.Drawing.Graphics]::FromImage($bmp); " +
  "$g.InterpolationMode = 'HighQualityBicubic'; " +
  "$g.DrawImage($src, 0, 0, 256, 256); " +
  "$h = $bmp.GetHicon(); $ico = [System.Drawing.Icon]::FromHandle($h); " +
  "$fs = [System.IO.File]::Create('" + icoPath.replace(/'/g, "''") + "'); " +
  "$ico.Save($fs); $fs.Close(); $ico.Dispose(); $g.Dispose(); $bmp.Dispose(); $src.Dispose();";
const encoded = Buffer.from(ps, 'utf16le').toString('base64');
const made = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 120_000 });
if (made.status !== 0) throw new Error('ico generation failed: ' + made.stderr.toString());
console.log('wrote ' + icoPath);
