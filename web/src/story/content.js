// Story mode's script: "A day in the life of EIGA". Every chapter, beat,
// card, slide and on-screen text lives here, so the story can be edited
// without touching the engine (story/main.js). The spoken lines are in
// lines.json (rendered to audio by web/scripts/voices.py).
import { FULL, T } from './lang.js';
import { PATHS } from './cast.js';
//
// This repo is public: no real platform numbers, initiative names, or names
// of people. Agents carry generic labels. The private build can override any
// text here from public/story/private/overrides.json (git-ignored), and drop
// slide images into public/story/private/slides/ (see README in story/).
//
// A chapter is a list of beats. Entering a beat applies the `set` of every
// beat before it in the chapter (so going back or jumping lands in the right
// state), then runs its own `do` steps once. Beats wait for the presenter's
// key (Space or →) unless they say `auto`.
//
// Two runs share this file: the default one (SHORT_CHAPTERS: prologue, the
// control room of tomorrow, a rewind to one year ago, presenter-led chapters,
// back to tomorrow, epilogue; design.md 18b/18c), with Norwegian on screen,
// and the three-act version at ?story=full (FULL_CHAPTERS). T(no, en) picks
// the language (lang.js).
//
// `set` keys (all optional, merged in order):
//   act      0 prologue, 1 Yesterday, 2 Today, 3 Tomorrow, 4 epilogue,
//            5 one year ago (strong sepia): colour grade, only with ?grade=1
//   time     game clock, hours
//   shot     camera: desk, band, clock, window, boat, supervisor, table, link,
//            monitor:<screen>, wideRoom, epilogue
//   screens  { screenName: content id } over the default layout
//   cast     { who: { at, anim, look } } where the people are (see cast.js)
//   clipboard { page, ticks } or null
//   stars    { row, show: 'mini' | 'card' | 'all' } or null
//   wi       water injection state: normal, vibration, tripA, tripAll, frozen, fixed
//   alarms   { count, frozen } for the banner
//   graph    0 hidden, 1..5 growth level, and graphOn: 'band' | 'overlay'
//   org      null, or 'chart' / 'chart+graph'
//   overlay  one of: slide:<id>, card:<id>, vote:<id>, log:<id>, call:<who>, phone:<who>, search
//   tool     the Act 2 tool demo running on the zoomed monitor
//   chats    { chatId: messages shown } on the chat screens (CHATS)
//   sound    room (default), alarm, silence
//
// Beats may also carry `card` (a title card shown on entering: { eyebrow,
// text, sub, solid }) and `auto` (go on to the next beat by itself once its
// steps are done). Steps: say, wait, set, clock, chat (one more message),
// card (show or null), rewind (seconds), forward (seconds), and the rest
// listed in main.js run().

export const SPEAKERS = {
  pilot: { name: 'Pilot', model: 'heli_pilot' },
  supervisor: { name: 'Shift supervisor', model: 'blazer_lead' },
  oim: { name: 'OIM', model: 'grey_beard_lead' },
  operator: { name: 'Operator', model: 'bearded_operator' },
  planner: { name: 'Onshore planner', model: 'crop_supervisor' },
  engineer: { name: 'Control engineer, onshore', model: 'glasses_engineer' },
  analyst: { name: 'Reliability engineer, onshore', model: 'curly_analyst' },
  tech: { name: 'Field technician (radio)', model: 'curly_fade_tech' },
  crew: { name: 'Ground crew' },
  agent: { name: 'AI agent (on the screens)' },
};

export const TITLE = 'A day in the life of EIGA';
// TODO(Adriaen): credit wording and Brage's role
// [role, name, who the camera turns to in the cabin, or 'descent' for the
// outside camera as the helicopter comes down onto the deck]
export const CREDITS = [
  ['Story and engineering', 'Adriaen', 'bearded_operator'],
  ['With', 'Brage', 'blazer_lead'],
  // CC BY 3.0 asks for this line wherever the recording plays (see story/README.md)
  ['Music · Wagner, Ride of the Valkyries', 'Philip Milman · CC BY 3.0', 'vessel'],
  ['Built with', 'Claude · GitHub Copilot', 'descent'],
];

export const ACTS = {
  1: { name: 'Yesterday', sub: 'The day as it was' },
  2: { name: 'Today', sub: 'What one engineer can build now' },
  3: { name: 'Tomorrow', sub: 'Agents on one knowledge graph, led by people' },
};

// ---------------------------------------------------------------- tracker

export const STAR_DIMS = ['Production', 'Time', 'Workload', 'Cost'];
export const SAFETY_LINE = 'Safety: never traded';
export const STARS = {
  start: [3, 3, 3, 3],
  yesterday: [2, 1, 1, 2],
  today: [3, 3, 2, 3],
  tomorrow: [5, 4, 4, 4],
};
export const STAR_ROWS = [['Yesterday', 'yesterday'], ['Today', 'today'], ['Tomorrow', 'tomorrow']];

// ---------------------------------------------------------------- clipboard

export const CLIPBOARD = {
  1: { title: 'Day shift · Yesterday', hand: true, tasks: ['Check the plan', 'Unload the boat', 'Receive the chemicals', 'Keep the plant running', 'Hand over'] },
  2: { title: 'Day shift · Today', tasks: ['Step-test finder', 'Riser simulator', 'Anti-slug control', 'Logic tester'] },
  3: { title: 'Day shift · Tomorrow', tasks: ['Receive the chemicals', 'Unload the boat', 'Keep the pumps running', 'Handle the upset', 'Hand over'] },
};
// Ticks: true (done), 'x' (failed), 'late', or an agent's lead's initials
// (Act 3: a lead signed the agent's work).

// ---------------------------------------------------------------- agents

export const AGENTS = {
  chemicals: { label: 'Chemicals agent', icon: 'drum', lead: 'supervisor' },
  procedures: { label: 'Procedure assistant', icon: 'book', lead: 'supervisor' },
  handover: { label: 'Handover agent', icon: 'pen', lead: 'supervisor' },
  steptest: { label: 'Step-test agent', icon: 'wave', lead: 'engineer' },
  simulator: { label: 'Simulator agent', icon: 'cube', lead: 'engineer' },
  logic: { label: 'Logic tester agent', icon: 'gate', lead: 'engineer' },
  rca: { label: 'Root-cause agent', icon: 'search', lead: 'engineer' },
  anomaly: { label: 'Anomaly agent', icon: 'pulse', lead: 'engineer' },
  documents: { label: 'Document checker', icon: 'doc', lead: 'oim' },
  alarms: { label: 'Alarm rationaliser', icon: 'bell', lead: 'supervisor' },
};

export const ORG = [
  { who: 'supervisor', role: 'Shift supervisor · offshore', agents: [
    ['chemicals', 'Acts alone, within the order budget'],
    ['procedures', 'Answers with a citation'],
    ['alarms', 'Groups alarms, never hides a trip'],
    ['handover', 'Drafts; the operator signs'],
  ] },
  { who: 'engineer', role: 'Control engineer · onshore', agents: [
    ['rca', 'Proposes; a person approves'],
    ['anomaly', 'Flags early, plans nothing alone'],
    ['steptest', 'Fits models from history'],
    ['simulator', 'Tests changes off the plant'],
    ['logic', 'Checks logic against the standard'],
  ] },
  { who: 'oim', role: 'OIM · owns all mandates', agents: [
    ['documents', 'Checks MoC against requirements'],
  ] },
];
export const NEVER = ['ESD and safety instrumented functions', 'Bypasses and inhibits of safety functions', 'Permit-to-work sign-off', 'Emergency response', 'Decisions about people'];

