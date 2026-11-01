// The house fonts for canvas text on the room's screens (screens.js,
// story screens, twin, workshop, VS Code, graph): Instrument Sans and
// JetBrains Mono, the same as the HTML overlays, so the monitors look the
// same on every laptop. fontsReady resolves once the weights the screens
// use are loaded; canvases drawn before that would bake in the fallback.
export const SANS = '"Instrument Sans", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';

const FACES = [400, 500, 600, 700].flatMap((w) => [`${w} 16px "Instrument Sans"`, `${w} 16px "JetBrains Mono"`]);
export const fontsReady = typeof document === 'undefined' || !document.fonts
  ? Promise.resolve()
  : Promise.race([
    Promise.all(FACES.map((f) => document.fonts.load(f))).catch(() => {}),
    new Promise((r) => setTimeout(r, 4000)),   // offline: go on with the fallback
  ]);
