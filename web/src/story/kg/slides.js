// The knowledge-graph slides of chapter 6 (deck slides 7 to 14), one entry
// per slide id from story.json. builds = clicks after the first picture, as
// in the deck. Elements: see engine.js. People are stand-ins (Ola, the well
// team), as everywhere in the public build.
import { T } from '../lang.js';
import { Graph } from './graph.js';
import { books, globe, col, KG_LOOK } from './engine.js';
import { vscodeWindow, vscodeStep, fitVSCode } from '../vscode.js';

// ------------------------------------------------------------ helpers
const title = (html, from = 0) => ({ kind: 'title', html, x: -7.2, y: 4.0, from });
const sub = (html, from = 0) => ({ kind: 'text', cls: 'sub', html, x: -7.2, y: 2.85, from });
const text = (html, x, y, w, from = 0, o = {}) => ({ kind: 'text', html, x, y, w, from, ...o });
const fig = (glb, x, y, h, from = 0, o = {}) => ({ kind: 'figure', glb, x, y, h, from, ...o });
const prop = (make, x, y, from = 0, o = {}) => ({ kind: 'prop', make, x, y, from, ...o });
const arrow = (p0, p1, label, from = 0, o = {}) => ({ kind: 'arrow', p0, p1, label, from, ...o });
const bubble = (html, x, y, from = 0, o = {}) => ({ kind: 'bubble', html, x, y, from, anchor: [0.5, 1], ...o });
const draw = (fn, from = 0, o = {}) => ({ kind: 'draw', draw: fn, from, ...o });

const ROBOT = { buddy: 'control_buddy', scholar: 'control_buddy_scholar', nurse: 'control_buddy_nurse', franken: 'control_buddy_franken' };
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
const HALF = 0.42;   // half portraits: the share of the height cut off
const H02 = {
  id: 'h-02', builds: 3,
  focus: (b) => [[0, 0, 0], [-4.8, 0, 3], [0, 0, 3], [4.8, 0, 3]][b],
  elements: [
    title(T('CtrlBuddy – hva er det?', 'CtrlBuddy – what is it?')),
    sub(T('… Én av flere agenter', '… One of several agents')),
    ...['buddy', 'scholar', 'nurse'].flatMap((k, i) => [
      // half portraits, as in the deck (Adriaen, 2026-11-01): big, cut off at the waist
      fig(ROBOT[k], -4.8 + i * 4.8, -4.3, 6.4, i + 1, { rot: [0.25, 0, -0.25][i], cut: HALF }),
      text(ROBOT_TEXT[k], -4.8 + i * 4.8, -2.05, 4.3, i + 1, { cls: 'robot', anchor: [0.5, 0] }),
    ]),
  ],
};

// h-02 on the same monitor as ctrl-08s, the beat after it (Adriaen, 2026-11-01): the story opens
// the chapter on the screen and stays there; h-02 itself is kept for the full-screen run
const H02S = { ...H02, id: 'h-02s', screen: 'Desk1Mon0Screen', zoomAt: Infinity };

