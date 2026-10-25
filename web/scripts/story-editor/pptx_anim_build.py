#   python3 pptx_anim_build.py <unpacked deck dir> <out dir with anim.json>
# then render each k<NN>.pptx (LibreOffice, to PDF) and take page N of k<NN> as
# slide N after NN clicks: <slide id>.b<NN>.png in public/story/private/slides/.
# Appear/Disappear only; motion paths jump to where they end.
# Build one copy of the unpacked deck per click count k: every slide shows its
# state after k clicks (its final state once it runs out of clicks).
import sys, json, shutil, os
from defusedxml import minidom
X, OUT = sys.argv[1], sys.argv[2]
A = json.load(open(f'{OUT}/anim.json'))
def steps_with_click(steps):
    c, r = 0, []
    for s in steps:
        if s['node'] == 'clickEffect': c += 1
        r.append((c, s))
    return r
# re-read paragraph ranges (start, end) from the timing xml
def para_ranges(path):
    d = minidom.parse(path); out = []
    for ctn in d.getElementsByTagName('p:cTn'):
        if not ctn.getAttribute('presetClass'): continue
        t = ctn.getElementsByTagName('p:spTgt'); pr = t[0].getElementsByTagName('p:pRg') if t else []
        out.append((int(pr[0].getAttribute('st')), int(pr[0].getAttribute('end'))) if pr else None)
    return out
plan, maxc = {}, 0
for n, s in A.items():
    rng = para_ranges(f'{X}/ppt/{s["file"]}')
    st = steps_with_click(s['steps'])
    for (c, e), r in zip(st, rng): e['rng'] = r
    plan[n] = st; maxc = max(maxc, st[-1][0] if st else 0)
def hide_para(p):
    for r in p.getElementsByTagName('a:r') + p.getElementsByTagName('a:fld'):
        rpr = (r.getElementsByTagName('a:rPr') or [None])[0]
        if rpr is None: rpr = p.ownerDocument.createElement('a:rPr'); r.insertBefore(rpr, r.firstChild)
        for f in [x for x in rpr.childNodes if x.nodeType == 1 and x.tagName in ('a:solidFill', 'a:gradFill', 'a:noFill')]: rpr.removeChild(f)
        nf = p.ownerDocument.createElement('a:noFill')
        # a:noFill must come before effect/highlight/latin etc: put it first after ln
        ln = [x for x in rpr.childNodes if x.nodeType == 1 and x.tagName == 'a:ln']
        rpr.insertBefore(nf, ln[0].nextSibling if ln else rpr.firstChild)
    ppr = (p.getElementsByTagName('a:pPr') or [None])[0]
    if ppr is None: ppr = p.ownerDocument.createElement('a:pPr'); p.insertBefore(ppr, p.firstChild)
    # transparent bullet: keep layout, hide the glyph
    for f in [x for x in ppr.childNodes if x.nodeType == 1 and x.tagName in ('a:buClrTx', 'a:buClr')]: ppr.removeChild(f)
    bc = p.ownerDocument.createElement('a:buClr'); clr = p.ownerDocument.createElement('a:srgbClr'); clr.setAttribute('val', 'FFFFFF')
    al = p.ownerDocument.createElement('a:alpha'); al.setAttribute('val', '0'); clr.appendChild(al); bc.appendChild(clr)
    kids = [x for x in ppr.childNodes if x.nodeType == 1]
    first = next((x for x in kids if x.tagName not in ('a:lnSpc', 'a:spcBef', 'a:spcAft')), None)
    ppr.insertBefore(bc, first)
counts = {}
for k in range(maxc + 1):
    D = f'{OUT}/k{k:02d}'
    if os.path.exists(D): shutil.rmtree(D)
    shutil.copytree(X, D)
    for n, st in plan.items():
        counts[n] = st[-1][0] if st else 0
        vis = {}
        for c, e in st:   # initial state from each target's first effect
            key = (e['spid'], e['rng'])
            vis.setdefault(key, e['class'] != 'entr')
        for c, e in st:
            if c > k: break
            if e['class'] == 'entr': vis[(e['spid'], e['rng'])] = True
            if e['class'] == 'exit': vis[(e['spid'], e['rng'])] = False
        path = f'{D}/ppt/{A[n]["file"]}'; d = minidom.parse(path)
        byid = {c.getAttribute('id'): c for c in d.getElementsByTagName('p:cNvPr')}
        for (sid, rng), v in vis.items():
            if v or sid not in byid: continue
            el = byid[sid].parentNode.parentNode   # cNvPr -> nvXxPr -> shape
            if rng is None: el.parentNode.removeChild(el); continue
            ps = [p for p in el.getElementsByTagName('a:p')]
            for i in range(rng[0], rng[1] + 1):
                if i < len(ps): hide_para(ps[i])
        open(path, 'w').write(d.toxml())
    os.system(f'cd {D} && rm -f ../k{k:02d}.pptx && zip -qXr ../k{k:02d}.pptx . && cd .. && rm -rf {D}')
json.dump(counts, open(f'{OUT}/clicks.json', 'w'))
print(maxc, counts)