// ---------------------------------------------------------------- the knowledge graph
// Nodes: [id, label, kind, level it appears at, links, [x, y]]. Kinds:
// equipment, procedure, requirement, lesson, data, agent. Laid out by hand in
// columns (pumps left, logic and requirements in the middle, the boat right),
// in a box x -1.5..1.5, y -0.9..0.9.
export const GRAPH = [
  ['pumpA', 'Booster pump A', 'equipment', 1, [], [-1.4, -0.3]],
  ['pumpB', 'Booster pump B', 'equipment', 1, ['pumpA'], [-1.4, -0.05]],
  ['wi', 'Water injection', 'equipment', 1, ['pumpA', 'pumpB'], [-0.85, -0.05]],
  ['crane', 'Platform crane', 'equipment', 1, [], [1.4, 0.2]],
  ['vessel', 'Supply vessel', 'equipment', 1, ['crane'], [1.4, 0.45]],
  ['plan', 'Activity plan', 'data', 1, ['vessel'], [0.85, 0.2]],
  ['hist', 'Process history', 'data', 1, ['wi'], [-1.4, -0.55]],
  ['std', 'Logic standard', 'requirement', 1, [], [-0.3, -0.8]],
  ['req', 'Company requirements', 'requirement', 1, ['std'], [0.3, -0.8]],
  ['a.rca', 'Root-cause agent', 'agent', 1, ['hist', 'pumpA'], [-0.85, -0.55]],
  ['a.proc', 'Procedure assistant', 'agent', 1, ['crane'], [1.4, -0.05]],
  ['a.chem', 'Chemicals agent', 'agent', 1, ['vessel', 'plan'], [1.4, 0.7]],
  ['a.doc', 'Document checker', 'agent', 1, ['req'], [0.85, -0.8]],
  ['a.logic', 'Logic tester agent', 'agent', 1, ['std'], [0.3, -0.55]],
  ['fcast', 'Injection forecast', 'data', 2, ['wi', 'a.chem'], [-0.85, 0.45]],
  ['order', 'Order: 4 IBCs', 'data', 2, ['a.chem', 'vessel'], [0.85, 0.45]],
  ['lift4', 'Lifting proc. rev 4 (old)', 'procedure', 2, ['crane'], [1.4, -0.8]],
  ['lift5', 'Lifting proc. rev 5', 'procedure', 2, ['crane', 'a.proc', 'lift4'], [1.4, -0.55]],
  ['l.cite', 'Lesson: check the citation', 'lesson', 2, ['a.proc', 'lift5'], [1.4, -0.3]],
  ['l.rca', 'Lesson: bearing wear + changeover', 'lesson', 3, ['a.rca', 'pumpA', 'pumpB'], [-0.85, -0.8]],
  ['vib', 'Vibration model, pump A', 'data', 3, ['pumpA', 'hist'], [-1.4, 0.2]],
  ['a.anom', 'Anomaly agent', 'agent', 3, ['vib'], [-0.85, 0.2]],
  ['a.step', 'Step-test agent', 'agent', 3, ['hist'], [-0.3, 0.2]],
  ['model', 'Pressure loop model', 'data', 3, ['a.step', 'wi'], [-0.3, -0.05]],
  ['a.sim', 'Simulator agent', 'agent', 3, ['model'], [-0.3, -0.3]],
  ['logic2', 'Changeover logic v2', 'procedure', 3, ['a.logic', 'a.sim', 'pumpB'], [-0.3, -0.55]],
  ['moc', 'MoC, signed', 'procedure', 3, ['logic2', 'a.doc', 'req'], [0.3, -0.3]],
  ['tx', 'Faulty transmitter', 'equipment', 4, ['wi'], [0.3, -0.05]],
  ['a.alarm', 'Alarm rationaliser', 'agent', 4, ['tx'], [0.3, 0.2]],
  ['wo', 'Work order: swap it', 'data', 4, ['tx'], [0.3, 0.45]],
  ['nogo', 'No-go: no inhibits', 'lesson', 4, ['tx', 'req'], [0.85, -0.55]],
  ['log', 'Shift log', 'data', 5, ['l.cite', 'nogo', 'moc', 'order'], [0.85, -0.3]],
  ['a.hand', 'Handover agent', 'agent', 5, ['log'], [0.85, -0.05]],
];
// The same labels in Norwegian
const GRAPH_NO = {
  pumpA: 'Boosterpumpe A', pumpB: 'Boosterpumpe B', wi: 'Vanninjeksjon', crane: 'Plattformkran', vessel: 'Forsyningsskip',
  plan: 'Aktivitetsplan', hist: 'Prosesshistorikk', std: 'Logikkstandard', req: 'Selskapskrav', 'a.rca': 'Rotårsaksagent',
  'a.proc': 'Prosedyreassistent', 'a.chem': 'Kjemikalieagent', 'a.doc': 'Dokumentkontroll', 'a.logic': 'Logikktestagent',
  fcast: 'Injeksjonsprognose', order: 'Bestilling: 4 IBC', lift4: 'Løfteprosedyre rev 4 (gammel)', lift5: 'Løfteprosedyre rev 5',
  'l.cite': 'Lærdom: sjekk kilden', 'l.rca': 'Lærdom: lagerslitasje + omkobling', vib: 'Vibrasjonsmodell, pumpe A',
  'a.anom': 'Avviksagent', 'a.step': 'Steptest-agent', model: 'Trykksløyfemodell', 'a.sim': 'Simulatoragent',
  logic2: 'Omkoblingslogikk v2', moc: 'MoC, signert', tx: 'Defekt transmitter', 'a.alarm': 'Alarmrasjonalisering',
  wo: 'Arbeidsordre: bytt den', nogo: 'Nei: ingen inhibit', log: 'Skiftlogg', 'a.hand': 'Overleveringsagent',
};
for (const n of GRAPH) n[1] = T(GRAPH_NO[n[0]] ?? n[1], n[1]);

// ---------------------------------------------------------------- cards (front: the task; back: how, who, why)
// TODO(Adriaen): status per card, and the real initiative names in the private overrides.

export const CARDS = {
  chemicals: {
    front: 'Order chemicals for next week',
    how: 'The chemicals agent forecasts consumption from the injection plan and orders before the cut-off.',
    who: 'Shift supervisor leads it and sets the order budget.',
    why: 'No emergency freight, no missed boat. Time and Cost.',
    level: 'act', reason: 'Routine, reversible, inside a budget.',
    initiative: 'Automatic chemical orders', status: 'TODO: honest status (private build)',
  },
  pumps: {
    front: 'Stop the injection pumps tripping again',
    how: 'Root-cause agent finds the cause. Anomaly agent watches the bearings. Step-test, simulator and logic tester agents propose new changeover logic.',
    who: 'Control engineer onshore leads them and co-signs the MoC.',
    why: 'Water injection keeps running, so the wells keep producing. Production.',
    level: 'approve', reason: 'It changes plant logic: a person signs.',
    initiative: 'Root-cause analysis · anomaly detection · engineering tools', status: 'TODO: honest status (private build)',
  },
  inhibit: {
    front: 'Quiet the nuisance alarms from a failing trip transmitter',
    how: 'The alarm rationaliser shows one root cause instead of forty alarms. The fix itself is a work order for a person.',
    who: 'Control engineer refuses the inhibit. OIM backs it.',
    why: 'Agents never touch safety functions. That is a mandate, not a score.',
    level: 'self', reason: 'Inhibiting a safety function is a no-go area for agents.',
    initiative: 'Alarm rationalisation', status: 'TODO: honest status (private build)',
    never: true,
  },
};

export const LEVELS = {
  self: ['Do it yourself', 'A person does the work'],
  ask: ['Ask the agent', 'It answers, you act'],
  approve: ['Act with approval', 'It acts once a person signs'],
  act: ['Act alone', 'Within limits, and logged'],
};

