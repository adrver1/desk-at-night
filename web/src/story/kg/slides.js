// The knowledge-graph slides of chapter 6 (deck slides 7 to 14), one entry
// per slide id from story.json. builds = clicks after the first picture, as
// in the deck. Elements: see engine.js. People are stand-ins (Ola, the well
// team), as everywhere in the public build.
import { T } from '../lang.js';
import { Graph } from './graph.js';
import { books, desk, globe, col, KG_LOOK } from './engine.js';
import { vscodeHTML } from '../vscode.js';

// ------------------------------------------------------------ helpers
const title = (html, from = 0) => ({ kind: 'title', html, x: -7.2, y: 4.0, from });
const sub = (html, from = 0) => ({ kind: 'text', cls: 'sub', html, x: -7.2, y: 2.85, from });
const text = (html, x, y, w, from = 0, o = {}) => ({ kind: 'text', html, x, y, w, from, ...o });
const fig = (glb, x, y, h, from = 0, o = {}) => ({ kind: 'figure', glb, x, y, h, from, ...o });
const prop = (make, x, y, from = 0, o = {}) => ({ kind: 'prop', make, x, y, from, ...o });
const arrow = (p0, p1, label, from = 0, o = {}) => ({ kind: 'arrow', p0, p1, label, from, ...o });
const bubble = (html, x, y, from = 0, o = {}) => ({ kind: 'bubble', html, x, y, from, anchor: [0.5, 1], ...o });
const draw = (fn, from = 0, o = {}) => ({ kind: 'draw', draw: fn, from, ...o });

const ROBOT = { buddy: 'control_buddy', scholar: 'control_buddy_scholar', nurse: 'control_buddy_nurse' };
const OLA = 'bearded_operator';

// Small things travelling from a to b along an arc, over and over: pages
// into the knowledge base, reads up to CtrlBuddy, the Linter's fixes
function stream(ctx, a, b, { n = 3, speed = 0.7, lift = 0.8, kind = 'page', alpha = 1 } = {}) {
  const { over: c, slide: sl, since } = ctx;
  for (let i = 0; i < n; i++) {
    const k = (since * speed + i / n) % 1;
    const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k + Math.sin(k * Math.PI) * lift;
    const [px, py] = sl.P(x, y, 0.8), u = sl.U(1);
    c.save();
    c.globalAlpha = alpha * Math.min(1, since * 2) * Math.sin(k * Math.PI) ** 0.4;
    c.translate(px, py);
    if (kind === 'page') {
      c.rotate(Math.sin(k * 7 + i) * 0.5);
      c.fillStyle = '#ffffff'; c.strokeStyle = col('ink'); c.lineWidth = u * 0.02;
      c.fillRect(-u * 0.13, -u * 0.17, u * 0.26, u * 0.34); c.strokeRect(-u * 0.13, -u * 0.17, u * 0.26, u * 0.34);
      c.fillStyle = col('soft');
      for (let l = 0; l < 4; l++) c.fillRect(-u * 0.08, -u * 0.1 + l * u * 0.06, u * (l === 3 ? 0.09 : 0.16), u * 0.015);
    } else if (kind === 'tick') {
      c.strokeStyle = col('green'); c.lineWidth = u * 0.06; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-u * 0.12, 0); c.lineTo(-u * 0.03, u * 0.1); c.lineTo(u * 0.14, -u * 0.12); c.stroke();
    } else {
      c.fillStyle = col(kind === 'read' ? 'S' : kind); c.shadowColor = col('S'); c.shadowBlur = u * 0.25;
      c.beginPath(); c.arc(0, 0, u * 0.08, 0, 7); c.fill();
    }
    c.restore();
  }
}

// a hand-drawn looking ring round something (the magenta circles of the deck)
function ring(ctx, x, y, rx, ry, k = 1) {
  const { over: c, slide: sl } = ctx, [px, py] = sl.P(x, y);
  c.save();
  c.strokeStyle = col('magenta'); c.lineWidth = sl.U(0.06); c.lineCap = 'round';
  c.beginPath();
  c.ellipse(px, py, sl.U(rx), sl.U(ry), -0.08, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2.08 * Math.min(1, k));
  c.stroke();
  c.restore();
}

// A seeded cloud of notes: a graph laid out by a few rounds of springs inside
// a box, the way an Obsidian graph view looks
function cloud({ n, box: [x0, y0, x1, y1], seed = 7, hubs = 6, links = 1.5 }) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) nodes.push({ i, x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0), deg: 0 });
  for (let i = 1; i < n; i++) {
    const to = i < hubs ? 0 : Math.floor(rnd() ** 2 * Math.min(i, hubs * 3));
    edges.push([i, to]); nodes[i].deg++; nodes[to].deg++;
    if (rnd() < links - 1 && i > 3) { const o = Math.floor(rnd() * i); if (o !== to) edges.push([i, o]); }
  }
  // Fruchterman-Reingold: links pull, every pair pushes, a cooling step,
  // the box holds
  const k = Math.sqrt((x1 - x0) * (y1 - y0) / n) * 0.9, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let it = 0, temp = (x1 - x0) / 8; it < 200; it++, temp *= 0.975) {
    for (const a of nodes) { a.fx = (cx - a.x) * 0.05; a.fy = (cy - a.y) * 0.05; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.max(0.02, Math.hypot(dx, dy)), f = k * k / d / d;
      a.fx += dx * f; a.fy += dy * f; b.fx -= dx * f; b.fy -= dy * f;
    }
    for (const [i, j] of edges) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.max(0.02, Math.hypot(dx, dy)), f = d / k;
      a.fx += dx * f; a.fy += dy * f; b.fx -= dx * f; b.fy -= dy * f;
    }
    for (const a of nodes) {
      const m = Math.hypot(a.fx, a.fy) || 1, step = Math.min(m, temp);
      a.x = Math.min(x1, Math.max(x0, a.x + a.fx / m * step)); a.y = Math.min(y1, Math.max(y0, a.y + a.fy / m * step));
    }
  }
  return { nodes, edges };
}

