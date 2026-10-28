# Read the PowerPoint animation pane (main sequence) of an unpacked .pptx.
#   python3 pptx_anim_parse.py <unpacked deck dir> <out>/anim.json
# Lists each slide's effects: click / with / after, entrance or exit, target shape.
import sys, re, json
from defusedxml import minidom
X = sys.argv[1]
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
pres = minidom.parse(f'{X}/ppt/presentation.xml'); rels = minidom.parse(f'{X}/ppt/_rels/presentation.xml.rels')
rid = {r.getAttribute('Id'): r.getAttribute('Target') for r in rels.getElementsByTagName('Relationship')}
order = [rid[s.getAttribute('r:id')] for s in pres.getElementsByTagName('p:sldId')]
out = {}
for n, t in enumerate(order, 1):
    d = minidom.parse(f'{X}/ppt/{t}')
    shapes = {}
    for tag in ('p:sp', 'p:pic', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp'):
        for sp in d.getElementsByTagName(tag):
            c = sp.getElementsByTagName('p:cNvPr')[0]
            txt = ' '.join(x.firstChild.data for x in sp.getElementsByTagName('a:t') if x.firstChild)
            xf = (sp.getElementsByTagName('a:xfrm') or sp.getElementsByTagName('p:xfrm') or [None])[0]
            box = None
            off = xf.getElementsByTagName('a:off') if xf else []; ext = xf.getElementsByTagName('a:ext') if xf else []
            if off and ext: box = [int(off[0].getAttribute('x')), int(off[0].getAttribute('y')), int(ext[0].getAttribute('cx')), int(ext[0].getAttribute('cy'))]
            shapes[c.getAttribute('id')] = {'name': c.getAttribute('name'), 'text': txt[:90], 'box': box, 'tag': tag}
    tm = d.getElementsByTagName('p:timing')
    if not tm: continue
    steps = []
    # main sequence: click groups are the p:par children of the mainSeq's childTnLst
    for seq in tm[0].getElementsByTagName('p:seq'):
        cTn = seq.getElementsByTagName('p:cTn')[0]
        kind = cTn.getAttribute('nodeType')
        for ctn in seq.getElementsByTagName('p:cTn'):
            if not ctn.getAttribute('presetClass'): continue
            tgt = ctn.getElementsByTagName('p:spTgt')
            sid = tgt[0].getAttribute('spid') if tgt else None
            para = tgt[0].getElementsByTagName('p:pRg') if tgt else []
            steps.append({'seq': kind, 'node': ctn.getAttribute('nodeType'), 'class': ctn.getAttribute('presetClass'), 'preset': ctn.getAttribute('presetID'), 'grp': ctn.getAttribute('grpId'), 'dur': ctn.getAttribute('dur'), 'spid': sid, 'para': para[0].getAttribute('st') if para else None, 'shape': shapes.get(sid, {}).get('name'), 'text': shapes.get(sid, {}).get('text')})
    out[n] = {'file': t, 'steps': steps, 'shapes': shapes}
json.dump(out, open(sys.argv[2], 'w'), indent=1)
for n, s in out.items():
    print(f'--- slide {n} ({len(s["steps"])} effects)')
    for st in s['steps']: print(f"  {st['seq'][:4]} {st['node']:13} {st['class']:5} p{st['preset']:3} {st['shape']} | {st['text'] or ''}"[:150])
