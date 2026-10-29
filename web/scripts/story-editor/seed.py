"""Turns the default story run into the story script editor's documents.

    python scripts/story-editor/seed.py dump.json <stills dir> <out dir>

dump.json comes from dump.mjs, the stills (PNG, `<chapter>-<nn>-<beat>.png`)
from `HIDE_UI=1 node qa/story-tour.mjs <dir> 2,3,4,5,6,7,8 2`. Writes
<out>/beats/<beat id>.json (one editor document per beat), <out>/stills/*.jpg
(publish them with the editor page) and <out>/writes.json (an ArtifactData
batch). Timings are estimates: voice lengths from voice.json plus the waits,
2.5 s for a person to finish moving.
"""
import json, os, sys, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))
dump_path, stills_dir, out = sys.argv[1:4]
d = json.load(open(dump_path))
no, en = d['no'], d['en']
VOICE = json.load(open(f'{WEB}/public/story/voice/voice.json'))
LINES = json.load(open(f'{WEB}/src/story/lines.json'))
STORY = json.load(open(f'{WEB}/src/story/story.json'))
names = {k: v['name'] for k, v in no['SPEAKERS'].items()}

os.makedirs(f'{out}/beats', exist_ok=True)
os.makedirs(f'{out}/stills', exist_ok=True)
stills = {}
for p in sorted(glob.glob(f'{stills_dir}/*.png')):
    key, nn, bid = os.path.basename(p)[:-4].split('-', 2)
    ch = next((c for c in no['CHAPTERS'] if str(c['key']) == key), None)
    if not ch or bid not in [b['id'] for b in ch['beats']] or bid in stills: continue   # an auto beat that ran on
    im = Image.open(p).convert('RGB'); im.thumbnail((800, 450))
    im.save(f'{out}/stills/{bid}.jpg', quality=78); stills[bid] = f'stills/{bid}.jpg'

def moved(s):
    return 'walks' if 'walk' in s else 'sits down' if 'sit' in s else 'stands up' if 'stand' in s else 'pours' if 'pour' in s else 'picks up the jug' if s.get('carry') else 'puts it down' if 'carry' in s else 'turns'

docs = []
for ch, che in zip(no['CHAPTERS'], en['CHAPTERS']):
    if ch['key'] == 1: continue   # the prologue is the flight: no text to edit here yet
    chats = dict((ch.get('base') or {}).get('chats') or {})
    for b, be in zip(ch['beats'], che['beats']):
        st = b.get('set') or {}
        if 'chats' in st: chats = dict(st['chats'])
        items, t = [], 0.0
        cards_en = [x['card'].get('text', '') for x in be.get('do') or [] if x.get('card')]
        ncard = 0
        for s in b.get('do') or []:
            t0 = round(t, 1)
            if 'say' in s:
                l = LINES[s['say']]; dur = VOICE.get(s['say'], {}).get('dur', 2.5)
                items.append({'kind': 'line', 'id': s['say'], 'who': l.get('name') or names.get(l['who'], l['who']), 'role': l['who'], 'en': l['text'], 'no': l.get('no', ''), 'fx': l.get('fx'), **{f: False for f in ('voice', 'subs') if l.get(f) is False}, 't': t0, 'd': dur})
                t += dur + 0.3
            elif 'chat' in s:
                c = s['chat']; i = chats.get(c, 0); chats[c] = i + 1
                m = STORY['chats'][c]['messages'][i]
                items.append({'kind': 'chat', 'key': c, 'idx': i, 'chat': STORY['chats'][c]['title']['no'], 'from': STORY['chats'][c]['who'] if m[0] == 'me' else 'Agent', 'no': m[1]['no'], 'en': m[1]['en'], 't': t0, 'd': 1.2})
                t += 1.2 if m[0] == 'ai' else 0.2
            elif 'card' in s:
                if s['card']:
                    items.append({'kind': 'card', 'no': s['card'].get('text', ''), 'en': cards_en[ncard] if ncard < len(cards_en) else '', 'sub': s['card'].get('sub'), 't': t0})
                    ncard += 1
            elif 'set' in s and 'shot' in s['set']: items.append({'kind': 'shot', 'shot': s['set']['shot'], 't': t0})
            elif 'wait' in s: t += s['wait']
            elif 'idle' in s: t += 2.5
            elif 'move' in s: items.append({'kind': 'move', 'who': names.get(s['move'], s['move']), 'what': moved(s), 't': round(t + s.get('at', 0), 1)})
            elif 'rewind' in s or 'forward' in s:
                items.append({'kind': 'fx', 'what': 'rewind' if 'rewind' in s else 'fast forward', 't': t0}); t += s.get('rewind') or s.get('forward')
            elif 'torvet' in s:
                items.append({'kind': 'move', 'who': 'Torvet', 'what': s['torvet'], 't': t0}); t += {'meet': 4, 'shake': 2, 'in': 3}.get(s['torvet'], 2)
            elif 'graph' in s: items.append({'kind': 'fx', 'what': f"graph grows to {s['graph']}", 't': t0})
        if (b.get('end') or {}).get('chats'): chats = dict(b['end']['chats'])
        slide = None
        ov = st.get('overlay')
        if ov and ov.startswith('slide:'):
            sid = ov[6:]
            src = STORY['slides'].get(sid) or {'no': no['SLIDES'][sid], 'en': en['SLIDES'][sid], 'placeholder': no['SLIDES'][sid].get('placeholder')}
            slide = {'id': sid, 'placeholder': bool(src.get('placeholder'))}
            for l in ('no', 'en'): slide[l] = {'title': src[l].get('title', ''), 'bullets': src[l].get('bullets', []), 'caption': src[l].get('caption', '')}
        callouts = STORY['callouts'].get(b['id'], [])
        isnew = any(x['id'] == b['id'] for x in STORY['inserted'])
        card = b.get('card')
        doc = {'ch': ch['key'], 'chName': ch['name'], 'id': b['id'], 'auto': b.get('auto', False), 'dur': round(t, 1), 'notes': b.get('notes', ''), 'card': card,
               'slide': slide, 'items': items, 'callouts': callouts, 'ctx': {k: st[k] for k in ('shot', 'tool', 'place') if st.get(k)}, 'still': stills.get(b['id']),
               'base': {'notes': b.get('notes', ''), 'card': card, 'cards': [x for x in items if x['kind'] == 'card']}, 'isNew': isnew}
        docs.append(doc)
writes = []
for i, doc in enumerate(docs):
    doc['order'] = (i + 1) * 10
    p = os.path.abspath(f"{out}/beats/{doc['id']}.json")
    json.dump(doc, open(p, 'w'), ensure_ascii=False)
    writes.append({'op': 'set', 'collection': 'beats', 'doc_id': doc['id'], 'file_path': p})
json.dump(writes, open(f'{out}/writes.json', 'w'), indent=0)
print(len(docs), 'beats,', len(stills), 'stills ->', out)