export const VOTES = {
  chemicals: { card: 'chemicals', q: 'Ordering next week\'s chemicals. How much may the agent do?' },
  pumps: { card: 'pumps', q: 'Changing the pump changeover logic. How much may the agents do?' },
  inhibit: { card: 'inhibit', q: 'Inhibiting a failing trip transmitter to stop the alarms. How much may the agent do?' },
};
// TODO(Adriaen): phone voting needs a privately hosted poll; until then the
// presenter clicks the room's answer. Put the poll's URL here (private build).
export const VOTE_URL = null;

// ---------------------------------------------------------------- Act 2 slides (placeholders)
// Adriaen's own slides go here. Each one is either text (title, bullets) or an
// image: put PNGs exported from PowerPoint in public/story/private/slides/
// with the slide's id as the name (e.g. a2-01.png) and they replace the text.

export const SLIDES = {
  'a2-01': { title: 'Today: what one control engineer can build', bullets: ['TODO(Adriaen): your opening slide', 'Who you are, what you work on', 'Why these tools exist'], placeholder: true },
  'a2-02': { title: 'System identification from history', bullets: ['TODO(Adriaen): your slide', 'Open-loop stretches with enough excitation', 'Model without a step test on the live plant'], placeholder: true },
  'a2-03': { title: 'Seeing is believing', bullets: ['TODO(Adriaen): your slide', 'Physics models build intuition', 'How operators and management agree to try a new controller'], placeholder: true },
  'a2-04': { title: 'Verify before the vendor', bullets: ['TODO(Adriaen): your slide', 'Logic drawn as SCD, run in an interactive logic tester', 'Mistakes found on a laptop, not at commissioning'], placeholder: true },
  'a2-05': { title: 'How it was built', bullets: ['AI made the building fast', 'Knowing what to model, and proving it right with step tests, simulation and logic checks, is the engineer\'s job', 'Status: in use by one engineer, not standard yet'] },
  'a2-06': { title: 'Engineering judgement matters', bullets: ['AI speeds up the work', 'The physics, the control knowledge and the verification are what make it safe'] },
  'a2-07': { title: 'Your slide here', bullets: ['TODO(Adriaen): spare placeholder', 'Add or remove slides in story/content.js'], placeholder: true },
  'a2-08': { title: 'Your slide here', bullets: ['TODO(Adriaen): spare placeholder'], placeholder: true },
};

// ---------------------------------------------------------------- written things

export const LOGS = {
  a1: { hand: true, title: 'Handover 18:45', lines: ['Boat alongside 11:10. Crane lift done (supervisor).', 'Chemicals NOT on board, missed cut-off. Next boat in 3 days.', 'WI booster A tripped 15:31, high vibration.', 'B tripped on low suction 15:33. All WI lost ~2 h.', 'Cause: ???'], sign: 'Day shift' },
  a3: { title: 'Handover 18:45 · drafted by the handover agent', lines: ['Boat alongside 11:10. 4 IBCs received (ordered 3 days ago).', 'Procedure assistant cited rev 4; caught by operator, rev 5 used. Mandate tightened.', 'WI changeover logic v2 in service, MoC signed (3 signatures).', 'Pump A bearing change planned next week.', 'Transmitter fault 15:30: inhibit proposal refused. Work order raised.'], edit: [3, 'Pump A bearing change planned for Tuesday, parts on board.'], sign: 'Signed: lead operator' },
};

export const NOTICES = {
  chem: ['chemicals', 'Ordered 3 days ago from the injection forecast: 4 IBCs on today\'s boat.'],
  proc: ['procedures', 'Lifting operations, supply vessel: see procedure rev 4, step 7.'],
  procFix: ['procedures', 'Correction: rev 5 is current. Step 7 now needs two tag lines. Thanks.'],
  rca: ['rca', 'Root cause found: worn bearings on pump A, and changeover logic that cannot absorb the step.'],
  anom: ['anomaly', 'Pump A vibration trending up again. Predicted alarm in 3 weeks. Maintenance planned.'],
  step: ['steptest', 'Found 3 usable stretches in history. Pressure loop model fitted.'],
  sim: ['simulator', 'Pump B drop-out test: header pressure holds with logic v2.'],
  logic: ['logic', 'Changeover logic v2 checked against the logic standard: 0 errors.'],
  docs: ['documents', 'MoC checked against company requirements: complete.'],
  alarms: ['alarms', '41 alarms grouped: 1 root cause, a failing pressure transmitter.'],
  inhibit: ['alarms', 'Proposal: inhibit the failing transmitter\'s trip to stop the nuisance alarms.'],
  wo: ['alarms', 'Work order raised for the instrument technician.'],
  hand: ['handover', 'Handover drafted from today\'s log. Please review and sign.'],
};

// Documents found while hunting for the procedure in Act 1 (made up)
export const SEARCH = ['Lifting operations, general (rev 2, superseded)', 'Crane operations manual, chapter 4', 'Supply vessel handling checklist', 'Lifting operations, offshore cranes (rev 3, superseded)', 'Deck operations, bad weather', 'Lifting operations, supply vessel (rev 5)'];

// ---------------------------------------------------------------- the chapters
// Keys 1 to 9 jump to these. `notes` are the presenter's talking points,
// shown on the presenter strip (P). TODO(Adriaen): your own talking points.

const DESK = { wi: 'normal', sound: 'room' };

