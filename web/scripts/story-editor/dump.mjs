// Dumps the default story run as JSON (both languages) for seed.py, by
// importing story/content.js in a page served by the dev server.
//   npx vite --port 5173 &   then   node scripts/story-editor/dump.mjs dump.json
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [out = 'dump.json', base = 'http://127.0.0.1:5173'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const dump = {};
for (const lang of ['no', 'en']) {
  await page.goto(`${base}/index.html?lang=${lang}`);
  dump[lang] = await page.evaluate(async () => {
    const c = await import('/src/story/content.js');
    const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x)));
    return strip({ CHAPTERS: c.CHAPTERS.map((ch) => ({ key: ch.key, id: ch.id, name: ch.name, base: ch.base, beats: ch.beats })), SLIDES: c.SLIDES, CHATS: c.CHATS, SPEAKERS: c.SPEAKERS });
  });
}
writeFileSync(out, JSON.stringify(dump));
await browser.close();