// ------------------------------------------------------------ slide 7
const ROBOT_TEXT = {
  buddy: T('<b>Hovedorkestrator</b>Svarer på spørsmål med «generell» LLM-kunnskap + domenekunnskap fra wikien + verktøy', '<b>Main orchestrator</b>Answers questions with “general” LLM knowledge + domain knowledge from the wiki + tools'),
  scholar: T('<b>«Akademikeren»</b>Samler kunnskap i en Karpathy-kunnskapsbase', '<b>“The Scholar”</b>Gathers knowledge in a Karpathy knowledge base'),
  nurse: T('<b>«Redaktøren»</b>Sørger for at kunnskapsbasen er sunn', '<b>“The Editor”</b>Keeps the knowledge base healthy'),
};
const H02 = {
  id: 'h-02', builds: 3,
  focus: (b) => [[0, 0, 0], [-4.8, -0.5, 3], [0, -0.5, 3], [4.8, -0.5, 3]][b],
  elements: [
    title(T('CtrlBuddy – hva er det?', 'CtrlBuddy – what is it?')),
    sub(T('… Én av flere agenter', '… One of several agents')),
    ...['buddy', 'scholar', 'nurse'].flatMap((k, i) => [
      fig(ROBOT[k], -4.8 + i * 4.8, -1.75, 3.6, i + 1, { act: (b) => (b === i + 1 ? 'point' : 'idle'), rot: [0.25, 0, -0.25][i] }),
      text(ROBOT_TEXT[k], -4.8 + i * 4.8, -2.05, 4.3, i + 1, { cls: 'robot', anchor: [0.5, 0] }),
    ]),
  ],
};

// ------------------------------------------------------------ slide 8: the team loop
const LOOP = { buddy: [0, 0.2], scholar: [-5.1, -3.6], nurse: [5.1, -3.6], books: [0, -4.2] };
const H08 = {
  id: 'ctrl-08', builds: 5,
  focus: (b) => [[0, 0, 0], [0, 0, 1], [-2.5, -2.5, 3], [0, -1.5, 3], [2.5, -2.5, 3], [3, 1.5, 2]][b],
  elements: [
    title(T('CtrlBuddy – hva er det?', 'CtrlBuddy – what is it?')),
    sub(T('… Én av flere agenter', '… One of several agents')),
    fig(ROBOT.buddy, ...LOOP.buddy, 2.9, 0, { act: (b) => (b === 1 ? 'point' : 'idle') }),
    fig(ROBOT.scholar, ...LOOP.scholar, 2.5, 0, { rot: 0.45 }),
    fig(ROBOT.nurse, ...LOOP.nurse, 2.5, 0, { rot: -0.45, act: (b) => (b === 4 ? 'point' : 'idle') }),
    arrow([-1.3, 1.7], [-4.3, -0.9], T('Leder', 'Leads'), 1, { bend: 0.22, labelOff: [-0.35, 0.25] }),
    arrow([1.3, 1.7], [4.3, -0.9], T('Leder', 'Leads'), 1, { bend: -0.22, labelOff: [0.35, 0.25] }),
    prop(() => books(7), ...LOOP.books, 2, { scale: 1.25, rot: 0.25 }),
    arrow([-3.9, -3.3], [-1.0, -3.5], T('Skriver', 'Writes'), 2, { bend: 0.25, labelOff: [0, -0.45] }),
    draw((ctx) => stream(ctx, [-4.3, -2.3], [-0.5, -3.3], { kind: 'page' }), 2),
    arrow([0, -2.6], [0, -0.5], T('Blir lest av', 'Is read by'), 3, { bend: 0, lw: 0.12, labelOff: [1.0, 0] }),
    draw((ctx) => stream(ctx, [0, -2.7], [0, -0.3], { kind: 'read', lift: 0, speed: 0.9 }), 3),
    arrow([3.9, -3.3], [1.0, -3.5], T('Korrigerer', 'Corrects'), 4, { bend: -0.25, labelOff: [0, -0.45] }),
    draw((ctx) => stream(ctx, [4.3, -2.3], [0.5, -3.3], { kind: 'tick', n: 2, speed: 0.5 }), 4),
    prop(desk, 5.9, 1.25, 5, { scale: 1.1, rot: -0.35 }),
    fig(OLA, 6.7, 1.25, 2.2, 5, { rot: -0.9, tag: 'Ola' }),
    arrow([1.6, 2.4], [4.7, 2.75], T('Samhandler med', 'Works with'), 5, { bend: -0.25, both: true, labelOff: [0, 0.35] }),
  ],
};