const FULL_CHAPTERS = [
  {
    key: 1, id: 'prologue', name: 'Prologue · Flying in', prologue: true,
    beats: [{ id: 'pro', set: { act: 0 }, notes: 'Fade in from black. Title, credits, the flight. Space at the end goes to Act 1.' }],
  },
  {
    key: 2, id: 'a1-morning', name: 'Act 1 · The morning',
    base: { act: 1, time: 12.0, shot: 'desk', ...DESK, cast: { operator: { at: 'desk2' }, supervisor: { at: 'besideYou' } }, clipboard: { page: 1, ticks: [true] }, stars: { row: 'start', show: 'mini' }, screens: { Desk0Mon5Screen: 'procedures', Desk1Mon5Screen: 'log' } },
    beats: [
      { id: 'a1.title', title: 1, notes: 'Act 1, Yesterday: the day as it was. Felt, not explained.' },
      { id: 'a1.hunt', set: { shot: 'supervisor' }, do: [{ say: 'a1.sup1' }, { say: 'a1.sup2' }, { set: { shot: 'clock', overlay: 'search' } }, { clock: [12.0, 12.8, 9] }, { say: 'a1.sup3' }, { set: { overlay: null, shot: 'desk' } }], end: { time: 12.8, overlay: null, shot: 'desk', cast: { operator: { at: 'desk2' }, supervisor: { at: 'gone' } } },
        notes: 'Two short on shift, the supervisor has to do a rare crane lift. Finding the right procedure takes most of an hour: watch the clock.' },
      { id: 'a1.phone', set: { overlay: 'phone:planner' }, do: [{ sound: 'ring' }, { wait: 2.4 }, { say: 'a1.plan1' }, { say: 'a1.plan2' }, { set: { overlay: null, shot: 'operator' } }, { say: 'a1.op1' }], end: { overlay: null, shot: 'operator' },
        notes: 'The chemical order missed the cut-off. Nobody saw it coming.' },
      { id: 'a1.sola', sola: 'full', notes: 'Optional (Sola stills): meanwhile at the heliport, the pallet of chemicals is still by the fence.' },
      { id: 'a1.boat', set: { shot: 'boat', boatLabel: 'No chemicals on board' }, do: [{ wait: 1.5 }, { stars: [3, 1, 2, 2] }, { tick: [1, true] }, { tick: [2, 'x'] }],
        end: { stars: { row: [3, 1, 2, 2], show: 'mini' }, clipboard: { page: 1, ticks: [true, true, 'x'] } },
        notes: 'The boat is alongside, but its deck has no chemicals for us. Time stars drop.' },
    ],
  },
  {
    key: 3, id: 'a1-trip', name: 'Act 1 · The trip',
    base: { act: 1, time: 15.5, shot: 'desk', ...DESK, cast: { operator: { at: 'desk2' } }, clipboard: { page: 1, ticks: [true, true, 'x'] }, stars: { row: [3, 1, 2, 2], show: 'mini' }, screens: { Desk0Mon2Screen: 'wi', Desk0Mon5Screen: 'procedures', Desk1Mon5Screen: 'log', Wall3Screen: 'wi' } },
    beats: [
      { id: 'a1.pumpA', set: { shot: 'monitor:Desk0Mon2Screen', wi: 'tripA' }, do: [{ wait: 1.2 }, { say: 'a1.tech1' }, { set: { shot: 'operator' } }, { say: 'a1.op2' }], end: { shot: 'operator' },
        notes: '15:30. Booster pump A trips on high vibration: worn bearings nobody noticed. B takes the load.' },
      { id: 'a1.cascade', skip: 'next', set: { shot: 'band', wi: 'tripAll', sound: 'alarm', screens: { Wall2Screen: 'flood', Wall4Screen: 'flood', Desk0Mon4Screen: 'flood', Desk1Mon2Screen: 'flood' } },
        do: [{ alarms: [0, 300, 15] }, { say: 'a1.op3', at: 1 }, { say: 'a1.tech2', at: 6 }, { say: 'a1.tech3', at: 10 }],
        notes: 'The changeover cannot absorb the step: B trips on low suction, all water injection lost. ~300 alarms in 10 minutes. Press Space to cut to silence.' },
      { id: 'a1.silence', set: { sound: 'silence', alarms: { count: 300, frozen: true }, wi: 'tripAll', screens: { Wall2Screen: 'flood', Wall4Screen: 'flood', Desk0Mon4Screen: 'flood', Desk1Mon2Screen: 'flood' }, shot: 'band' }, do: [{ stars: [2, 1, 1, 2] }, { tick: [3, 'x'] }],
        end: { stars: { row: [2, 1, 1, 2], show: 'mini' }, clipboard: { page: 1, ticks: [true, true, 'x', 'x'] } },
        notes: 'Silence. The safety systems did exactly what they are designed to do. But what was the cause? Talk over the frozen banner.' },
      { id: 'a1.handover', set: { time: 18.75, sound: 'room', alarms: null, wi: 'frozen', overlay: 'log:a1', shot: 'desk', screens: { Wall2Screen: 'alarms', Wall4Screen: 'alarmLoad' } }, do: [{ tick: [4, 'late'] }],
        end: { clipboard: { page: 1, ticks: [true, true, 'x', 'x', 'late'] } },
        notes: '18:45. A handwritten handover. The cause of the trip is still unknown.' },
      { id: 'a1.stars', set: { overlay: null, stars: { row: 'yesterday', show: 'card' }, cast: { operator: { at: 'desk2' }, oim: { at: 'behind' }, ceo: { at: 'behindCeo' } }, shot: 'oim' },
        do: [{ wait: 1.5 }, { say: 'a1.oim1' }, { set: { cast: { supervisor: { at: 'besideYou' } }, shot: 'supervisor' } }, { say: 'a1.sup4' }],
        end: { cast: { operator: { at: 'desk2' }, oim: { at: 'behind' }, ceo: { at: 'behindCeo' }, supervisor: { at: 'besideYou' } }, shot: 'supervisor' },
        notes: 'Stars for Yesterday. "Was this a bad day?" "No. A normal one."' },
    ],
  },
  {
    key: 4, id: 'a2-talk', name: 'Act 2 · Today',
    base: { act: 2, time: 13.0, shot: 'desk', ...DESK, cast: { operator: { at: 'besideDesk' } }, clipboard: { page: 2, ticks: [] }, stars: null },
    beats: [
      { id: 'a2.title', title: 2, notes: 'Act 2, Today: your presentation. The game only supports it.' },
      { id: 'a2.chair', set: { shot: 'operatorClose' }, do: [{ say: 'a2.op1' }], notes: 'The operator (who built these tools) pulls up a chair at your desk.' },
      { id: 'a2.s1', set: { overlay: 'slide:a2-01' }, notes: 'TODO(Adriaen): your talk.' },
    ],
  },
  {
    key: 5, id: 'a2-tools', name: 'Act 2 · The tools',
    base: { act: 2, time: 13.2, shot: 'desk', ...DESK, cast: { operator: { at: 'besideDesk' } }, clipboard: { page: 2, ticks: [] }, stars: null, screens: { Desk0Mon2Screen: 'stepTest', Desk0Mon3Screen: 'riser' } },
    beats: [
      { id: 'a2.step', set: { shot: 'monitor:Desk0Mon2Screen', tool: 'stepTest' }, do: [{ say: 'a2.op2' }, { say: 'a2.op3' }, { tick: [0, true] }], end: { clipboard: { page: 2, ticks: [true] } },
        notes: 'Step-test finder on Act 1\'s history for the injection pressure loop. TODO(Adriaen): replace the mock-up with screenshots of the real tool.' },
      { id: 'a2.s2', set: { overlay: 'slide:a2-02' } },
      { id: 'a2.riser', set: { overlay: null, shot: 'monitor:Desk0Mon3Screen', tool: 'riser', screens: { Desk0Mon3Screen: 'riser' } }, do: [{ say: 'a2.op4' }, { tick: [1, true] }], end: { clipboard: { page: 2, ticks: [true, true] } },
        notes: 'Your own physics model of a slugging riser (Python, CasADi), talking OPC UA like the real plant.' },
      { id: 'a2.antislug', set: { tool: 'antiSlug', screens: { Desk0Mon3Screen: 'antiSlug' } }, do: [{ say: 'a2.op5' }, { tick: [2, true] }], end: { clipboard: { page: 2, ticks: [true, true, true] } },
        notes: 'Drag in an anti-slug controller, tuned on the model. Seeing is believing.' },
      { id: 'a2.s3', set: { overlay: 'slide:a2-03' } },
      { id: 'a2.scd', set: { overlay: null, shot: 'monitor:Desk0Mon2Screen', tool: 'scd', screens: { Desk0Mon2Screen: 'scd' } }, do: [{ say: 'a2.op6' }, { say: 'a2.op7' }, { tick: [3, true] }], end: { clipboard: { page: 2, ticks: [true, true, true, true] } },
        notes: 'SCD drawn and run in the logic tester. A missing interlock shows up long before the vendor\'s system is involved.' },
      { id: 'a2.s4', set: { overlay: 'slide:a2-04', clipboard: { page: 2, ticks: [true, true, true, true] } } },
      { id: 'a2.s5', set: { overlay: 'slide:a2-05' } },
      { id: 'a2.s6', set: { overlay: 'slide:a2-06' } },
      { id: 'a2.s7', set: { overlay: 'slide:a2-07' } },
      { id: 'a2.s8', set: { overlay: 'slide:a2-08' } },
      { id: 'a2.close', set: { overlay: null, shot: 'oim', stars: { row: 'today', show: 'card' }, cast: { operator: { at: 'besideDesk' }, oim: { at: 'behind' } } },
        do: [{ say: 'a2.oim1' }, { set: { shot: 'operatorClose' } }, { say: 'a2.op8' }], end: { shot: 'operatorClose' },
        notes: 'What Act 1 would have scored with these tools. "Could the AI have done this on its own?"' },
    ],
  },
  {
    key: 6, id: 'a3-briefing', name: 'Act 3 · Morning briefing',
    base: { act: 3, time: 11.75, shot: 'table', ...DESK, cast: { supervisor: { at: 'tableHead' }, oim: { at: 'table1' }, ceo: { at: 'table2' }, operator: { at: 'table3' } }, clipboard: null, stars: null, graph: 1, graphOn: 'band', screens: { LinkScreen: 'call', Wall1Screen: 'graph', Wall3Screen: 'org', Wall5Screen: 'graph', Desk0Mon5Screen: 'agents', Desk1Mon5Screen: 'agents' } },
    beats: [
      { id: 'a3.title', title: 3, notes: 'Act 3, Tomorrow: the same set-ups, solved by agents that people lead.' },
      { id: 'a3.brief', do: [{ say: 'a3.sup1' }, { set: { org: 'chart', shot: 'band' } }, { say: 'a3.sup2' }], end: { org: 'chart', shot: 'band' },
        notes: 'Three people lead the agents. Each agent has a mandate: alone, with approval, or never.' },
      { id: 'a3.graph', set: { org: 'chart+graph', shot: 'band' }, do: [{ say: 'a3.sup3' }],
        notes: 'The knowledge graph: one knowledge base, many agentic subject-matter experts. It grows through the act.' },
    ],
  },
  {
    key: 7, id: 'a3-day', name: 'Act 3 · Chemicals and pumps',
    base: { act: 3, time: 12.0, shot: 'desk', ...DESK, cast: { operator: { at: 'desk2' }, supervisor: { at: 'besideYou' } }, clipboard: { page: 3, ticks: [] }, stars: { row: 'start', show: 'mini' }, graph: 1, graphOn: 'band', screens: { Wall1Screen: 'graph', Wall3Screen: 'org', Wall5Screen: 'graph', Desk0Mon5Screen: 'agents', Desk1Mon5Screen: 'agents' } },
    beats: [
      { id: 'a3.vote1', set: { overlay: 'vote:chemicals' }, notes: 'Vote 1: ordering chemicals. The room picks on their phones (or you click). Space reveals: act alone, within limits.' },
      { id: 'a3.chem', set: { overlay: null, shot: 'boat', boatLabel: '4 IBCs on board' }, do: [{ notice: 'chem' }, { graph: 2 }, { tick: [0, 'SS'] }], end: { graph: 2, clipboard: { page: 3, ticks: ['SS'] } },
        notes: 'Ordered three days ago from the injection forecast. The IBCs are on the boat this time.' },
      { id: 'a3.sola', sola: 'empty', set: { boatLabel: null }, notes: 'Optional (Sola stills): the same spot at the heliport, empty. The order went out in time.' },
      { id: 'a3.proc', set: { shot: 'supervisor', boatLabel: null }, do: [{ say: 'a3.sup4' }, { notice: 'proc' }], notes: 'One question in plain words, one answer with a citation. Now look at the citation.' },
      { id: 'a3.catch', set: { overlay: 'card:catch', shot: 'desk' }, do: [{ wait: 1 }, { notice: 'procFix' }],
        notes: 'Catch the agent: it cited revision 4, but revision 5 changed step 7. You checked the citation; it corrects itself.' },
      { id: 'a3.mandate', set: { overlay: null, shot: 'supervisor' }, do: [{ say: 'a3.sup5' }, { tick: [1, 'SS'] }, { stars: [4, 4, 3, 4] }], end: { clipboard: { page: 3, ticks: ['SS', 'SS'] }, stars: { row: [4, 4, 3, 4], show: 'mini' } },
        notes: 'The supervisor tightens the assistant\'s mandate. People set how far each agent may go.' },
      { id: 'a3.vote2', set: { overlay: 'vote:pumps', time: 14.0, cast: { operator: { at: 'desk2' } } }, notes: 'Vote 2: fixing the pump changeover logic. Answer: act with approval.' },
      { id: 'a3.rca', set: { overlay: 'call:analyst', shot: 'desk', screens: { Desk0Mon2Screen: 'wi' }, wi: 'vibration' }, do: [{ notice: 'rca' }, { say: 'a3.ana1' }, { notice: 'anom' }, { say: 'a3.ana2' }, { graph: 3 }], end: { graph: 3 },
        notes: 'The root-cause analysis of the Act 1 trip worked. Anomaly detection now sees the bearings going weeks ahead.' },
      { id: 'a3.fix', set: { overlay: 'call:engineer', shot: 'monitor:Desk0Mon2Screen', wi: 'fixed' }, do: [{ notice: 'step' }, { wait: 1.2 }, { notice: 'sim' }, { wait: 1.2 }, { notice: 'logic' }, { wait: 1.2 }, { notice: 'docs' }, { say: 'a3.eng1' }, { set: { overlay: 'sign' } }, { tick: [2, 'CE'] }, { stars: [5, 4, 3, 4] }],
        end: { overlay: 'sign', clipboard: { page: 3, ticks: ['SS', 'SS', 'CE'] }, stars: { row: [5, 4, 3, 4], show: 'mini' } },
        notes: 'Your tools, now agents: model from history, test in the simulator, check the logic, check the MoC. Three people sign. Act 1\'s trip is avoided.' },
    ],
  },
  {
    key: 8, id: 'a3-upset', name: 'Act 3 · Upset and handover',
    base: { act: 3, time: 15.5, shot: 'desk', ...DESK, wi: 'fixed', cast: { operator: { at: 'desk2' } }, clipboard: { page: 3, ticks: ['SS', 'SS', 'CE'] }, stars: { row: [5, 4, 3, 4], show: 'mini' }, graph: 3, graphOn: 'band', screens: { Wall1Screen: 'graph', Wall3Screen: 'org', Wall5Screen: 'graph', Desk0Mon5Screen: 'agents', Desk1Mon5Screen: 'agents' } },
    beats: [
      { id: 'a3.burst', set: { screens: { Wall2Screen: 'flood', Desk0Mon4Screen: 'flood' }, shot: 'band' }, do: [{ sound: 'alarmShort' }, { alarms: [0, 41, 4] }], notes: '15:30. A transmitter starts to fail. A burst of alarms.' },
      { id: 'a3.root', set: { alarms: null, screens: { Wall2Screen: 'rootCause', Desk0Mon4Screen: 'rootCause' }, shot: 'monitor:Desk0Mon4Screen' }, do: [{ notice: 'alarms' }],
        notes: 'Pause on the before and after: forty-one alarms become one root cause. The plant keeps running.' },
      { id: 'a3.vote3', set: { overlay: 'vote:inhibit', shot: 'desk' }, notes: 'Vote 3: inhibiting a trip transmitter. Answer: do it yourself. Agents never touch safety functions.' },
      { id: 'a3.nogo', set: { overlay: 'call:engineer' }, do: [{ notice: 'inhibit' }, { wait: 1 }, { say: 'a3.eng2' }, { say: 'a3.eng3' }, { notice: 'wo' }, { graph: 4 }, { set: { overlay: null, cast: { operator: { at: 'desk2' }, oim: { at: 'behind' } }, shot: 'oim' } }, { say: 'a3.oim1' }, { tick: [3, true] }],
        end: { overlay: null, graph: 4, cast: { operator: { at: 'desk2' }, oim: { at: 'behind' } }, shot: 'oim', clipboard: { page: 3, ticks: ['SS', 'SS', 'CE', true] } },
        notes: 'The no-go: the control engineer refuses on the spot, the OIM backs it. A work order goes to the instrument tech instead.' },
      { id: 'a3.never', set: { overlay: 'card:never', shot: 'desk' }, notes: 'The no-go areas. These become the "never touches" column of the mandate sheet.' },
      { id: 'a3.handover', set: { overlay: 'log:a3', time: 18.75, shot: 'desk' }, do: [{ notice: 'hand' }, { graph: 5 }, { tick: [4, 'LO'] }], end: { graph: 5, clipboard: { page: 3, ticks: ['SS', 'SS', 'CE', true, 'LO'] } },
        notes: '18:45. The agent drafted the handover, including the caught mistake and the refused inhibit. You edit one line and sign.' },
      { id: 'a3.pull', set: { overlay: null, graph: 5, graphOn: 'overlay', shot: 'band', clipboard: { page: 3, ticks: ['SS', 'SS', 'CE', true, 'LO'] } }, notes: 'The whole day on one knowledge graph.' },
      { id: 'a3.stars', set: { stars: { row: 'tomorrow', show: 'all' }, graphOn: 'band' }, notes: 'All three acts side by side. Tomorrow stays short of perfect, apart from Production. Safety: never traded.' },
    ],
  },
  {
    key: 9, id: 'epilogue', name: 'Epilogue · The zoom out',
    base: { act: 4, time: 22.0, shot: 'desk', ...DESK, graph: 5, graphOn: 'band', clipboard: null, stars: null, screens: { Wall0Screen: 'graph', Wall1Screen: 'graph', Wall2Screen: 'graph', Wall3Screen: 'graph', Wall4Screen: 'graph', Wall5Screen: 'graph', Wall6Screen: 'graph' } },
    beats: [
      { id: 'ep.zoom', set: { shot: 'epilogue' }, notes: 'The camera pulls back through the window to the platform at night, the graph glowing inside. Switch to PowerPoint from here.' },
      { id: 'ep.line', do: [{ say: 'a3.oim2' }], notes: 'Optional: the OIM\'s fourth-wall line, or say it yourself as the bridge into the mandate sheet.' },
    ],
  },
];

