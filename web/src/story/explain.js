// One year ago, CtrlBuddy waving on the operator's screen (Adriaen,
// 2026-10-29): before the pointer clicks him, what he is, one part per beat
// on a half-slide beside him in the look of his deck's slides. The agent,
// its harness and model, its instructions, its tools and its knowledge base.
//
// State key (content.js): explain: n shows the panel with the first n parts,
// null hides it.
import { T } from './lang.js';
import { real } from '../privateNames.js';

// Line-drawn icons, 48 units square: stroke only, so they take the text's colour
const ICONS = {
  agent: '<rect x="10" y="12" width="28" height="22" rx="5"/><path d="M24 12V5M18 23h.01M30 23h.01M18 29h12M6 21v6M42 21v6M17 34v8h14v-8"/>',
  model: '<circle cx="24" cy="24" r="6"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l6 6M32 32l6 6M38 10l-6 6M16 32l-6 6"/>',
  rules: '<path d="M12 4h18l8 8v32H12z"/><path d="M30 4v8h8M18 20h14M18 27h14M18 34h9"/>',
  tools: '<path d="M8 40l16-16M30 6a8 8 0 0 0-6 12l-3 3 6 6 3-3a8 8 0 0 0 12-6l-5 1-4-4 1-5z"/><path d="M6 14h10M6 20h6"/>',
  knowledge: '<path d="M6 10c6-3 12-3 18 2v30c-6-5-12-5-18-2zM42 10c-6-3-12-3-18 2v30c6-5 12-5 18-2z"/>',
};
// [icon, heading no, en, line no, en], in the order they come in
const PARTS = [
  ['agent', 'AI-agent', 'AI agent', 'Bygget i VS Code, med GitHub Copilot som harness', 'Built in VS Code, with GitHub Copilot as the harness'],
  ['model', 'Modell', 'Model', 'Kjører stort sett på Claude 5.5', 'Running mostly Claude 5.5'],
  ['rules', 'Instruksjoner', 'Instructions', 'Oppfører seg som en erfaren automasjonsingeniør', 'Behaves like an advanced automation engineer'],
  ['tools', 'Verktøy', 'Tools', 'Kobler seg til datakilder via API-er: CDF, ABB LoopInsight', 'Connects to data sources through APIs: CDF, ABB LoopInsight'],
  ['knowledge', 'Kunnskapsbase', 'Knowledge base', 'Nordhav Energi-spesifikk fagkunnskap for oppgavene', 'Nordhav Energi-specific domain knowledge for its tasks'],
];

export class Explain {
  constructor() {
    const el = this.el = document.createElement('div');
    el.className = 'explain';
    el.innerHTML = `<h2>${T('CtrlBuddy – hva er det?', 'CtrlBuddy – what is it?')}</h2><ol>` + PARTS.map(([icon, hno, hen, no, en]) =>
      `<li><svg viewBox="0 0 48 48" aria-hidden="true">${ICONS[icon]}</svg><div><b>${T(hno, hen)}</b><span>${real(T(no, en))}</span></div></li>`).join('') + '</ol>';
    (document.getElementById('game') ?? document.body).append(el);
    this.parts = [...el.querySelectorAll('li')];
  }

  set(n) {
    const on = n != null && n !== false;
    this.el.classList.toggle('on', on);
    if (on) this.parts.forEach((p, i) => p.classList.toggle('in', i < n));
  }
}