// ------------------------------------------------------------ slide 9: just .agent.md files
const AGENT_MD = {
  buddy: T(`<i>---</i>
<b>navn:</b> CtrlBuddy
<b>beskrivelse:</b> Reguleringsingeniørens orkestrator. Diagnostikk, navigasjon, spørsmål og rapporter om reguleringssløyfer. Delegerer kompilering til @Kompilator og helsesjekk til @Linter.
<b>verktøy:</b> [edit, codebase, fetch, search, runCommands …]
<b>agenter:</b> [Kompilator, Linter]
<i>---</i>
<h4># CtrlBuddy — Orkestrator</h4>Du eier steg 1, 3, 4 og 5 i Karpathys 7-trinns pipeline: ta inn spørsmålet, naviger i wikien, diagnostiser, lag utdata.`,
  `<i>---</i>
<b>name:</b> CtrlBuddy
<b>description:</b> The control engineer's orchestrator. Diagnostics, navigation, questions and reports on control loops. Delegates compiling to @Compiler and health checks to @Linter.
<b>tools:</b> [edit, codebase, fetch, search, runCommands …]
<b>agents:</b> [Compiler, Linter]
<i>---</i>
<h4># CtrlBuddy — Orchestrator</h4>You own steps 1, 3, 4 and 5 of Karpathy's 7-step pipeline: take the question in, navigate the wiki, diagnose, produce the output.`),
  scholar: T(`<i>---</i>
<b>navn:</b> Kompilator
<b>beskrivelse:</b> Leser filer fra raw/ og lager atomiske wiki-artikler. Eier Karpathy steg 2 (Kompiler).
<b>verktøy:</b> [rediger, kodebase, hent, søk]
<i>---</i>
<h4># Kompilator — Raw → Wiki</h4>Inn: artikler, rapporter, leverandørdokumenter, forelesninger, datasett i raw/. Ut: én idé per notat i wiki/, med kilder.`,
  `<i>---</i>
<b>name:</b> Compiler
<b>description:</b> Reads files from raw/ and writes atomic wiki articles. Owns Karpathy step 2 (Compile).
<b>tools:</b> [edit, codebase, fetch, search]
<i>---</i>
<h4># Compiler — Raw → Wiki</h4>In: papers, reports, vendor documents, lectures, data sets in raw/. Out: one idea per note in wiki/, with sources.`),
  nurse: T(`<i>---</i>
<b>navn:</b> Linter
<b>beskrivelse:</b> Validerer wiki-helse: frontmatter, ødelagte lenker, motsetninger, foreldreløse notater. Eier Karpathy steg 6 (Lint).
<b>verktøy:</b> [kodebase, runCommands, søk]
<i>---</i>
<h4># Linter — Wiki-helse</h4>Kjør etter at @Kompilator har lagt til artikler, før en større overlevering, og hver uke.`,
  `<i>---</i>
<b>name:</b> Linter
<b>description:</b> Checks the wiki's health: front matter, broken links, contradictions, orphan notes. Owns Karpathy step 6 (Lint).
<b>tools:</b> [codebase, runCommands, search]
<i>---</i>
<h4># Linter — Wiki health</h4>Run after @Compiler has added articles, before a bigger handover, and weekly.`),
};
const ROBOT_TEXT9 = {
  buddy: ROBOT_TEXT.buddy,
  scholar: T('<b>«Lærd»</b>Samler kunnskap i en Karpathy-lignende kunnskapsbase', '<b>“Scholar”</b>Gathers knowledge in a Karpathy-like knowledge base'),
  nurse: T('<b>«Sykepleier»</b>Sørger for at wikien er sunn', '<b>“Nurse”</b>Keeps the wiki healthy'),
};
const H09 = {
  id: 'ctrl-09', builds: 5,
  focus: (b) => [[0, 0, 0], [-5.2, 1, 2], [0, 1, 2], [5.2, 1, 2], [0, 0, 1], [0, 0, 3]][b],
  elements: [
    ...['buddy', 'scholar', 'nurse'].flatMap((k, i) => {
      const x = -5.2 + i * 5.2;
      return [
        // the robot steps aside, small, when his file shows
        fig(ROBOT[k], x, -1.75, 3.6, 0, { rot: [0.25, 0, -0.25][i], at: (b) => (b > i ? { x: x + 1.75, y: -4.35, s: 0.42 } : { x, y: -1.75 }), until: 5 }),
        text(ROBOT_TEXT9[k], x, -2.05, 4.3, 0, { cls: 'robot', anchor: [0.5, 0], until: i + 1 }),
        { kind: 'card', cls: 'md', html: `<div class="fn">${['CtrlBuddy', 'Compiler', 'Linter'][i]}.agent.md</div><pre>${AGENT_MD[k]}</pre>`, x, y: 4.15, w: 4.95, h: 3.1, anchor: [0.5, 0], from: i + 1, until: 5 },
      ];
    }),
    // the project in an editor: the agents folder and the chat that uses them
    {
      kind: 'card', cls: 'vscode', x: 0, y: 0, w: 15.2, anchor: [0.5, 0.5], from: 5, at: (b) => ({ zoom: b === 5 ? 1 : 0.92 }),
      html: vscodeHTML({
        title: T('kontrollrom-agent — VS Code', 'control-room-agent — VS Code'),
        tree: [{ t: '.github', dir: 'open' }, { t: 'agents', lvl: 1, dir: 'open' }, ...['CtrlBuddy', 'Compiler', 'Linter'].map((n) => ({ t: `${n}.agent.md`, lvl: 2, hl: true })),
          ...['instructions', 'prompts'].map((t) => ({ t, lvl: 1, dir: 'closed' })), ...['raw', 'wiki', 'scripts', 'tests'].map((t) => ({ t, dir: 'closed' }))],
        tab: 'Compiler.agent.md',
        code: AGENT_MD.scholar,
        chat: [{ t: T('Del notatene om tuning i to, og kompiler den nye rapporten.', 'Split the tuning notes in two, and compile the new report.'), me: true }, { t: T('Jeg oppdaterer terskelen først, så setter jeg @Compiler i gang.', 'I\'ll update the threshold first, then set @Compiler going.') }],
        pick: 'CtrlBuddy',
      }),
    },
    { kind: 'text', cls: 'plaque', html: T('Dette er bare <code>.agent.md</code>-filer i «agents»-mappen i VS Code-prosjektet', 'These are just <code>.agent.md</code> files in the “agents” folder of the VS Code project'), x: 0, y: 0.6, w: 12, anchor: [0.5, 0.5], from: 4 },
    draw((ctx) => { const k = Math.min(1, ctx.since * 1.2); ring(ctx, -6.4, 1.45, 1.15, 0.5, k); ring(ctx, 3.85, 1.24, 0.75, 0.32, Math.max(0, k * 1.5 - 0.5)); }, 5, { delay: 0.8 }),
  ],
};