// Act 3 card "catch the agent", and the no-go card: plain cards, no vote
export const PLAIN_CARDS = {
  catch: { title: 'Catch the agent', body: ['The assistant cited <b>revision 4</b>, step 7.', 'Revision 5 is current, and it changed step 7: two tag lines are now required.', 'You checked the citation. The agent corrects itself, and the mistake goes into the knowledge graph as a lesson.'] },
  never: { title: 'What agents never touch', list: NEVER, foot: 'These areas stay with people. It is a mandate, not a score.' },
};

// ================================================================ the default run
// Prologue, the control room of tomorrow, "How did we get here?", the rewind
// to one year ago, then Adriaen's own story led by the presenter (onboarding,
// the decision, the money slides, the how), back to tomorrow, and the
// epilogue (design.md 18b/18c). On-screen text in Norwegian (?lang=en for
// English); the voiced lines stay English, with Norwegian subtitles.

// The agents' chats on the screens of tomorrow's room: who writes ('me' or
// 'ai') and what. A `chat` step shows one more message; an 'ai' message types
// for a moment first.
export const CHATS = {
  plan: {
    title: T('Forretningsplan-agent', 'Business-plan agent'), who: 'Brage',
    messages: [
      ['me', T('Hvordan holder forretningsplanen hvis den nye brønnen kommer tre måneder for sent?', 'How does the business plan hold up if the new well comes in three months late?')],
      ['ai', T('Produksjonen faller litt i tredje kvartal. To prosjekter kan flyttes fram og dekke gapet. Skal jeg lage utkast til begge?', 'Production dips a little in the third quarter. Two projects can move forward to fill the gap. Shall I draft both?')],
      ['me', T('Ja, lag begge. Og merk det som trenger godkjenning offshore.', 'Yes, draft both. And flag anything that needs sign-off offshore.')],
      ['ai', T('Utkastene er klare. To punkter trenger godkjenning, og de er sendt til kontrollrommet.', 'Drafts ready. Two items need sign-off, and they have gone to the control room.')],
    ],
  },
  slug: {
    title: T('Reguleringsagent · anti-slug', 'Control agent · anti-slug'), who: 'Adriaen',
    messages: [
      ['me', T('Stigerøret begynte å slugge igjen i natt. Kan du justere anti-slug-regulatoren?', 'The riser started slugging again overnight. Can you retune the anti-slug controller?')],
      ['ai', T('Ny modell tilpasset fra nattens data. Den foreslåtte innstillingen holder stigerøret stabilt i simulatoren.', 'New model fitted from last night\'s data. The proposed tuning holds the riser steady in the simulator.')],
      ['me', T('Bra. Kjør den gjennom logikktesteren før jeg signerer.', 'Good. Run it through the logic tester before I sign.')],
      ['ai', T('Alle 14 testtilfeller består. Klar for din signatur.', 'All 14 test cases pass. Ready for your signature.')],
    ],
  },
};