// ------------------------------------------------------------ slide 8: the team loop
const LOOP = { buddy: [0, 0.2], scholar: [-5.1, -3.6], nurse: [5.1, -3.6], books: [0, -4.2] };
const H08 = {
  id: 'ctrl-08', builds: 5,
  glideIn: true,   // the agents slide over from h-02, the beat before
  focus: (b) => [[0, 0, 0], [0, 0, 1], [-2.5, -2.5, 3], [0, -1.5, 3], [2.5, -2.5, 3], [3, 1.5, 2]][b],
  elements: [
    title(T('CtrlBuddy – hva er det?', 'CtrlBuddy – what is it?')),
    sub(T('… Én av flere agenter', '… One of several agents')),
    // half portraits, as on h-02 (Adriaen, 2026-11-01): cut at the same share, so the glide over
    // from h-02 keeps them cut; feet set below their spot so the top part stands where the whole one did
    ...[['buddy', 2.9, 0], ['scholar', 2.5, 0.45], ['nurse', 2.5, -0.45]].map(([k, h, rot]) =>
      fig(ROBOT[k], LOOP[k][0], LOOP[k][1] - HALF * h / (1 - HALF), h / (1 - HALF), 0, { rot, cut: HALF })),
    arrow([-1.3, 1.7], [-4.3, -0.9], T('Leder', 'Leads'), 1, { bend: 0.22, labelOff: [-0.55, 0.45], chunky: true }),
    arrow([1.3, 1.7], [4.3, -0.9], T('Leder', 'Leads'), 1, { bend: -0.22, labelOff: [0.55, 0.45], chunky: true }),
    prop(() => books(7), ...LOOP.books, 2, { scale: 1.25, rot: 0.25 }),
    arrow([-3.9, -3.3], [-1.0, -3.5], T('Skriver', 'Writes'), 2, { bend: 0.25, labelOff: [0, -0.5], chunky: true }),
    draw((ctx) => stream(ctx, [-4.3, -2.3], [-0.5, -3.3], { kind: 'page' }), 2),
    arrow([0, -2.6], [0, -0.5], T('Blir lest av', 'Is read by'), 3, { bend: 0, lw: 0.12, labelOff: [1.2, 0], chunky: true }),
    draw((ctx) => stream(ctx, [0, -2.7], [0, -0.3], { kind: 'read', lift: 0, speed: 0.9 }), 3),
    arrow([3.9, -3.3], [1.0, -3.5], T('Korrigerer', 'Corrects'), 4, { bend: -0.25, labelOff: [0, -0.5], chunky: true }),
    draw((ctx) => stream(ctx, [4.3, -2.3], [0.5, -3.3], { kind: 'tick', n: 2, speed: 0.5 }), 4),
    fig(OLA, 6.3, 1.1, 2.5, 5, { seat: 'props/workstation.glb', rot: -1.05, act: () => 'typing' }),
    arrow([1.6, 2.4], [4.7, 2.75], T('Samhandler med', 'Works with'), 5, { bend: -0.25, both: true, labelOff: [0, 0.52], chunky: true }),
  ],
};

// The same team loop played out on a monitor in the room (Adriaen, 2026-11-01, a variant of
// ctrl-08): the camera stays on the screen, and on the last click, where the orchestrator
// works with the user, it pulls back to show the screen and Adriaen at his desk, the green
// arrow between them drawn in the room (main.js screenSlide)
const H08S = {
  ...H08, id: 'ctrl-08s',   // glideIn as ctrl-08: the agents slide over from h-02 while the slide flies onto the monitor
  screen: 'Desk1Mon0Screen', zoomAt: 5, zoomShot: 'agentDesk', who: 'operator',
  roomArrow: T('Samhandler med', 'Works with'),
  elements: H08.elements.slice(0, -2),
};

