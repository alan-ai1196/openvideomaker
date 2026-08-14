import { chromium } from 'playwright';

const BASE = 'http://localhost:5183/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.studio', { timeout: 15000 });

const report = await page.evaluate(() => {
  const results = {};
  const q = (sel) => document.querySelector(sel);
  const rect = (sel) => {
    const el = q(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  results.regions = {
    topbar: rect('.topbar'),
    leftpanel: rect('.leftpanel'),
    preview: rect('.preview'),
    inspector: rect('.inspector'),
    timeline: rect('.timeline'),
    statusbar: rect('.statusbar'),
  };

  const overflowChecks = [];
  for (const sel of ['.topbar', '.leftpanel', '.inspector', '.timeline', '.statusbar', '.timeline-header']) {
    const el = q(sel);
    if (!el) continue;
    overflowChecks.push({ sel, ok: el.scrollWidth <= el.clientWidth + 1, scrollW: el.scrollWidth, clientW: el.clientWidth });
  }
  results.overflow = overflowChecks;

  const topbar = q('.topbar') ? q('.topbar').getBoundingClientRect() : null;
  const transport = q('.topbar-transport') ? q('.topbar-transport').getBoundingClientRect() : null;
  results.transportCentered = topbar && transport
    ? Math.abs((transport.x + transport.width / 2) - (topbar.x + topbar.width / 2)) < 4
    : false;

  const stage = q('.preview-stage') ? q('.preview-stage').getBoundingClientRect() : null;
  results.previewAspect = stage ? Math.round((stage.width / stage.height) * 100) / 100 : 0;

  const lanes = [...document.querySelectorAll('.lane')];
  let clipsOutOfBounds = 0;
  for (const lane of lanes) {
    const laneRect = lane.getBoundingClientRect();
    for (const clip of lane.querySelectorAll('.clip')) {
      const c = clip.getBoundingClientRect();
      if (c.top < laneRect.top - 1 || c.bottom > laneRect.bottom + 1) clipsOutOfBounds += 1;
      if (c.width < 4) clipsOutOfBounds += 1;
    }
  }
  results.clipsOutOfBounds = clipsOutOfBounds;
  results.clipCount = document.querySelectorAll('.clip').length;
  results.trackCount = lanes.length;

  const selected = q('.clip.selected');
  if (selected) {
    const cs = getComputedStyle(selected);
    results.selectedBorder = cs.borderColor;
    const handles = selected.querySelectorAll('.clip-handle');
    results.selectedHandleOpacity = handles.length ? getComputedStyle(handles[0]).opacity : 'none';
  }

  const csRoot = getComputedStyle(document.documentElement);
  results.colors = {
    bgApp: csRoot.getPropertyValue('--bg-app').trim(),
    bgPanel: csRoot.getPropertyValue('--bg-panel').trim(),
    textPrimary: csRoot.getPropertyValue('--text-primary').trim(),
    textSecondary: csRoot.getPropertyValue('--text-secondary').trim(),
    textTertiary: csRoot.getPropertyValue('--text-tertiary').trim(),
    accent: csRoot.getPropertyValue('--accent').trim(),
  };

  results.bodyFont = getComputedStyle(document.body).fontFamily.slice(0, 60);
  return results;
});

// Browser honesty: the Jobs tab exists and shows the empty state (no
// local jobs can run in the browser).
await page.locator('.rail-button[title="Jobs"]').click();
await page.waitForTimeout(250);
report.jobsTab = await page.locator('.empty-panel p').first().textContent();
// Browser honesty: the Device Center says diagnostics run in the desktop app.
await page.locator('.rail-button[title="Devices"]').click();
await page.waitForTimeout(250);
report.devicesTab = await page.locator('.empty-panel p').first().textContent();

console.log(JSON.stringify(report, null, 2));
await browser.close();