// Slides of the default run. TODO(Adriaen): your own slides, as text here or
// as PNGs in public/story/private/slides/<id>.png (see SLIDES above).
const TODO = T('TODO(Adriaen): ditt lysbilde', 'TODO(Adriaen): your slide');
Object.assign(SLIDES, {
  'y-01': { title: T('Trondheim, ett år tidligere', 'Trondheim, one year ago'), bullets: [T('TODO: Trondheim-scenen kommer her (drone over Torvet, ned til døra på Føniks)', 'TODO: the Trondheim scene goes here (drone over Torvet, down to the Føniks door)'), T('Første uke i jobben', 'First week on the job')], placeholder: true },
  'y-02': { title: T('Onboarding er bratt', 'Onboarding is steep'), bullets: [TODO, T('Nytt anlegg, nye systemer, nye forkortelser', 'New plant, new systems, new acronyms'), T('Tusenvis av styrende dokumenter', 'Thousands of governing documents'), T('Hvem vet hva, og hvor står det?', 'Who knows what, and where is it written?')], placeholder: true },
  'd-01': { title: T('Et bevisst valg', 'A deliberate choice'), bullets: [TODO, T('KI inn i min egen onboarding', 'AI in my own onboarding'), T('Bygge verktøy for det, og for daglige reguleringsoppgaver', 'Build tools for it, and for daily control-engineering tasks')], placeholder: true },
  'd-02': { title: T('Fra spørsmål til verktøy', 'From questions to tools'), bullets: [TODO, T('Hva spurte jeg om de første ukene?', 'What did I ask about in the first weeks?'), T('Hva ble til verktøy?', 'What became a tool?')], placeholder: true },
  'm-01': { title: T('Hva er mulig', 'What is possible'), bullets: [TODO, T('Steptest-finner', 'Step-test finder'), T('Simulatorer', 'Simulators'), T('I-005 logikktester', 'I-005 logic tester'), T('Agenter for styrende dokumenter', 'Governing-document agents')], placeholder: true },
  'm-02': { title: T('Modeller uten nye steptester', 'Models without new step tests'), bullets: [TODO, T('Finner brukbare strekk i historikken', 'Finds usable stretches in history'), T('Ingen tapte fat', 'No lost barrels')], placeholder: true },
  'm-03': { title: T('Å se er å tro', 'Seeing is believing'), bullets: [TODO, T('Fysikkmodeller (Python, CasADi) som snakker OPC UA', 'Physics models (Python, CasADi) that talk OPC UA'), T('Prøv regulatoren før anlegget gjør det', 'Try the controller before the plant does')], placeholder: true },
  'm-04': { title: T('Test logikken før leverandøren', 'Test the logic before the vendor'), bullets: [TODO, T('SCD etter I-005, kjørt i en interaktiv logikktester', 'SCD to I-005, run in an interactive logic tester'), T('Feil funnet på en laptop, ikke under igangkjøring', 'Mistakes found on a laptop, not at commissioning')], placeholder: true },
  'm-05': { title: T('Styrende dokumenter, med kilde', 'Governing documents, with sources'), bullets: [TODO, T('Agenter som svarer med henvisning', 'Agents that answer with a citation'), T('Sjekker endringer mot kravene', 'Check changes against the requirements')], placeholder: true },
  'h-01': { title: T('Kunnskapsgrafer', 'Knowledge graphs'), bullets: [TODO, T('Utstyr, dokumenter, krav og lærdom, koblet sammen', 'Equipment, documents, requirements and lessons, linked'), T('Én kunnskapsbase, mange agenter', 'One knowledge base, many agents')], placeholder: true },
  'h-02': { title: T('Flere agenter sammen', 'Multi-agent work'), bullets: [TODO, T('Hver agent har sitt fag og sitt mandat', 'Each agent has its subject and its mandate'), T('Mennesker leder dem', 'People lead them')], placeholder: true },
  'h-03': { title: T('MCP-verktøy', 'MCP tools'), bullets: [TODO, T('Agentene bruker de samme verktøyene som oss', 'The agents use the same tools we do'), T('Historikk, simulatorer, logikktester, dokumenter', 'History, simulators, logic tester, documents')], placeholder: true },
  'h-04': { title: T('Hva betyr det for oss?', 'What does it mean for us?'), bullets: [TODO, T('Inn i idédugnaden', 'Into the brainstorm')], placeholder: true },
});