// ------------------------------------------------------------ slide 9: just .agent.md files
// The whole slide is VS Code (vscode.js, the look Adriaen picked): an empty
// window, then the three agent files open one by one, each agent standing in
// its own editor group under its file, then the agent picker in the chat.
const AGENT_FILES = {
  buddy: ['CtrlBuddy', T(
    ['---', 'name: CtrlBuddy', 'description: Reguleringsingeniørens orkestrator. Diagnostikk, navigasjon, spørsmål og rapporter om reguleringssløyfer.', "tools: ['edit', 'codebase', 'fetch', 'search', 'runCommands']", "agents: ['Compiler', 'Linter']", '---', '', '# CtrlBuddy — Orkestrator', '', 'Du eier steg 1, 3, 4 og 5 i Karpathys pipeline:', 'ta inn spørsmålet, naviger i wikien,', 'diagnostiser, lag utdata.', '', '## Delegering', '- Nye kilder i `raw/` → @Compiler', '- Helsesjekk etter endringer → @Linter'],
    ['---', 'name: CtrlBuddy', "description: The control engineer's orchestrator. Diagnostics, navigation, questions and reports on control loops.", "tools: ['edit', 'codebase', 'fetch', 'search', 'runCommands']", "agents: ['Compiler', 'Linter']", '---', '', '# CtrlBuddy — Orchestrator', '', "You own steps 1, 3, 4 and 5 of Karpathy's pipeline:", 'take the question in, navigate the wiki,', 'diagnose, produce the output.', '', '## Delegating', '- New sources in `raw/` → @Compiler', '- Health check after changes → @Linter'])],
  scholar: ['Compiler', T(
    ['---', 'name: Compiler', 'description: Leser filer fra raw/ og lager atomiske wiki-artikler. Eier Karpathy steg 2 (Kompiler).', "tools: ['edit', 'codebase', 'fetch', 'search']", '---', '', '# Compiler — Raw → Wiki', '', 'Inn: artikler, rapporter, leverandør-', 'dokumenter og datasett i `raw/`.', 'Ut: én idé per notat i `wiki/`, med kilder.', '', '## Regler', '- Ett begrep per notat: `pid-regulator.md`', '- Lenk beslektede notater med [[wikilenker]]', '- Oppgi kilden: `kilde: raw/…`'],
    ['---', 'name: Compiler', 'description: Reads files from raw/ and writes atomic wiki articles. Owns Karpathy step 2 (Compile).', "tools: ['edit', 'codebase', 'fetch', 'search']", '---', '', '# Compiler — Raw → Wiki', '', 'In: papers, reports, vendor documents', 'and data sets in `raw/`.', 'Out: one idea per note in `wiki/`, with sources.', '', '## Rules', '- One concept per note: `pid-controller.md`', '- Link related notes with [[wikilinks]]', '- Give the source: `source: raw/…`'])],
  nurse: ['Linter', T(
    ['---', 'name: Linter', 'description: Validerer wiki-helse. Frontmatter, ødelagte lenker, motsetninger, foreldreløse notater. Eier Karpathy steg 6 (Lint).', "tools: ['codebase', 'runCommands', 'search']", '---', '', '# Linter — Wiki-helse', '', 'Kjør etter at @Compiler har lagt til', 'artikler, før en større overlevering,', 'og hver uke.', '', '## Sjekkliste', '- Alle notater har `kilde:` og `oppdatert:`', '- Ingen [[lenker]] til notater som mangler', '- Ingen notater uten innkommende lenker'],
    ['---', 'name: Linter', "description: Checks the wiki's health. Front matter, broken links, contradictions, orphan notes. Owns Karpathy step 6 (Lint).", "tools: ['codebase', 'runCommands', 'search']", '---', '', '# Linter — Wiki health', '', 'Run after @Compiler has added', 'articles, before a bigger handover,', 'and weekly.', '', '## Checklist', '- Every note has `source:` and `updated:`', '- No [[links]] to notes that are missing', '- No notes without incoming links'])],
};
const AGENTS9 = ['buddy', 'scholar', 'nurse'];
const H9 = 3.0 * 0.85 / (1 - HALF);   // the half portraits' whole height: their top part a little shorter than the whole figures were
// The editor area of the 1440×810 window in slide units (activity bar 48 px +
// Explorer 230 px on the left, chat 340 px on the right), and where an agent
// stands in group i of n
const EDS = { x0: -8 + 278 / 90, x1: 8 - 340 / 90 };
const groupX = (i, n) => EDS.x0 + (i + 0.5) * (EDS.x1 - EDS.x0) / n;
const H09 = {
  id: 'ctrl-09', builds: 4,
  focus: (b) => [[0, 0, 0], [-1.5, 0, 1], [-1, 0, 1], [0, 0, 1], [3, 0, 1]][b],
  onBuild: (b, sl) => { const el = sl.html.querySelector('.vsw'); if (el) vscodeStep(el, b); },
  elements: [
    // VS Code's editor background under the 3D, so the agents stand inside their groups
    draw((ctx) => {
      const el = ctx.slide.html.querySelector('.vsw');
      if (el) fitVSCode(el);
      if (KG_LOOK !== 'b') { ctx.under.fillStyle = '#1f1f1f'; ctx.under.fillRect(0, 0, ctx.slide.W, ctx.slide.H); }
    }),
    {
      kind: 'card', cls: 'vsw see-through', x: 0, y: 0, w: 16, h: 9, anchor: [0.5, 0.5],
      html: vscodeWindow({
        tree: [{ t: '.github', dir: 'open' }, { t: 'agents', lvl: 1, dir: 'open', hl: true },
          ...AGENTS9.map((k, i) => ({ t: `${AGENT_FILES[k][0]}.agent.md`, lvl: 2, from: i + 1, git: 'U' })),
          { t: 'instructions', lvl: 1, dir: 'closed' }, { t: 'prompts', lvl: 1, dir: 'closed' },
          ...['raw', 'wiki', 'scripts', 'tests'].map((t) => ({ t, dir: 'closed' })), { t: 'README.md' }],
        groups: AGENTS9.map((k, i) => {
          const [name, lines] = AGENT_FILES[k];
          return { tab: `${name}.agent.md`, crumbs: ['.github', 'agents', `${name}.agent.md`], lines, cur: 2, from: i + 1 };
        }),
        chat: {
          msgs: [
            { me: true, from: 4, t: T('Hvor bor dere egentlig?', 'Where do you actually live?') },
            { from: 4, t: T('Vi er bare <code>.agent.md</code>-filer i <code>.github/agents</code> i dette prosjektet. Velg hvem av oss du vil snakke med nedenfor.', 'We are just <code>.agent.md</code> files in <code>.github/agents</code> in this project. Pick which of us to talk to below.') },
          ],
          menu: { from: 4, items: AGENTS9.map((k) => [T(...{ buddy: ['CtrlBuddy', 'CtrlBuddy'], scholar: ['Compiler', 'Compiler'], nurse: ['Linter', 'Linter'] }[k]), T(...{ buddy: ['orkestrator', 'orchestrator'], scholar: ['raw → wiki', 'raw → wiki'], nurse: ['wiki-helse', 'wiki health'] }[k])]) },
        },
        status: 'Ln 2, Col 7',
      }),
    },
    // each agent under its own file; the groups split as the files open
    // half portraits, as on h-02 and ctrl-08 (Adriaen, 2026-11-01): cut where their feet stood
    ...AGENTS9.map((k, i) => fig(ROBOT[k], groupX(i, 3), -4.1 - HALF * H9, H9, i + 1, {
      cut: HALF,
      rot: [0.25, 0, -0.25][i], dur: 0.7,
      at: (b) => ({ x: groupX(i, Math.max(i + 1, Math.min(b, 3))) }),
    })),
    draw((ctx) => { const k = Math.min(1, ctx.since * 1.2); ring(ctx, -5.8, 2.72, 1.55, 0.6, k); ring(ctx, 6.1, -1.86, 1.8, 0.55, Math.max(0, k * 1.5 - 0.5)); }, 4, { delay: 0.6 }),
  ],
};

