"""Render story mode's spoken lines with Kokoro, the free offline voice model.

    pip install kokoro-onnx soundfile        # plus ffmpeg on the PATH
    python web/scripts/voices.py [--model DIR] [--only ID ...] [--force]

Reads web/src/story/lines.json and writes web/public/story/voice/<id>.mp3 plus
voice.json: each line's length and a 30 fps mouth track (0 closed .. 3 wide,
from the loudness), which the characters' jaws follow. A line is rendered
again only when its text, speaker, voice or effect changed (voice.json keeps
a hash of them), so editing one line costs one line.

The model files (kokoro-v1.0.int8.onnx, voices-v1.0.bin) come from the
kokoro-onnx releases on GitHub (model-files-v1.0); --model says where they are.

Kokoro does calm talk well and stress badly (thread "Character voices"). The
main speakers are meant to move to a paid voice later; this script is the
placeholder pass, and a recorded mp3 dropped in with the same id works too
(add "keep": true to its line so it is not overwritten).

The lines say the public stand-in names (Ola, Nordhav Energi...). With
--private, the lines that change under the private name map
(public/story/private/overrides.json "names", git-ignored) are rendered with
the real names into public/story/private/voice/, which ?private=1 plays
instead:

    python web/scripts/voices.py --private
"""
import argparse, hashlib, json, os, re, subprocess, tempfile
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
LINES = os.path.join(HERE, '..', 'src', 'story', 'lines.json')
OUT = os.path.join(HERE, '..', 'public', 'story', 'voice')
PRIVATE = os.path.join(HERE, '..', 'public', 'story', 'private')
SR, FPS = 24000, 30

# Speaker -> (Kokoro voice, speed).
CAST = {
    'pilot': ('bm_fable', 1.0),         # behind the intercom filter
    'supervisor': ('am_michael', 1.0),  # blazer_lead, shift supervisor
    'oim': ('bm_george', 0.95),         # grey_beard_lead
    'operator': ('am_fenrir', 1.0),     # bearded_operator
    'planner': ('bm_lewis', 1.0),       # crop_supervisor, onshore, on the phone
    'engineer': ('am_puck', 1.0),       # glasses_engineer, onshore control engineer
    'analyst': ('am_echo', 1.0),        # curly_analyst, reliability engineer
    'tech': ('am_liam', 1.05),          # curly_fade_tech, on the radio
    'crew': ('bf_emma', 1.0),           # ground crew at Sola (the optional opening)
    'ceo': ('am_onyx', 0.95),           # glasses_ceo, welcomes Adriaen at Føniks one year ago
    'neighbour': ('bm_daniel', 0.97),   # the neighbouring platform on the phone (caller.js)
    'agent': ('af_nova', 1.05),         # the AI agents on the screens, through the robot filter
}


def band(x, lo, hi, drive):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, len(x))
    y = np.tanh(y * drive) / drive
    return y / (np.abs(y).max() + 1e-9) * 0.8


def radio(x):
    y = band(x, 300, 3400, 3)
    hiss = np.random.default_rng(1).standard_normal(len(y)) * 0.006
    return y + hiss


def phone(x):
    return band(x, 380, 3000, 2)


def robot(x):
    """The agents' voice: a metallic comb (a 9 ms feedback delay rings at
    110 Hz, a flat machine pitch under the words), a light ring modulation
    and a narrower band, so nobody takes it for a person."""
    d = SR // 110
    y = x.copy()
    for i in range(d, len(y)):
        y[i] += 0.55 * y[i - d]
    t = np.arange(len(y)) / SR
    y = y * (0.75 + 0.25 * np.sin(2 * np.pi * 55 * t))
    return band(0.5 * x + 0.5 * y / (np.abs(y).max() + 1e-9), 180, 5500, 1.5)


def mouth(x):
    hop = SR // FPS
    n = len(x) // hop
    rms = np.array([np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])
    rms = np.convolve(rms, [0.2, 0.6, 0.2], 'same')
    ref = np.percentile(rms[rms > 1e-4], 90) if (rms > 1e-4).any() else 1
    return ''.join(map(str, np.digitize(rms / ref, [0.15, 0.55, 0.95])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='/tmp/tts')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--private', action='store_true', help='render the lines with real names into public/story/private/voice')
    args = ap.parse_args()
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(args.model, 'kokoro-v1.0.int8.onnx'), os.path.join(args.model, 'voices-v1.0.bin'))
    lines = {i: l for i, l in json.load(open(LINES)).items() if not i.startswith('_')}
    out = OUT
    if args.private:
        names = json.load(open(os.path.join(PRIVATE, 'overrides.json'))).get('names', {})
        keys = sorted(names, key=len, reverse=True)
        pat = re.compile(r'(?<![\w])(' + '|'.join(map(re.escape, keys)) + r')(?![\w])')
        real = lambda t: pat.sub(lambda m: names[m.group(1)], t)
        lines = {i: {**l, 'text': real(l['text'])} for i, l in lines.items() if keys and real(l['text']) != l['text']}
        out = os.path.join(PRIVATE, 'voice')
    os.makedirs(out, exist_ok=True)
    index_path = os.path.join(out, 'voice.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    for lid, line in lines.items():
        voice, speed = CAST[line['who']]
        key = hashlib.sha1(json.dumps([line['text'], line['who'], voice, speed, line.get('fx')]).encode()).hexdigest()[:12]
        mp3 = os.path.join(out, f'{lid}.mp3')
        if line.get('keep') or (args.only and lid not in args.only):
            continue
        if not args.force and index.get(lid, {}).get('hash') == key and os.path.exists(mp3):
            continue
        s, _ = k.create(line['text'], voice=voice, speed=speed, lang='en-us' if voice[0] == 'a' else 'en-gb')
        nz = np.flatnonzero(np.abs(s) > 0.01)  # trim Kokoro's own lead and tail
        if len(nz):
            s = s[max(0, nz[0] - 240): nz[-1] + 1200]
        s = np.concatenate([np.zeros(int(SR * 0.05)), s, np.zeros(int(SR * 0.1))])
        env = mouth(s)
        if line.get('fx') == 'radio':
            s = radio(s)
        elif line.get('fx') == 'phone':
            s = phone(s)
        elif line.get('fx') == 'robot':
            s = robot(s)
        with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
            sf.write(wav.name, s, SR)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav.name, '-ac', '1', '-b:a', '48k', mp3], check=True)
        index[lid] = {'hash': key, 'dur': round(len(s) / SR, 2), 'mouth': env}
        print(f'{lid:10s} {voice:11s} {len(s) / SR:5.1f} s  {line["text"][:60]}')
    for lid in list(index):
        if lid not in lines:
            del index[lid]
    json.dump(dict(sorted(index.items())), open(index_path, 'w'), indent=0, separators=(',', ':'))


if __name__ == '__main__':
    main()
