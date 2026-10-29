// Renders the chat avatars (web/public/story/faces/<id>.png, or a private
// folder) from the character models: node qa/portraits.mjs (dev server on :5173)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const FACES = {
  adriaen: ['web/public/story/chars/bearded_operator.glb', 180, 0.2],
  supervisor: ['web/public/story/chars/blazer_lead.glb', 180, 0.2],
  ctrlbuddy: ['characters/control_buddy/control_buddy.glb', 180, 0.3],
  ceo: ['web/public/story/chars/glasses_ceo.glb', 180, 0.2],
  // likenesses of real people: the private build only (git-ignored),
  // master copy in the project files' story-private/faces/
  composer: ['characters/composer/composer.glb', 180, 0.165, 'web/public/story/private/faces'],
  poet: ['characters/poet/poet.glb', 180, 0.165, 'web/public/story/private/faces'],
};
const only = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
page.on('console', (m) => console.log(m.text())); page.on('pageerror', (e) => console.log(e.message));
await page.route(/\/m\/.*\.glb$/, (r) => r.fulfill({ body: fs.readFileSync(ROOT + decodeURIComponent(new URL(r.request().url()).pathname.slice(3))), contentType: 'model/gltf-binary' }));
for (const [id, [file, yaw, k, dir = 'web/public/story/faces']] of Object.entries(FACES)) {
  if (only && id !== only) continue;
  await page.goto(`http://127.0.0.1:5173/qa/portrait.html?m=/m/${encodeURIComponent(file)}&yaw=${yaw}&k=${k}${process.argv[3] ? '&dx=' + process.argv[3] : ''}`);
  await page.waitForFunction(() => document.title === 'ready', null, { timeout: 60000 });
  fs.mkdirSync(ROOT + dir, { recursive: true });
  await page.locator('canvas').screenshot({ path: ROOT + `${dir}/${id}.png`, omitBackground: true });
  console.log(id);
}
await browser.close();
