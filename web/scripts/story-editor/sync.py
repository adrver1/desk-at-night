"""Brings edits from the story script editor into the game.

    python scripts/story-editor/sync.py <export dir>

<export dir> holds the editor's documents as ArtifactData saves them with
`out_dir`: beats/<id>.json and notes/<id>.json. Updates src/story/story.json
(slides, chats, pointers, notes and title cards per beat, added and left-out
beats) and src/story/lines.json (spoken lines and subtitles, new lines), then
prints what needs a hand: new or changed lines to voice, slide pictures to
download into the private build, and the open notes to Claude.
"""
import json, os, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))
src = sys.argv[1]

def load(kind):
    out = []
    for p in sorted(glob.glob(f'{src}/{kind}/*.json')):
        d = json.load(open(p))
        out.append(d.get('data', d) if isinstance(d, dict) and 'data' in d and 'id' in d else d)
    return out

beats = sorted(load('beats'), key=lambda b: b['order'])
notes = load('notes')
story_p, lines_p = f'{WEB}/src/story/story.json', f'{WEB}/src/story/lines.json'
story, lines = json.load(open(story_p)), json.load(open(lines_p))
voice, pictures, changed = [], [], []

def same(a, b): return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
def both(o): return {'no': o.get('no', ''), 'en': o.get('en', '')}

story['inserted'], story['hidden'], story['callouts'] = [], [], {}
for i, b in enumerate(beats):
    bid, base = b['id'], b.get('base') or {}
    o = {}
    if b.get('hidden'): story['hidden'].append(bid)
    if b.get('slide'):
        sl = b['slide']
        new = {'no': sl['no'], 'en': sl['en']}
        for l in ('no', 'en'):
            new[l] = {k: v for k, v in new[l].items() if v not in ('', None, [])}
        if sl.get('placeholder'): new['placeholder'] = True
        if sl.get('image'):
            pictures.append((sl['id'], sl['image']))
        if not same(story['slides'].get(sl['id']), new):
            story['slides'][sl['id']] = new; changed.append(f'slide {sl["id"]}')
    if b.get('isNew'):
        prev = beats[i - 1]['id'] if i else None
        add = {'after': b.get('after') or prev, 'id': bid}
        if b.get('slide'): add['slide'] = b['slide']['id']
        if b.get('card') is not None: add['card'] = {'no': b['card'].get('text', ''), 'en': b['card'].get('en', b['card'].get('text', ''))}
        if b.get('notes'): add['notes'] = b['notes']
        story['inserted'].append(add); changed.append(f'new beat {bid}')
    else:
        if b.get('notes', '') != base.get('notes', ''): o['notes'] = b['notes']
        if b.get('card') and not same(b['card'], base.get('card')): o['card'] = {'no': b['card'].get('text', ''), 'en': b['card'].get('text', '')}
    cards, say = [], []
    for it in b.get('items', []):
        k = it['kind']
        if k == 'line':
            if it.get('isNew') or it['id'] not in lines:
                lines[it['id']] = {'who': it.get('role', 'operator'), 'name': it.get('who'), 'text': it.get('en', ''), 'no': it.get('no', '')}
                say.append(it['id']); voice.append(it['id'])
            else:
                l = lines[it['id']]
                if l['text'] != it.get('en', l['text']): l['text'] = it['en']; voice.append(it['id'])
                if it.get('no') is not None and l.get('no', '') != it['no']: l['no'] = it['no']; changed.append(f'subtitle {it["id"]}')
        elif k == 'chat':
            m = story['chats'][it['key']]['messages'][it['idx']]
            if not same(m[1], both(it)): m[1] = both(it); changed.append(f'chat {it["key"]} {it["idx"] + 1}')
        elif k == 'card':
            cards.append(both(it))
    base_cards = [both(c) for c in base.get('cards', [])]
    if not same(cards, base_cards): o['cards'] = cards
    if say: o['say'] = say
    if b.get('callouts'): story['callouts'][bid] = [{'target': c['target'], 'label': both(c['label']) if isinstance(c['label'], dict) else {'no': c['label'], 'en': ''}, 'text': both(c['text']) if isinstance(c['text'], dict) else {'no': c['text'], 'en': ''}, 'x': c['x'], 'y': c['y']} for c in b['callouts']]
    if o: story['beats'][bid] = o
    elif bid in story['beats']: del story['beats'][bid]

open(story_p, 'w').write(json.dumps(story, ensure_ascii=False, indent=1) + '\n')
# lines.json keeps one line per entry, in its groups: change rows in place
orig = json.load(open(lines_p))
text = open(lines_p).read().rstrip()
row = lambda k, v: f'  {json.dumps(k, ensure_ascii=False)}: {{ {json.dumps(v, ensure_ascii=False)[1:-1]} }}'
out = []
for ln in text.split('\n'):
    key = ln.strip().split('"')[1] if ln.strip().startswith('"') else None
    out.append(row(key, lines[key]) + (',' if ln.rstrip().endswith(',') else '') if key in orig and key != '_about' and lines[key] != orig[key] else ln)
new = [k for k in lines if k not in orig]
if new:
    while out[-1].strip() == '}': out.pop()
    out[-1] = out[-1].rstrip(',') + ','
    out += [''] + [row(k, lines[k]) + ',' for k in new]
    out[-1] = out[-1].rstrip(',')
    out.append('}')
open(lines_p, 'w').write('\n'.join(out) + '\n')
print('changed:', ', '.join(changed) or 'nothing')
if voice: print('voice these lines:  python web/scripts/voices.py --model <dir> --only', ' '.join(voice))
for sid, url in pictures: print(f'picture slide {sid}: download {url} to web/public/story/private/slides/{sid}.png (private, git-ignored)')
for n in notes:
    if n.get('status') != 'done': print(f'NOTE [{n.get("beatId")} / {n.get("target")}] {n.get("text")}')