// The governing-document agent on a desk monitor (mock-up), and its sources
export const GOV_DOCS = {
  q: T('Hvilke krav gjelder for å endre en trippgrense?', 'Which requirements apply to changing a trip limit?'),
  a: [T('En endring av en trippgrense er en endring i et sikkerhetssystem. Den krever en godkjent MoC før den gjennomføres.', 'Changing a trip limit is a change to a safety system. It needs an approved MoC before it is made.'),
    T('Sikkerhetskravspesifikasjonen må oppdateres, og endringen verifiseres etter at den er gjort.', 'The safety requirement specification must be updated, and the change verified once it is made.')],
  sources: [T('Styringssystem · Endringsstyring, kap. 4', 'Management system · Management of change, ch. 4'), T('Sikkerhetskravspesifikasjon, kap. 2.3', 'Safety requirement specification, ch. 2.3'), T('Selskapskrav · Sikkerhetssystemer', 'Company requirements · Safety systems')],
};

// Every screen, blanked for the rewind
const ALL_SCREENS = [0, 1, 2, 3, 4, 5].flatMap((i) => [`Desk0Mon${i}Screen`, `Desk1Mon${i}Screen`]).concat([0, 1, 2, 3, 4, 5, 6].map((i) => `Wall${i}Screen`), ['LinkScreen', 'TvScreen']);
const BLANK = Object.fromEntries(ALL_SCREENS.map((n) => [n, 'blank']));
// Tomorrow's room: Brage's agent in the middle of the band with his plan on
// either side, the graph at the ends; Adriaen's agent and the riser at his desk
const TOMORROW_SCREENS = { Wall1Screen: 'graph', Wall2Screen: 'planChart', Wall3Screen: 'chatPlan', Wall4Screen: 'planChart', Wall5Screen: 'graph', Desk1Mon2Screen: 'chatSlug', Desk1Mon3Screen: 'riser' };
const TOMORROW_CAST = { supervisor: { at: 'desk0typing' }, operator: { at: 'desk2typing' } };
export const CLOSING = T('Denne delen er ikke vår å bestemme. Den er deres.', 'This part isn\'t ours to decide. It\'s yours.');