// ------------------------------------------------------------ slide 10: Karpathy
const MINI = { s: 0.48, x: 4.9, y: -1.75 };
const mini = (x, y) => [MINI.x + x * MINI.s, MINI.y + y * MINI.s];
const H01 = {
  id: 'h-01', builds: 6,
  focus: (b) => (b < 3 ? [-4, 0, 2] : [3, -1, 1]),
  elements: [
    title('Karpathy?'),
    fig('curly_fade_tech', -5.5, -4.5, 5.0, 1, { rot: 0.15, tag: 'Andrej Karpathy', tagDy: 0.15, at: () => ({}) }),
    arrow([-4.75, 3.65], [-4.6, 0.85], T('Han her', 'This guy'), 1, { col: 'magenta', bend: -0.45, labelOff: [0.55, 0.1], labelRot: 1.2, lw: 0.06 }),
    text(`<ul><li>${T('Medgründer av OpenAI og «KI-orakel»', 'Co-founder of OpenAI and “AI oracle”')}</li></ul>`, -2.0, 3.1, 9.6, 2, { cls: 'bullets' }),
    text(`<ul><li>${T('April 2026: viralt innlegg om en ny arbeidsflyt:', 'April 2026: viral post about a new workflow:')}</li></ul>`, -2.0, 2.35, 9.6, 3, { cls: 'bullets' }),
    text(`<ul><li>${T('Kunnskapsbase (wiki) for domenekunnskap', 'Knowledge base (wiki) for domain knowledge')}</li></ul>`, -1.3, 1.6, 9, 4, { cls: 'bullets subb' }),
    text(`<ul><li>${T('Krysslenkede .md-filer', 'Cross-linked .md files')}</li></ul>`, -1.3, 1.0, 9, 5, { cls: 'bullets subb' }),
    text(`<ul><li>${T('Skrives, redigeres og vedlikeholdes av LLM-agenter', 'Written, edited and kept up by LLM agents')}</li></ul>`, -1.3, 0.4, 9, 6, { cls: 'bullets subb' }),
    // the team loop again, small
    fig(ROBOT.buddy, ...mini(...LOOP.buddy), 2.9 * MINI.s, 3),
    fig(ROBOT.scholar, ...mini(...LOOP.scholar), 2.5 * MINI.s, 3, { rot: 0.45 }),
    fig(ROBOT.nurse, ...mini(...LOOP.nurse), 2.5 * MINI.s, 3, { rot: -0.45 }),
    prop(() => books(6), ...mini(...LOOP.books), 3, { scale: 1.25 * MINI.s, rot: 0.25 }),
    ...[[[-1.3, 1.7], [-4.3, -0.9], 0.22], [[1.3, 1.7], [4.3, -0.9], -0.22], [[-3.9, -3.3], [-1.0, -3.5], 0.25], [[0, -2.6], [0, -0.5], 0], [[3.9, -3.3], [1.0, -3.5], -0.25]]
      .map(([a, b, bend]) => arrow(mini(...a), mini(...b), '', 3, { bend, lw: 0.05 })),
    draw((ctx) => stream(ctx, mini(0, -2.7), mini(0, -0.3), { kind: 'read', lift: 0, speed: 0.9 }), 3),
    draw((ctx) => ring(ctx, ...mini(0, -3.65), 1.0, 0.62, Math.min(1, ctx.since * 1.5)), 4, { until: 7 }),
    text(`<a>${T('Karpathys notater: llm-wiki', 'Karpathy\'s notes: llm-wiki')}</a>`, 7.4, 4.0, 5, 0, { cls: 'link', anchor: [1, 0] }),
  ],
};

