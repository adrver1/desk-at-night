// Time of day and weather sliders for outdoor.js, built into a container.
// Shared by the lighting viewer and the room control panel in the game.
// The URL can set them too: ?time=14.5&weather=storm (or clouds/wind/fog/rain=0..1,
// windFrom and swellFrom in degrees, swellHs in metres).
import { WEATHER, REAL_TIME, clock, windSpeed, beaufort, compass } from './outdoor.js';

const SLIDERS = [
  ['time', 'Time of day', 0, 24, 0.05, (v) => clock(v)],
  ['clouds', 'Clouds', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['wind', 'Wind and waves', 0, 1, 0.01, (v) => `${Math.round(windSpeed(v))} m/s · ${beaufort(windSpeed(v))[0]} Bft`],
  ['windFrom', 'Wind from', 0, 359, 1, (v) => `${compass(v)} ${Math.round(v)}°`],
  ['swellHs', 'Swell', 0, 4, 0.1, (v) => `${v.toFixed(1)} m`],
  ['fog', 'Fog', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['rain', 'Rain', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
];
const PRESETS = { clear: 'Clear', cloudy: 'Cloudy', overcast: 'Overcast', storm: 'Storm', fog: 'Fog' };
const RUN_SPEED = 0.5; // hours per second while the clock is sped up

export function outdoorControls(root, outdoor) {
  const params = new URLSearchParams(location.search);
  const preset = WEATHER[params.get('weather')];
  if (preset) outdoor.set(preset);
  for (const key of [...SLIDERS.map(([k]) => k), 'swellFrom']) if (params.has(key)) outdoor.set({ [key]: Number(params.get(key)) });

  const outputs = {}, inputs = {};
  for (const [key, label, min, max, step, show] of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'slider';
    row.innerHTML = `<span class="slider-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.value = outdoor.state[key];
    out.textContent = show(outdoor.state[key]);
    input.addEventListener('input', () => {
      outdoor.set({ [key]: Number(input.value) });
      out.textContent = show(Number(input.value));
      if (key !== 'time') mark(null);
    });
    inputs[key] = input;
    outputs[key] = [out, show];
    root.append(row);
  }

  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Weather');
  for (const [id, label] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.dataset.weather = id;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      outdoor.set(WEATHER[id]);
      sync();
      mark(id);
    });
    seg.append(btn);
  }
  root.append(seg);
  function mark(id) {
    for (const b of seg.children) b.setAttribute('aria-checked', String(b.dataset.weather === id));
  }
  mark(params.get('weather'));

  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'ghost';
  const fast = () => outdoor.state.speed > REAL_TIME;
  const label = () => { run.textContent = fast() ? 'Back to real time' : 'Speed up the clock'; };
  run.addEventListener('click', () => { outdoor.set({ speed: fast() ? REAL_TIME : RUN_SPEED }); label(); });
  label();
  root.append(run);

  function sync() {
    for (const [key] of SLIDERS) {
      inputs[key].value = outdoor.state[key];
      const [out, show] = outputs[key];
      out.textContent = show(outdoor.state[key]);
    }
  }
  // While the clock runs, keep the time slider moving with it
  let shown = outdoor.state.time;
  (function follow() {
    if (Math.abs(outdoor.state.time - shown) > 1 / 120) {
      shown = outdoor.state.time;
      inputs.time.value = shown;
      outputs.time[0].textContent = clock(shown);
    }
    requestAnimationFrame(follow);
  })();
  return { sync };
}
