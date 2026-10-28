"""Make the public (blurred) copies of story mode's deck slides and report
pictures from the private originals.

    python web/scripts/blur_public.py

The slides and the tools' screenshots show real names, logos and tags, so
the public repo and GitHub Pages carry only blurred copies: the layout and
colours read, the words do not. The sharp originals live in the git-ignored
public/story/private/ (slides/<id>.png, reports/<file>.png|.mp4; master copy
in the private project files) and show with ?private=1.

Rewrites public/story/slides/<id>.webp and public/story/reports/<name>.webp|.mp4
for the originals that already have a public copy (a private-only slide stays
private). Videos need ffmpeg.
"""
import glob, os, subprocess
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
STORY = os.path.join(HERE, '..', 'public', 'story')
PRIVATE = os.path.join(STORY, 'private')
BLUR = 1 / 90   # gaussian radius as a share of the picture's width: small print goes, headings stay shapes


def blur_image(src, dst):
    im = Image.open(src).convert('RGB')
    im.filter(ImageFilter.GaussianBlur(max(4, im.width * BLUR))).save(dst, 'WEBP', quality=70)


def blur_video(src, dst):
    # three box passes come close to the pictures' gaussian
    vf = 'boxblur=luma_radius=w/90:luma_power=3:chroma_radius=w/180:chroma_power=3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vf', vf, '-an',
                    '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst], check=True)


def main():
    n = 0
    jobs = [(src, os.path.join(STORY, 'slides', os.path.basename(src)[:-4] + '.webp'), blur_image)
            for src in sorted(glob.glob(os.path.join(PRIVATE, 'slides', '*.png')))]
    for src in sorted(glob.glob(os.path.join(PRIVATE, 'reports', '*'))):
        name, ext = os.path.splitext(os.path.basename(src))
        if ext in ('.png', '.mp4'):
            jobs.append((src, os.path.join(STORY, 'reports', name + ('.webp' if ext == '.png' else ext)), blur_image if ext == '.png' else blur_video))
    for src, dst, blur in jobs:
        if os.path.exists(dst):
            blur(src, dst); n += 1
    print(f'{n} blurred copies written')


if __name__ == '__main__':
    main()