// ctrl-09 on the same monitor as ctrl-08s, the camera back in on it (Adriaen, 2026-11-01)
const H09S = { ...H09, id: 'ctrl-09s', screen: 'Desk1Mon0Screen', zoomAt: Infinity };

// ------------------------------------------------------------ slide 13, again (Adriaen, 2026-11-01)
// The same VS Code on the monitor, the others closed: Linter.agent.md alone,
// the linter agent under it (gliding over from its group on ctrl-09s). On the
// next beat (ctrl-13z) the camera pulls back to Adriaen at his desk, the linter
// waving on the screen to the right (content.js), and on the click he thinks
// "Why do you exist?" (screenSlide.js think)
const H13S = {
  id: 'ctrl-13s', builds: 0, glideIn: true, onBuild: H09.onBuild,
  screen: 'Desk1Mon0Screen', zoomAt: Infinity,
  elements: [
    H09.elements[0],
    {
      kind: 'card', cls: 'vsw see-through', x: 0, y: 0, w: 16, h: 9, anchor: [0.5, 0.5],
      html: vscodeWindow({
        tree: [{ t: '.github', dir: 'open' }, { t: 'agents', lvl: 1, dir: 'open' },
          ...AGENTS9.map((k) => ({ t: `${AGENT_FILES[k][0]}.agent.md`, lvl: 2, git: 'U', sel: k === 'nurse' })),
          { t: 'instructions', lvl: 1, dir: 'closed' }, { t: 'prompts', lvl: 1, dir: 'closed' },
          ...['raw', 'wiki', 'scripts', 'tests'].map((t) => ({ t, dir: 'closed' })), { t: 'README.md' }],
        groups: [{ tab: 'Linter.agent.md', crumbs: ['.github', 'agents', 'Linter.agent.md'], lines: AGENT_FILES.nurse[1], cur: 2 }],
        chat: {
          pick: 'Linter',
          msgs: [{ me: true, t: T('Hvor bor dere egentlig?', 'Where do you actually live?') },
            { t: T('Vi er bare <code>.agent.md</code>-filer i <code>.github/agents</code> i dette prosjektet. Velg hvem av oss du vil snakke med nedenfor.', 'We are just <code>.agent.md</code> files in <code>.github/agents</code> in this project. Pick which of us to talk to below.'), who: 'CtrlBuddy' }],
        },
        status: 'Ln 2, Col 7',
      }),
    },
    fig(ROBOT.nurse, groupX(0, 1), -4.1 - HALF * H9, H9, 0, { cut: HALF, rot: -0.25 }),
  ],
};
const H13Z = {
  ...H13S, id: 'ctrl-13z', builds: 1,
  zoomAt: 0, zoomShot: 'agentDesk', who: 'operator',
  think: T('Hvorfor eksisterer du?', 'Why do you exist?'), thinkAt: 1,
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
// What the wiki is: one atomic article per idea, linked to related ideas.
// Laid out by hand so related concepts sit together: control theory (purple)
// around the PID hub, the applications on the platform (blue) to the right,
// the equipment they act on (green) along the bottom. Faint unnamed notes
// behind them stand for the rest of the 600-odd.
const WIKI = [
  // id, label no, label en, x, y, folder, hub
  ['pid', 'PID-regulator', 'PID controller', -3.9, -1.3, 'E', 1],
  ['model', 'Prosessmodeller', 'Process models', -5.9, -0.2, 'E'],
  ['fb', 'Tilbakekobling', 'Feedback', -6.3, -1.9, 'E'],
  ['disc', 'PID-diskretisering', 'PID discretisation', -2.3, 0.15, 'E'],
  ['windup', 'Integratorvindup', 'Integrator windup', -5.4, -3.1, 'E'],
  ['cascade', 'Kaskaderegulering', 'Cascade control', -2.2, -2.5, 'E'],
  ['ff', 'Foroverkobling', 'Feedforward', -4.0, 0.55, 'E'],
  ['step', 'Steptest', 'Step test', -3.9, -3.6, 'E'],
  ['fopdt', 'FOPDT-modell', 'FOPDT model', -7.0, 0.55, 'E'],
  ['bode', 'Bode-plott', 'Bode plot', -7.0, -3.4, 'E'],
  ['slug', 'Anti-slug-regulering', 'Anti-slug control', -0.3, -1.1, 'P', 1],
  ['level', 'Separatornivå', 'Separator level', 0.4, -3.2, 'P'],
  ['surge', 'Antisurge', 'Anti-surge', 0.6, 0.45, 'P'],
  ['choke', 'Strupeventil', 'Choke valve', 0.9, -2.0, 'S'],
  ['sep', 'Separator', 'Separator', -1.4, -3.9, 'S'],
  ['valve', 'Ventilkarakteristikk', 'Valve characteristic', -1.0, 0.95, 'S'],
];
const WIKI_LINKS = [
  ['pid', 'model'], ['pid', 'fb'], ['pid', 'disc'], ['pid', 'windup'], ['pid', 'cascade'], ['pid', 'ff'], ['pid', 'step'],
  ['model', 'fopdt'], ['model', 'step'], ['fb', 'bode'], ['fb', 'windup'], ['model', 'ff'], ['bode', 'windup'],
  ['slug', 'pid'], ['slug', 'choke'], ['slug', 'cascade'], ['slug', 'model'], ['level', 'pid'], ['level', 'sep'], ['level', 'cascade'],
  ['surge', 'pid'], ['surge', 'ff'], ['choke', 'valve'], ['valve', 'surge'], ['sep', 'step'], ['level', 'choke'], ['disc', 'valve'],
];
const PID_NEAR = new Set(['pid', ...WIKI_LINKS.filter((l) => l.includes('pid')).flat()]);
const PID_BACK = new Set(WIKI_LINKS.filter(([, b]) => b === 'pid').map(([a]) => a));   // the notes that link here
// the faint rest: seeded scatter clear of the named notes, each linked to its nearest named one
const FILL = (() => {
  let sd = 11;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const nodes = [], edges = [];
  while (nodes.length < 46) {
    const x = -7.3 + rnd() * 8.4, y = -4.2 + rnd() * 5.3;
    const near = WIKI.map((w) => [Math.hypot(w[3] - x, w[4] - y), w[0]]).sort((a, b) => a[0] - b[0])[0];
    if (near[0] < 0.55 || nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 0.45)) continue;
    nodes.push({ i: nodes.length, x, y, near: near[1] });
  }
  return { nodes, edges };
})();
const G11 = new Graph({
  nodes: [
    ...WIKI.map(([id, no, en, , , c, hub]) => ({ id, label: T(no, en), c, hub: !!hub })),
    ...FILL.nodes.map((n) => ({ id: 'f' + n.i, c: 'grey', small: true })),
  ],
  edges: [
    ...WIKI_LINKS.map(([a, b]) => [a, b, { c: WIKI.find((w) => w[0] === a)[5] }]),
    ...FILL.nodes.map((n) => ['f' + n.i, n.near]),
  ],
  r: 0.12, hubR: 0.2,
  target: (n, b) => {
    const w = WIKI.find((x) => x[0] === n.id);
    if (!w) {
      const p = FILL.nodes[+n.id.slice(1)];
      return { x: p.x, y: p.y, a: b >= 1 ? 0.3 : 0, s: b >= 1 ? 1 : 0, delay: 0.5 + (+n.id.slice(1) % 30) * 0.02 };
    }
    const i = WIKI.indexOf(w), dim = b >= 2 && !PID_NEAR.has(n.id);
    const back = b >= 3 && PID_BACK.has(n.id);
    return { x: w[3], y: w[4], a: b >= 1 ? (dim ? 0.3 : 1) : 0, s: b >= 1 ? (n.id === 'pid' && b >= 2 ? 1.5 : back ? 1.3 : 1) : 0, delay: i * 0.06 };
  },
  edgeOn: ([a], bd) => (a.startsWith('f') ? (bd >= 2 ? 0.25 : 0.5) : 1),
  hot: (id, t) => (G11.build === 3 && PID_BACK.has(id) ? 1 : G11.build >= 2 && id === 'pid' ? 0.5 + 0.5 * Math.sin(t * 4) : 0),
});
const NOTE_AT = { x: 1.55, y: 3.4 };
const H11 = {
  id: 'ctrl-11', builds: 3,
  focus: (b) => [[-4, 2, 2], [-3, -1.5, 2], [2, 0, 2], [0, -1.5, 2]][b],
  elements: [
    title('Wiki?'),
    prop(() => books(5), -3.2, -1.6, 0, { scale: 1.5, rot: 0.4, until: 1 }),
    prop(globe, 2.4, -1.0, 0, { scale: 1.4, until: 1 }),
    text('W', 2.4, -0.3, 1, 0, { cls: 'globe-w', anchor: [0.5, 0.5], until: 1 }),
    text(T('Et oppslagsverk av korte artikler som lenker til hverandre', 'A reference work of short articles that link to each other'), 0, -3.3, 12, 0, { cls: 'sub center', anchor: [0.5, 0.5], until: 1 }),
    { kind: 'graph', graph: G11, from: 1 },
    text(T('<b>●</b> Én node = én artikkel, én idé&nbsp;&nbsp;&nbsp;<b>—</b> én lenke mellom to beslektede', '<b>●</b> One node = one article, one idea&nbsp;&nbsp;&nbsp;<b>—</b> one link between two related ones'), -7.2, 2.6, 9.5, 1, { cls: 'sub', until: 2 }),
    // the PID note, opened out of its node
    draw((ctx) => {
      const { under: c, slide: sl } = ctx, k = Math.min(1, ctx.since * 1.6);
      const [x0, y0] = sl.P(-3.9, -1.3), [x1, y1] = sl.P(NOTE_AT.x, NOTE_AT.y - 0.9);
      c.save(); c.globalAlpha = 0.8; c.strokeStyle = col('E'); c.lineWidth = sl.U(0.03); c.setLineDash([sl.U(0.08), sl.U(0.06)]);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); c.stroke(); c.restore();
    }, 2),
    {
      kind: 'card', cls: 'note wiki', w: 6.3, anchor: [0, 0], from: 2,
      at: (b) => (b >= 2 ? { x: NOTE_AT.x, y: NOTE_AT.y, zoom: 1 } : { x: -3.9, y: -1.3, zoom: 0.1 }),
      html: `<div class="body"><div class="path">wiki / ${T('reguleringsteori', 'control-theory')} / <b>PID-${T('regulator', 'controller')}.md</b></div><h3>PID-${T('regulator', 'controller')}</h3><dl><dt>status</dt><dd>${T('aktiv', 'active')}</dd><dt>type</dt><dd>${T('begrep', 'concept')}</dd><dt>${T('avhenger-av', 'depends-on')}</dt><dd><a>${T('Prosessmodeller', 'Process models')}</a> · <a>${T('Tilbakekobling', 'Feedback')}</a></dd><dt>tags</dt><dd><span>${T('regulering', 'control')}</span><span>pid</span><span>hub</span></dd><dt>${T('kilde', 'source')}</dt><dd>raw/${T('lærebok', 'textbook')}-kap11.pdf</dd></dl>
<p>${T('Regner pådraget ut fra avviket e = r − y med tre ledd: P (nåværende avvik), I (akkumulert avvik) og D (endringsrate). De fleste regulatorer i prosessindustrien er i praksis PI.', 'Computes the output from the error e = r − y with three terms: P (present error), I (accumulated error) and D (rate of change). Most process-industry controllers are in practice PI.')}</p>
<div class="formula">u(t) = Kp · ( e + 1/Ti · ∫ e dτ + Td · de/dt )</div><p>${T('Se også', 'See also')}: <a>${T('Integratorvindup', 'Integrator windup')}</a> <a>${T('Kaskaderegulering', 'Cascade control')}</a> <a>${T('PID-diskretisering', 'PID discretisation')}</a></p>
<p class="links">${T('Lenker hit', 'Linked from')}: <a>Anti-slug</a> <a>${T('Separatornivå', 'Separator level')}</a> <a>Antisurge</a></p></div>`,
    },
    text(T('Agentene skriver og vedlikeholder artiklene. Lenkene gjør det til en graf de kan navigere.', 'The agents write and keep up the articles. The links make it a graph they can navigate.'), NOTE_AT.x, -2.4, 6.3, 3, { cls: 'sub wrap' }),
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
    fig(OLA, -3.0, -0.75, 1.8, 0, { seat: 'props/workstation.glb', rot: 0.9, act: () => 'typing' }),
    bubble(T('Les denne artikkelen', 'Read this article'), -4.6, 1.6, 0, { cls: 'think' }),
    fig(ROBOT.scholar, -5.6, -4.4, 3.4, 0, { rot: 0.55 }),
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
    fig(OLA, -6.3, -4.4, 2.4, 0, { rot: 0.55 }),
    fig(ROBOT.nurse, -0.4, -3.6, 6.2, 1, {}),
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
    fig(OLA, 6.75, 0.05, 2.4, 0, { rot: -0.5, act: (b) => (b === 4 ? 'point' : 'idle') }),
    fig(ROBOT.nurse, -6.75, -4.4, 2.4, 2, { rot: 0.5, tag: 'Linter' }),
    fig(ROBOT.franken, ...AGENT14, 2.4, 4, { rot: -0.5, tag: 'Frankenbot' }),
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

// ------------------------------------------------------------ slide 15: conclusion
// The deck's picture (the three agents round a laptop at night) beside the
// bullets, one per click
const H04 = {
  id: 'h-04', builds: 6,
  focus: () => [0, 0, 0],
  elements: [
    title(T('Konklusjon', 'Conclusion')),
    // the deck's own picture, kept (Adriaen, 2026-11-01; cleared for the public build, it has been shown in public)
    { kind: 'img', src: 'slides/h-04-team.webp', x: 1.2, y: 2.75, w: 6.4, h: 6.4, from: 0, cls: 'pic' },
    ...[
      [T('Å sette opp agenter og agentteam er overraskende enkelt, prøv det!', 'Setting up agents and agent teams is surprisingly easy. Try it!'), 0],
      [T('Skaper verdi på flere måter:', 'Creates value in several ways:'), 0],
      [T('Automatiserer kjedelige oppgaver', 'Automates boring tasks'), 1],
      [T('Personlig tilpasset læring med tålmodig lærer', 'Personal learning with a patient teacher'), 1],
      [T('Bra for å lage korte, tilpassede (interaktive) rapporter → økt kunnskapsdeling', 'Good for short, tailored (interactive) reports → more knowledge sharing'), 1],
      [T('«Skills» og kunnskapsbaser er lette å dele og tilpasse til nye områder', 'Skills and knowledge bases are easy to share and adapt to new areas'), 0],
    ].map(([t, sub2], i) => text(`<ul><li>${t}</li></ul>`, sub2 ? -6.5 : -7.2, [2.9, 1.75, 1.15, 0.6, 0.05, -0.95][i], sub2 ? 7.3 : 8.0, i + 1, { cls: sub2 ? 'bullets subb' : 'bullets' })),
  ],
};

export const LIVE_SLIDES = Object.fromEntries([H02, H02S, H08, H08S, H09, H09S, H13S, H13Z, H01, H11, H12, H13, H14, H04].map((s) => [s.id, s]));
