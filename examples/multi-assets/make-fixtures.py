"""Create numbered test cards, short motion clips, and quiet test tones.
Requires Python 3, Pillow, and ffmpeg. Run from any directory.
"""
from pathlib import Path
import colorsys
import math
import shutil
import struct
import subprocess
import wave
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
for folder in ('images', 'videos', 'audio', 'boundary'):
    (ROOT / folder).mkdir(exist_ok=True)

font = next((p for p in (
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
) if Path(p).exists()), None)

def card(label, number, kind):
    color = tuple(int(v * 255) for v in colorsys.hsv_to_rgb(number / 31, .42, .82))
    image = Image.new('RGB', (512, 512), '#f5f3ef')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, 488, 488), 36, fill=color)
    large = ImageFont.truetype(font, 170) if font else ImageFont.load_default()
    small = ImageFont.truetype(font, 28) if font else ImageFont.load_default()
    draw.text((256, 235), f'{number:02}', fill='#ffffff', font=large, anchor='mm')
    draw.text((256, 390), f'{kind} REFERENCE', fill='#ffffff', font=small, anchor='mm')
    draw.text((256, 435), label, fill='#ffffff', font=small, anchor='mm')
    return image

for number in range(1, 32):
    folder = 'images' if number <= 30 else 'boundary'
    card('DEMO ONLY', number, 'IMAGE').save(ROOT / folder / f'测试图_{number:02}.png')

if not shutil.which('ffmpeg'):
    raise SystemExit('Images created. Install ffmpeg to also create the videos.')

for number in range(1, 12):
    folder = 'videos' if number <= 10 else 'boundary'
    frame = ROOT / f'.video-frame-{number:02}.png'
    card('DEMO ONLY', number, 'VIDEO').save(frame)
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1',
        '-i', str(frame), '-t', '2.1', '-vf',
        "zoompan=z='1+0.002*on':d=1:s=768x768:fps=24",
        '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        str(ROOT / folder / f'测试视频_{number:02}.mp4'),
    ], check=True)
    frame.unlink()
    folder = 'audio' if number <= 10 else 'boundary'
    rate, duration = 16000, 2.1
    with wave.open(str(ROOT / folder / f'测试音频_{number:02}.wav'), 'wb') as out:
        out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        data = []
        for sample in range(int(rate * duration)):
            t = sample / rate
            fade = min(1, t / .1, (duration - t) / .1)
            value = int(1800 * fade * math.sin(2 * math.pi * (240 + number * 30) * t))
            data.append(struct.pack('<h', value))
        out.writeframes(b''.join(data))

image_refs = '，'.join(f'@测试图_{i:02}' for i in range(1, 31)) + '。'
video_refs = '，'.join(f'@测试视频_{i:02}' for i in range(1, 11)) + '。'
audio_refs = '，'.join(f'@测试音频_{i:02}' for i in range(1, 11)) + '。'
(ROOT / 'prompt-30-images.txt').write_text('图片引用测试：' + image_refs + '\n仅用于核对素材名称与原生标签。\n', encoding='utf-8')
(ROOT / 'prompt-50-mixed.txt').write_text('图片参考：' + image_refs + '\n动作参考：' + video_refs + '\n声音参考：' + audio_refs + '\n仅用于核对素材名称与原生标签。\n', encoding='utf-8')
(ROOT / 'prompt-31-images.txt').write_text('图片上限测试：' + image_refs[:-1] + '，@测试图_31。\n', encoding='utf-8')
mixed = (ROOT / 'prompt-50-mixed.txt').read_text(encoding='utf-8').strip()
(ROOT / 'prompt-100-references.txt').write_text('第一组引用：\n' + mixed + '\n\n第二组引用（复用同一批 50 个素材，不重复上传）：\n' + mixed + '\n', encoding='utf-8')
print('Created 30 images + 10 videos + 10 audio files, 3 boundary files, and prompts.')