// ------------------------------------------------------------ slide 11: Wiki?
const C11 = cloud({ n: 150, box: [-7.1, -4.0, -1.7, 0.9], seed: 11, hubs: 7 });
const HUB11 = 0;
const near11 = new Set([HUB11, ...C11.edges.filter(([a, b]) => a === HUB11 || b === HUB11).flat()]);
const G11 = new Graph({
  nodes: C11.nodes.map((n) => ({ id: 'n' + n.i, c: n.i === HUB11 ? 'E' : 'grey', c2: 'E', small: n.i !== HUB11, label: n.i === HUB11 ? 'Anti-slug-regulering' : undefined, hideLabel: (b) => b < 3 })),
  edges: C11.edges.map(([a, b]) => ['n' + a, 'n' + b]),
  r: 0.07,
  target: (n, b) => {
    const i = +n.id.slice(1), p = C11.nodes[i], lit = b >= 3 && near11.has(i);
    return { x: p.x, y: p.y, a: b >= 1 ? (b >= 3 && !lit ? 0.35 : 1) : 0, s: b >= 1 ? (lit ? 1.6 : 1) : 0, alt: lit ? 1 : 0, delay: (i % 50) * 0.012 };
  },
});
const H11 = {
  id: 'ctrl-11', builds: 3,
  focus: (b) => [[-4, 2, 2], [-4, -1.5, 3], [3, 0, 2], [-4, -1.5, 3]][b],
  elements: [
    title('Wiki?'),
    prop(() => books(5), -6.3, 1.6, 0, { scale: 1.2, rot: 0.4 }),
    prop(globe, -3.6, 1.6, 0, { scale: 0.95 }),
    text('W', -3.6, 2.35, 1, 0, { cls: 'globe-w', anchor: [0.5, 0.5] }),
    // the dark graph view (the diorama is dark already)
    draw((ctx) => {
      if (KG_LOOK === 'b') return;
      const { under: c, slide: sl } = ctx, [x0, y0] = sl.P(-7.4, 1.2), [x1, y1] = sl.P(-1.4, -4.3);
      c.save(); c.globalAlpha = 1; c.fillStyle = '#1e2229'; c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, sl.U(0.12)); c.fill(); c.restore();
    }, 1),
    { kind: 'graph', graph: G11, from: 1 },
    {
      kind: 'card', cls: 'note', x: 3.2, y: 3.55, w: 8.4, anchor: [0.5, 0], from: 2,
      html: `<div class="side"><b>wiki</b><div>▾ ${T('reguleringsteori', 'control-theory')}</div>${['Anti-slug-regulering', 'Bode-plott', 'Kaskaderegulering', 'Foroverkobling', 'Integratorvindup', 'Nyquist', 'PID-regulator', 'PID-diskretisering', 'Prosessmodeller', 'Robust regulering', 'Separatornivå', 'Steptest'].map((t) => `<div class="${t === 'PID-regulator' ? 'on' : ''}">${t}</div>`).join('')}</div>
<div class="body"><h3>PID-regulator</h3><dl><dt>status</dt><dd>${T('aktiv', 'active')}</dd><dt>type</dt><dd>${T('begrep', 'concept')}</dd><dt>avhenger-av</dt><dd><a>Prosessmodeller</a> · <a>Tilbakekobling</a></dd><dt>tags</dt><dd><span>regulering</span><span>pid</span><span>hub</span></dd><dt>kilde</dt><dd>raw/${T('lærebok', 'textbook')}-kap11.pdf</dd></dl>
<h4>PID-regulator — hub</h4><p>${T('En PID-regulator regner pådraget ut fra avviket e(t) = r − y med tre ledd: P (nåværende avvik), I (akkumulert avvik, fjerner stasjonært avvik) og D (endringsrate, demper). De fleste regulatorer i prosessindustrien er i praksis PI.', 'A PID controller computes its output from the error e(t) = r − y with three terms: P (present error), I (accumulated error, removes offset) and D (rate of change, damps). Most process-industry controllers are in practice PI.')}</p>
<div class="formula">u(t) = Kp · ( e(t) + 1/Ti · ∫ e dτ + Td · de/dt )</div><p class="links">${T('Lenker hit', 'Linked from')}: <a>Anti-slug-regulering</a> <a>Separatornivå</a> <a>Steptest</a> <a>Kaskaderegulering</a></p></div>`,
    },
  ],
};

