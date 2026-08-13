import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = 'http://localhost:4321/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
// Load lazy images below the fold before checking them.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const report = {};
report.title = await page.title();
report.h1 = await page.locator('h1').first().textContent();
report.images = await page.locator('img').count();
report.brokenImages = await page.evaluate(() =>
  Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
);
report.navLinks = await page.locator('.site-nav nav a').allTextContents();
// Follow the docs link
await page.locator('a[href="/docs/"]').first().click();
await page.waitForLoadState('networkidle');
report.docsH1 = await page.locator('h1').first().textContent();
report.errors = errors;
console.log(JSON.stringify(report, null, 2));

if (!report.title.includes('OpenVideoMaker')) throw new Error('bad title');
if (!(report.h1 ?? '').includes('Keep everything editable')) throw new Error('bad hero');
if (report.brokenImages.length > 0) throw new Error('broken images: ' + report.brokenImages.join(', '));
if (report.docsH1 !== 'What exists today') throw new Error('docs nav broken');
if (errors.length > 0) throw new Error('page errors: ' + errors.join(' | '));

// Dead-link check across the built output
const fs = await import('node:fs');
const path = await import('node:path');
const dist = 'apps/site/dist';
const htmlFiles = fs.readdirSync(dist, { recursive: true }).filter((f) => String(f).endsWith('.html'));
const broken = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(dist, file), 'utf8');
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = clean.endsWith('/') ? clean + 'index.html' : clean;
    const targetFile = path.join(dist, target.replace(/^\//, ''));
    if (!fs.existsSync(targetFile)) broken.push(file + ' -> ' + href);
  }
}
console.log('dead links:', JSON.stringify(broken));
if (broken.length > 0) throw new Error('dead links: ' + broken.join('; '));
console.log('SITE CHECK OK');
await browser.close();
