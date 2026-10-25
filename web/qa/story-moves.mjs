// Check the cast's walks, sits and pours without waiting for them in real
// time (swiftshader draws ~2 fps): enter a beat without its steps, queue moves
// from the page, step the cast in fixed 1/30 s ticks, and take a screenshot at
// each checkpoint.
//   node qa/story-moves.mjs <outDir> <chapter> <beat> '<moves JSON>' '<checkpoints JSON>' ['<cast JSON>']
// moves: [[who, move], ...] (as content.js steps); checkpoints: [[seconds, shot], ...];
// cast: where everyone starts ({ who: { at: spot } }), else the beat's end state
import { chromium } from '@playwright/test';
const [out, chapter, beat, moves, checks, start = '{}'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:5173/story.html?chapter=${chapter}`);
await page.waitForFunction("window.__story?.cast()?.jug && !document.querySelector('#storyGo')?.disabled", null, { timeout: 150000 });
await page.evaluate(([c, b, m, st]) => {
  __story.start();
  __story.enter(+c, +b, { instant: true, skipDo: true });
  const cast = __story.cast();
  cast.update = ((orig) => function (dt, cam, now) { if (!window.__manual) orig.call(this, dt, cam, now); })(cast.update);
  window.__manual = true;
  const from = JSON.parse(st);
  if (Object.keys(from).length) { for (const p of Object.values(cast.people)) { p.at = null; p.want = null; } cast.place(from); }
  const V = __game.camera.position.constructor, sh = __story.shots();
  sh.custom = () => sh.look(new V(2.2, 7.5, 0.3), new V(2.2, 0, 0.29), 60);   // 'epilogue' as a checkpoint shot: straight down on the room
  window.__tick = (s) => { for (let i = 0; i < s * 30; i++) cast.constructor.prototype.update.call(cast, 1 / 30, __game.camera, performance.now() / 1000); };
  for (const [who, mv] of JSON.parse(m)) cast.move(who, mv);
}, [chapter, beat, moves, start]);
let t = 0;
for (const [at, shot] of JSON.parse(checks)) {
  await page.evaluate(([dt, shot]) => { __tick(dt); if (shot) __story.shots().go(shot, true); }, [at - t, shot]);
  t = at;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/m-${String(at).padStart(5, '0')}.png` });
  console.log(at, JSON.stringify(await page.evaluate(() => __game.chairs.map((c) => [c.obj.name, c.obj.visible, c.obj.position.x.toFixed(2), c.obj.position.z.toFixed(2), c.obj.rotation.y.toFixed(2)]))), JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(__story.cast().people).filter(([, p]) => p.root.visible).map(([w, p]) => [w, [p.root.position.x.toFixed(2), p.root.position.z.toFixed(2), p.pose, Boolean(p.task)]])))));
}
await browser.close();