const SHORT_CHAPTERS = [
  {
    key: 1, id: 'prologue', name: T('Prolog · Innflyging', 'Prologue · Flying in'), prologue: true,
    beats: [{ id: 'pro', set: { act: 0 }, notes: 'Fade in from black. Title, credits, the flight. Space at the end goes to tomorrow\'s control room.' }],
  },
  {
    key: 2, id: 'tomorrow', name: T('Framtidens EIGA', 'Tomorrow\'s EIGA'),
    base: { act: 3, time: 11.5, shot: 'wideRoom', ...DESK, cast: { supervisor: { at: 'door' }, operator: { at: 'desk2typing' } }, mugs: { S0Mug: [0.12, -0.45, -2.12] }, graph: 5, graphOn: 'band', chats: { plan: 0, slug: 0 }, screens: TOMORROW_SCREENS },
    beats: [
      { id: 't.open', auto: true,
        do: [{ wait: 1.5 }, { move: 'supervisor', walk: PATHS.doorToDesk0 }, { wait: 2.5 }, { say: 't.gm1' }, { say: 't.gm2' },
          { idle: 'supervisor' }, { move: 'supervisor', sit: 0, then: 'typing', to: 'desk0typing' }, { wait: 2.2 }, { say: 't.gm3' }, { idle: 'supervisor' },
          { set: { shot: 'pair' } }, { say: 't.gm4' },
          { move: 'operator', stand: 1, toward: [4, 3.6] }, { move: 'operator', walk: PATHS.desk2ToCoffee, to: 'coffee' }, { wait: 2.2 }, { set: { shot: 'wideRoom' } }, { idle: 'operator' }],
        end: { shot: 'wideRoom', cast: { supervisor: { at: 'desk0typing' }, operator: { at: 'coffee' } } },
        notes: 'Runs by itself. Tomorrow\'s control room: Brage comes in, turns his chair round and sits down. Good morning; is the coffee fresh? Adriaen goes to put on a new pot.' },
      { id: 't.brage', auto: true, set: { shot: 'brageBand' },
        do: [{ wait: 1 }, { chat: 'plan' }, { say: 't.brage1' }, { chat: 'plan' }, { set: { shot: 'monitor:Wall3Screen' } }, { wait: 1.2 }, { say: 't.ai1' }, { wait: 0.6 },
          { set: { shot: 'brage' } }, { chat: 'plan' }, { say: 't.brage2' }, { chat: 'plan' }, { set: { shot: 'monitor:Wall3Screen' } }, { wait: 1.2 }, { say: 't.ai2' }, { set: { shot: 'band' } }, { wait: 2 }],
        end: { shot: 'band', chats: { plan: 4, slug: 0 } },
        notes: 'Brage works on the business plan with his agent on the wall band; the agent answers out loud in its robot voice. The plan on either side closes its gap once the drafts are in.' },
      { id: 't.coffee', auto: true, set: { shot: 'wideRoom', chats: { plan: 4, slug: 0 } },
        do: [{ move: 'operator', carry: 'jug' }, { move: 'operator', walk: PATHS.coffeeToDesk0 }, { wait: 5.5 }, { set: { shot: 'pour' } }, { idle: 'operator' },
          { move: 'operator', pour: 'S0Mug' }, { idle: 'operator' }, { say: 't.gm5' },
          { move: 'operator', walk: PATHS.desk0ToDesk2 }, { move: 'operator', carry: null, put: [1.36, 0.745, -2.3] }, { move: 'operator', sit: 1, then: 'typing', to: 'desk2typing' }, { wait: 1 }, { set: { shot: 'wideRoom' } }, { idle: 'operator' }],
        end: { shot: 'wideRoom', mugs: { S0Mug: [1, -0.45, -2.12] }, cast: { supervisor: { at: 'desk0typing' }, operator: { at: 'desk2typing' } } },
        notes: 'Adriaen comes back with a fresh pot, fills Brage\'s mug and sits down at his own desk.' },
      { id: 't.adriaen', auto: true, set: { shot: 'adriaenDesk' },
        do: [{ wait: 1 }, { chat: 'slug' }, { say: 't.adr1' }, { chat: 'slug' }, { set: { shot: 'monitor:Desk1Mon2Screen' } }, { wait: 1.2 }, { say: 't.ai3' },
          { set: { shot: 'monitor:Desk1Mon3Screen', tool: 'antiSlug', screens: { Desk1Mon3Screen: 'antiSlug' } } }, { wait: 5 },
          { set: { shot: 'adriaenDesk' } }, { chat: 'slug' }, { say: 't.adr2' }, { chat: 'slug' }, { set: { shot: 'monitor:Desk1Mon2Screen' } }, { wait: 1.2 }, { say: 't.ai4' },
          { set: { shot: 'adriaen' } }, { wait: 1 }, { say: 't.adr3' }],
        end: { shot: 'adriaen', tool: 'antiSlug', screens: { Desk1Mon3Screen: 'antiSlug' }, chats: { plan: 4, slug: 4 } },
        notes: 'Adriaen works with his agent on the anti-slug controller; the agent answers out loud. The camera settles on him.' },
      { id: 't.question', auto: true, set: { shot: 'adriaen' }, do: [{ wait: 1 }, { card: { text: T('Hvordan kom vi hit?', 'How did we get here?') } }, { wait: 4 }, { card: null }],
        notes: 'The question. Let it hang for a moment.' },
      { id: 't.rewind', auto: true, do: [{ rewind: 6 }], end: { act: 5, time: 8.5, screens: BLANK, chats: { plan: 0, slug: 0 }, cast: {}, tool: null, shot: 'desk', graph: 0 },
        notes: 'The rewind: the clock spins backwards, the screens empty.' },
    ],
  },
  {
    key: 3, id: 'year-ago', name: T('Ett år tidligere · Trondheim', 'One year ago · Trondheim'),
    base: { act: 5, time: 8.5, shot: 'desk', ...DESK, cast: {}, graph: 0, screens: BLANK },
    beats: [
      { id: 'y.card', card: { text: '', solid: true }, notes: 'A plain black screen after the question. From here on you talk; Space moves on.' },
      { id: 'y.trondheim', set: { place: 'trondheim' }, do: [{ wait: 0.8 }, { card: { text: T('For et år siden', 'One year ago'), sub: T('I november 2025', 'November 2025') } }, { wait: 6 }, { card: null }], notes: 'Torvet in Trondheim, as a dream: the drone glides down from over the square to you at the Føniks door, the titles fade as it closes in, and you turn and walk in. Your first week on the job.' },
      { id: 'y.steep', set: { overlay: 'slide:y-02' }, notes: 'Onboarding is steep. TODO(Adriaen): your talking points.' },
      { id: 'y.room', set: { overlay: null, place: null, shot: 'band', screens: null }, notes: 'The room as it was to a newcomer: screens full of things you have yet to learn.' },
    ],
  },
  {
    key: 4, id: 'decision', name: T('I dag · Beslutningen', 'Today · The decision'),
    base: { act: 5, time: 8.5, shot: 'band', ...DESK, cast: {}, graph: 0 },
    beats: [
      { id: 'd.s1', set: { overlay: 'slide:d-01' }, notes: 'The decision to bring AI into onboarding. TODO(Adriaen): your talking points.' },
      { id: 'd.wake', set: { overlay: null, act: 2, time: 13.0, screens: null, cast: { operator: { at: 'desk2' } } }, notes: 'The room wakes up: colour back, screens on. Today.' },
      { id: 'd.s2', set: { overlay: 'slide:d-02' }, notes: 'From questions to tools.' },
    ],
  },
  {
    key: 5, id: 'money', name: T('I dag · Verktøyene', 'Today · The tools'),
    base: { act: 2, time: 13.2, shot: 'desk', ...DESK, cast: { operator: { at: 'desk2' } }, screens: { Desk0Mon2Screen: 'stepTest', Desk0Mon3Screen: 'riser', Desk0Mon4Screen: 'govDocs' } },
    beats: [
      { id: 'm.s1', set: { overlay: 'slide:m-01' }, notes: 'The money slides: what is possible.' },
      { id: 'm.step', set: { overlay: null, shot: 'monitor:Desk0Mon2Screen', tool: 'stepTest' }, notes: 'Step-test finder on history. TODO(Adriaen): screenshot of the real tool in private/tools/stepTest.png.' },
      { id: 'm.s2', set: { overlay: 'slide:m-02' } },
      { id: 'm.riser', set: { overlay: null, shot: 'monitor:Desk0Mon3Screen', tool: 'riser', screens: { Desk0Mon3Screen: 'riser' } }, notes: 'The riser simulator, open loop: it fills and blows through.' },
      { id: 'm.antislug', set: { tool: 'antiSlug', screens: { Desk0Mon3Screen: 'antiSlug' } }, notes: 'Anti-slug control tuned on the model. Seeing is believing.' },
      { id: 'm.s3', set: { overlay: 'slide:m-03' } },
      { id: 'm.scd', set: { overlay: null, shot: 'monitor:Desk0Mon2Screen', tool: 'scd', screens: { Desk0Mon2Screen: 'scd' } }, notes: 'The I-005 logic tester: a missing interlock found on a laptop.' },
      { id: 'm.s4', set: { overlay: 'slide:m-04' } },
      { id: 'm.docs', set: { overlay: null, shot: 'monitor:Desk0Mon4Screen', tool: 'govDocs' }, notes: 'A governing-document agent answers with its sources. TODO(Adriaen): screenshot in private/tools/govDocs.png.' },
      { id: 'm.s5', set: { overlay: 'slide:m-05' } },
    ],
  },
  {
    key: 6, id: 'how', name: T('I dag · Hvordan', 'Today · How'),
    base: { act: 2, time: 13.5, shot: 'band', ...DESK, cast: { operator: { at: 'desk2' } }, graph: 1, graphOn: 'band', screens: { Wall1Screen: 'graph', Wall3Screen: 'graph', Wall5Screen: 'graph' } },
    beats: [
      { id: 'h.s1', set: { overlay: 'slide:h-01' }, notes: 'Knowledge graphs.' },
      { id: 'h.g1', set: { overlay: null }, do: [{ graph: 2 }, { wait: 2 }, { graph: 3 }], end: { graph: 3 }, notes: 'The graph grows on the band as knowledge is added.' },
      { id: 'h.s2', set: { overlay: 'slide:h-02' }, notes: 'Multi-agent work.' },
      { id: 'h.g2', set: { overlay: null }, do: [{ graph: 4 }], end: { graph: 4 }, notes: 'More agents on the same graph.' },
      { id: 'h.s3', set: { overlay: 'slide:h-03' }, notes: 'MCP tools.' },
      { id: 'h.g3', set: { overlay: null, graphOn: 'overlay' }, do: [{ graph: 5 }], end: { graph: 5 }, notes: 'The whole graph, full screen.' },
      { id: 'h.s4', set: { overlay: 'slide:h-04', graphOn: 'band' } },
    ],
  },
  {
    key: 7, id: 'back', name: T('I morgen · Tilbake', 'Tomorrow · Back'),
    base: { act: 3, time: 11.5, shot: 'wideRoom', ...DESK, cast: TOMORROW_CAST, graph: 5, graphOn: 'band', chats: { plan: 4, slug: 4 }, tool: 'antiSlug', screens: { ...TOMORROW_SCREENS, Desk1Mon3Screen: 'antiSlug' } },
    beats: [
      { id: 'b.forward', do: [{ forward: 3 }], notes: 'Fast forward to tomorrow\'s room again.' },
      { id: 'b.room', set: { shot: 'adriaen' }, notes: 'Where we are heading. Bridge to the epilogue.' },
    ],
  },
  {
    key: 8, id: 'epilogue', name: T('Epilog · Zoom ut', 'Epilogue · The zoom out'),
    base: { act: 4, time: 22.0, shot: 'desk', ...DESK, graph: 5, graphOn: 'band', screens: { Wall0Screen: 'graph', Wall1Screen: 'graph', Wall2Screen: 'graph', Wall3Screen: 'graph', Wall4Screen: 'graph', Wall5Screen: 'graph', Wall6Screen: 'graph' } },
    beats: [
      { id: 'ep.zoom', set: { shot: 'epilogue' }, notes: 'The camera pulls back through the window to the platform at night, the graph glowing inside.' },
      { id: 'ep.line', do: [{ card: { text: CLOSING, small: true } }], notes: 'TODO(Adriaen): pick the closing line (CLOSING in content.js). Then into the brainstorm.' },
    ],
  },
];

export const CHAPTERS = FULL ? FULL_CHAPTERS : SHORT_CHAPTERS;
// The slides this run shows, in order, for their numbers
export const SLIDE_ORDER = [...new Set(CHAPTERS.flatMap((ch) => ch.beats.map((b) => b.set?.overlay).filter((o) => o?.startsWith('slide:')).map((o) => o.slice(6))))];
