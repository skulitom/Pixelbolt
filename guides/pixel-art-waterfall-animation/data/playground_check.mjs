// Opens each playground link from the page and waits for the playground to render it. Usage: node playground_check.mjs <index.html> <out dir>
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const [, , page_html, out] = process.argv;
mkdirSync(out, { recursive: true });
const html = readFileSync(page_html, 'utf8');
const links = [...html.matchAll(/href="(https:\/\/skulitom\.github\.io\/Pixelbolt\/playground\/#v=0\.15\.0&amp;r=[^"]+)"/g)].map(m => m[1].replaceAll('&amp;', '&'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
for (const [i, link] of links.entries()) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(link, { waitUntil: 'load' });
  let status = '';
  for (let t = 0; t < 60; t++) {
    await page.waitForTimeout(500);
    status = await page.evaluate(() => document.body.innerText.split('\n').filter(l => /render|frames|Rendered|error|px/i.test(l)).slice(0, 12).join(' | '));
    if (!/No render yet|Rendering/i.test(status) && /frame/i.test(status)) break;
  }
  const engine = await page.evaluate(() => document.body.innerText.split('\n')[0]);
  await page.screenshot({ path: `${out}/playground-${i}.png` });
  results.push({ i, engine, status: status.slice(0, 400), errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