// ------------------------------------------------------------ slide 12: the wiki grows
const C12 = cloud({ n: 190, box: [0.6, -2.7, 7.4, 2.7], seed: 5, hubs: 9, links: 1.6 });
const COUNT12 = [14, 70, 190];
const KINDS = ['E', 'P', 'S', 'amber', 'P', 'E'];
const LABELS12 = { 0: 'PID-regulator', 1: 'Anti-slug', 2: 'Separator', 3: 'Ventilkarakteristikk', 4: 'Steptest', 5: 'Modellprediktiv regulering', 6: 'Brønntest' };
const G12 = new Graph({
  nodes: C12.nodes.map((n) => ({ id: 'n' + n.i, c: KINDS[n.i % KINDS.length], hub: n.i < 3, small: n.i >= 9, label: LABELS12[n.i] })),
  edges: C12.edges.map(([a, b]) => ['n' + a, 'n' + b]),
  r: 0.09, hubR: 0.15,
  target: (n, b) => {
    const i = +n.id.slice(1), p = C12.nodes[i], prev = b ? COUNT12[b - 1] : 0, on = i < COUNT12[b];
    return { x: p.x, y: p.y, a: on ? 1 : 0, s: on ? 1 : 0, delay: Math.max(0, i - prev) * (b === 2 ? 0.012 : 0.035) };
  },
});
const H12 = {
  id: 'ctrl-12', builds: 2,
  focus: (b) => [[-3, 0, 2], [2, -1, 2], [3, -1, 1]][b],
  elements: [
    title(T('Hver gang Compiler tar inn <b>informasjon</b>, vokser wikien', 'Every time Compiler takes in <b>information</b>, the wiki grows')),
    prop(desk, -3.3, -0.6, 0, { scale: 0.8, rot: 0.3 }),
    fig(OLA, -2.75, -0.6, 1.6, 0, { rot: -0.3, tag: 'Ola', tagDy: 0.15 }),
    bubble(T('Les denne artikkelen', 'Read this article'), -4.6, 1.6, 0, { cls: 'think' }),
    fig(ROBOT.scholar, -5.6, -4.4, 3.4, 0, { rot: 0.55, act: (b) => (b ? 'point' : 'idle') }),
    draw((ctx) => stream(ctx, [-3.0, 0.2], [-5.0, -1.6], { kind: 'page', n: 2, speed: 0.45, lift: 0.4 })),
    arrow([-3.4, -2.6], [-0.2, -1.7], '', 0, { bend: 0.22, lw: 0.14 }),
    draw((ctx) => stream(ctx, [-4.2, -2.0], [1.5, -1.2], { kind: 'page', n: ctx.b === 2 ? 6 : 3, speed: ctx.b ? 0.8 : 0.4, lift: 1 }), 0),
    ...[0.9, 2.3, 3.7, 5.1, 6.5].map((x, i) => prop(() => books(4 + ((i * 3) % 5)), x, -4.45, 2, { scale: 0.85, rot: 0.3 - i * 0.15, delay: 0.6 + i * 0.12 })),
    { kind: 'graph', graph: G12, from: 0 },
  ],
};

// ------------------------------------------------------------ slide 13: why do you exist?
const THINKERS = [['grey_beard_lead', 'Jean-Paul Sartre'], ['glasses_engineer', 'Michel Foucault'], ['crop_supervisor', 'Albert Camus'], ['curly_analyst', 'Friedrich Nietzsche'], ['glasses_ceo', 'Simone de Beauvoir']];
const CHECKS = [T('Kryssrefererer', 'Cross-references'), T('Fanger selvmotsigelser', 'Catches contradictions'), T('Fanger hull i dekningen', 'Catches gaps in coverage'), T('Passer på at artikler følger standarden', 'Makes sure articles follow the standard')];
const H13 = {
  id: 'ctrl-13', builds: 5,
  focus: (b) => [[-5, -2, 2], [0, 0, 1], [-4, -1.5, 2], [4.5, -2, 2], [-3, -1, 2], [-5, 2.5, 2]][b],
  elements: [
    fig(OLA, -6.3, -4.4, 2.4, 0, { rot: 0.55, tag: 'Ola', tagDy: 0.15 }),
    fig(ROBOT.nurse, -0.4, -3.6, 6.2, 1, { act: (b) => (b === 5 ? 'point' : 'idle') }),
    bubble(T('Hvorfor eksisterer du?', 'Why do you exist?'), -6.2, -1.15, 2, { cls: 'think', w: 2.6 }),
    ...THINKERS.map(([g, name], i) => fig(g, 2.6 + i * 1.05, -4.45, 1.85, 3, { rot: -0.15 + (i - 2) * 0.12, tag: name, tagDy: 0.08 + (i % 2) * 0.3, cls: 'small', delay: 0.1 * i })),
    bubble(T('Hvorfor eksisterer du?', 'Why do you exist?'), 4.75, -1.55, 3, { cls: 'think', w: 2.6 }),
    bubble(T('LLM-er er unikt egnet til å se forbindelser og vedlikeholde', 'LLMs are uniquely suited to seeing connections and maintaining'), -3.25, -0.9, 4, { w: 2.9 }),
    ...CHECKS.map((c, i) => text(`<span class="tick">✓</span>${c}`, -7.3, 4.0 - i * 0.62, 7, 5, { cls: 'check', delay: 0.15 + i * 0.35 })),
  ],
};

