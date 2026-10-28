// Renders the chat avatars (web/public/story/faces/<id>.png) from the
// character models: node qa/portraits.mjs (dev server on :5173)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const FACES = {
  adriaen: ['web/public/story/chars/bearded_operator.glb', 180, 0.2],
  brage: ['web/public/story/chars/blazer_lead.glb', 180, 0.2],
  ctrlbuddy: ['characters/control_buddy/control_buddy.glb', 180, 0.3],
  ceo: ['web/public/story/chars/glasses_ceo.glb', 180, 0.2],
};
const only = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
page.on('console', (m) => console.log(m.text())); page.on('pageerror', (e) => console.log(e.message));
await page.route(/\/m\/.*\.glb$/, (r) => r.fulfill({ body: fs.readFileSync(ROOT + decodeURIComponent(new URL(r.request().url()).pathname.slice(3))), contentType: 'model/gltf-binary' }));
fs.mkdirSync(ROOT + 'web/public/story/faces', { recursive: true });
for (const [id, [file, yaw, k]] of Object.entries(FACES)) {
  if (only && id !== only) continue;
  await page.goto(`http://127.0.0.1:5173/qa/portrait.html?m=/m/${encodeURIComponent(file)}&yaw=${yaw}&k=${k}${process.argv[3] ? '&dx=' + process.argv[3] : ''}`);
  await page.waitForFunction(() => document.title === 'ready', null, { timeout: 60000 });
  await page.locator('canvas').screenshot({ path: ROOT + `web/public/story/faces/${id}.png`, omitBackground: true });
  console.log(id);
}
await browser.close();