// ------------------------------------------------------------ slide 14: merging knowledge bases
const N14 = [
  ['e0', 'Undervannsbrønn', 'E', 0, 0, { hub: 1 }], ['eDrill', 'Boring', 'E', 125, 1], ['eWell', 'Brønnteknikk', 'E', 90, 1], ['eRes', 'Reservoar', 'E', 160, 1],
  ['eFlow', 'Strømningssikring', 'E', 55, 1], ['eRis', 'Stigerør', 'E', 22, 1.05, { dup: 'ris' }], ['eChk', 'Choke', 'E', -22, 1.05, { dup: 'chk' }],
  ['eComp', 'Komplettering', 'E', 200, 1], ['eBop', 'BOP', 'E', 240, 0.95], ['eOld', 'Prosedyre rev. 3', 'E', 290, 1.05, { stale: 1 }],
  ['p0', 'Reguleringssystem', 'P', 0, 0, { hub: 1 }], ['pPid', 'PID', 'P', 125, 1], ['pDyn', 'Prosessdynamikk', 'P', 90, 1], ['pOpt', 'Optimalisering', 'P', 55, 1],
  ['pRis', 'Stigerør', 'P', 158, 1.05, { dup: 'ris' }], ['pChk', 'Choke', 'P', 202, 1.05, { dup: 'chk' }], ['pPls', 'PLS', 'P', 20, 1], ['pSens', 'Sensorer', 'P', -20, 1],
  ['pEst', 'Tilstandsestimering', 'P', 245, 1], ['pOld', 'Datablad 2019', 'P', 295, 1.05, { stale: 1 }],
  ['io', 'Integrerte operasjoner', 'S', 0, 0, { hub: 1, io: 1 }],
].map(([id, label, c, ang, rad, f = {}]) => ({ id, label, c, ang: ang * Math.PI / 180, rad, ...f }));
const E14 = [];
for (const n of N14) if (!n.hub) E14.push([n.c === 'E' ? 'e0' : 'p0', n.id]);
for (const [a, b] of [['eFlow', 'eRis'], ['eRes', 'eWell'], ['eDrill', 'eWell'], ['eComp', 'eBop'], ['eRis', 'eChk'], ['eOld', 'eComp'], ['pPid', 'pDyn'], ['pSens', 'pEst'], ['pPls', 'pSens'], ['pOpt', 'pDyn'], ['pOld', 'pPls'], ['pChk', 'pEst']]) E14.push([a, b]);
for (const [a, b] of [['io', 'e0'], ['io', 'p0'], ['io', 'eRis'], ['io', 'eChk'], ['eRis', 'pPid'], ['eFlow', 'pDyn']]) E14.push([a, b, { c: 'S', cross: 1, dash: 1 }]);
const PATH = ['eFlow', 'eRis', 'pPid', 'p0', 'eChk'];
const centre14 = (c, b) => (b === 0 ? [c === 'E' ? -3.3 : 3.3, 1.3] : b < 3 ? [c === 'E' ? -3.0 : 3.0, -1.72] : [c === 'E' ? -3.55 : 3.55, -1.72]);
const AGENT14 = [6.75, -4.4];
// the agent's walk through the graph on click 5, in seconds since the click
const T0 = 0.9, SEG = 0.75;
let since14 = () => 0;
const seg14 = () => (since14() - T0) / SEG;
const G14 = new Graph({
  nodes: N14.map((n) => ({ ...n, c2: 'S', hideLabel: (b) => n.c === 'P' && n.dup && b >= 3 })),
  edges: E14,
  target: (n, b) => {
    if (n.io) return { x: 0, y: -1.72, a: b >= 3 ? 1 : 0, s: b >= 3 ? 1 : 0.2, alt: 0 };
    const [cx, cy] = centre14(n.c, b), r = b === 0 ? 1.15 : 1.0;
    let x = cx + Math.cos(n.ang) * n.rad * r * 1.15, y = cy + Math.sin(n.ang) * n.rad * r * 0.95, a = 1, alt = 0, red = 0, delay, dur;
    if (n.dup && b >= 3) { x = 0; y = n.dup === 'ris' ? -0.72 : -2.72; alt = 1; if (n.c === 'P') a = 0; }
    if (n.stale && b >= 6) { red = 1; y -= 1.6; a = 0; delay = 0.9; dur = 1.2; }
    return { x, y, a, s: 1, alt, red, delay, dur };
  },
  edgeOn: (e, b) => (e[2]?.cross ? (b >= 3 ? 1 : 0) : 1),
  hot: (id) => {
    if (G14.build !== 5) return 0;
    const i = PATH.indexOf(id);
    return i >= 0 && seg14() >= i + 1 ? 1 : 0;
  },
  extra: (ctx, S) => {
    if (ctx.b !== 5) return;
    since14 = () => ctx.since;
    const sg = seg14(), pts = [[AGENT14[0] - 0.4, AGENT14[1] + 1.6], ...PATH.map((id) => [S[id].x, S[id].y]), [AGENT14[0] - 0.4, AGENT14[1] + 1.6]];
    const i = Math.floor(sg), f = sg - i;
    if (sg < 0 || i >= pts.length - 1) return;
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    const { over: c, slide: sl } = ctx, [px, py] = sl.P(x, y, 0.5);
    c.save(); c.fillStyle = col('ink'); c.shadowColor = col('S'); c.shadowBlur = sl.U(0.3);
    c.beginPath(); c.arc(px, py, sl.U(0.08), 0, 7); c.fill(); c.restore();
  },
});
const DONE14 = T0 + (PATH.length + 1) * SEG + 0.3;
const panel14 = (x0, y0, x1, y1, c, label) => (ctx, s) => {
  const { under: g, slide: sl } = ctx, [px0, py0] = sl.P(x0, y1), [px1, py1] = sl.P(x1, y0);
  g.save();
  g.globalAlpha = s.a * (s.dim ?? 1);
  g.fillStyle = col(c) + '18'; g.strokeStyle = col(c) + '66'; g.lineWidth = sl.U(0.025);
  g.beginPath(); g.roundRect(px0, py0, px1 - px0, py1 - py0, sl.U(0.25)); g.fill(); g.stroke();
  g.fillStyle = col(c); g.font = `700 ${sl.U(0.2)}px "Instrument Sans", system-ui, sans-serif`; g.textBaseline = 'top';
  g.fillText(label, px0 + sl.U(0.18), py0 + sl.U(0.14));
  g.restore();
};
const H14 = {
  id: 'ctrl-14', builds: 6,
  focus: (b) => [[0, 1.5, 1], [0, -1, 2], [-3, -1.5, 3], [0, -1.5, 2], [3, -1.5, 3], [1, -1.5, 3], [-2, -1.5, 3]][b],
  onBuild: (b) => { if (b !== 5) since14 = () => 0; },
  elements: [
    title(T('Sammenslåing av kunnskapsbaser', 'Merging knowledge bases')),
    draw(panel14(-5.2, -0.05, -1.4, 2.95, 'E', T('BRØNN OG UNDERVANN', 'WELLS AND SUBSEA')), 0, { at: (b) => ({ dim: b ? 0.3 : 1 }) }),
    draw(panel14(1.4, -0.05, 5.2, 2.95, 'P', T('PROSESSREGULERING', 'PROCESS CONTROL')), 0, { at: (b) => ({ dim: b ? 0.3 : 1 }) }),
    draw(panel14(-5.6, -3.4, 5.6, -0.25, 'S', T('FELLES KUNNSKAPSGRAF', 'COMBINED KNOWLEDGE GRAPH')), 1),
    { kind: 'graph', graph: G14 },
    fig('grey_beard_lead', -7.35, 0.05, 2.4, 0, { rot: 0.55 }),
    fig('glasses_engineer', -6.25, 0.05, 2.4, 0, { rot: 0.45, tag: T('Brønnteamet', 'The well team'), tagDx: -0.55 }),
    fig(OLA, 6.75, 0.05, 2.4, 0, { rot: -0.5, tag: 'Ola', act: (b) => (b === 4 ? 'point' : 'idle') }),
    fig(ROBOT.nurse, -6.75, -4.4, 2.4, 2, { rot: 0.5, tag: 'Linter', act: (b) => (b === 3 || b === 6 ? 'point' : 'idle') }),
    fig(ROBOT.buddy, ...AGENT14, 2.4, 4, { rot: -0.5, tag: 'Frankenbot', tint: '#8fd19e', act: (b) => (b === 5 ? 'point' : 'idle') }),
    arrow([-3.3, 0.0], [-0.5, -0.12], '', 1, { bend: -0.25, at: (b) => ({ fade: b >= 3 ? 0.35 : 1 }) }),
    arrow([3.3, 0.0], [0.5, -0.12], T('slå sammen', 'merge'), 1, { bend: 0.25, at: (b) => ({ fade: b >= 3 ? 0.35 : 1 }) }),
    arrow([-6.1, -2.25], [-5.35, -1.55], T('rydder', 'tidies'), 3, { bend: -0.3, labelOff: [0.1, 0.45] }),
    arrow([7.15, -0.15], [7.15, -1.9], T('samhandler med', 'works with'), 4, { bend: 0.35, labelOff: [-1.7, 0.25] }),
    arrow([5.25, -2.85], [6.0, -3.2], T('leser', 'reads'), 4, { bend: 0.3, labelOff: [0, -0.35] }),
    text(T('Én felles wiki · én kilde til sannhet', 'One combined wiki · one source of truth'), 0, -3.5, 8, 3, { cls: 'foot', anchor: [0.5, 0], until: 5 }),
    bubble(T('Hvorfor slugger brønn 3 om natta?', 'Why does well 3 slug at night?'), 6.55, 2.95, 5, { anchor: [1, 1], w: 3.4 }),
    { kind: 'bubble', cls: 'agent', html: T('Stigerøret slugger når choken står lavt. Anti-slug-regulatoren (PID) bør på.', 'The riser slugs when the choke is low. The anti-slug controller (PID) should be on.'), x: 0, y: -3.45, w: 7, anchor: [0.5, 0], from: 5, until: 6, delay: DONE14 },
  ],
};

export const LIVE_SLIDES = Object.fromEntries([H02, H08, H09, H01, H11, H12, H13, H14].map((s) => [s.id, s]));
