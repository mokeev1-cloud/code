"""Сборка nad-vechnym-pokoem.html: озвучка сценария (Piper) + одна аудиодорожка + таймлайн.

    python3 build.py путь/к/ru_RU-dmitri-medium.onnx

Голоса Piper: https://huggingface.co/rhasspy/piper-voices (ru/ru_RU/*).
Нужны: pip install piper-tts numpy; ffmpeg в PATH.
"""
import base64, json, subprocess, sys, tempfile, os
import numpy as np
from piper import PiperVoice, SynthesisConfig

HERE = os.path.dirname(os.path.abspath(__file__))
LENGTH_SCALE = 1.12      # >1 — медленнее
INNER_PAUSE = 0.45       # пауза между предложениями внутри одной реплики, с
AFTER_LINE = 1.1         # пауза после реплики, с

HTML_ONLY = sys.argv[1] == '--html-only'   # пересобрать страницу из готовых narration.mp3/timeline.json
if not HTML_ONLY:
    voice = PiperVoice.load(sys.argv[1])
    SR = voice.config.sample_rate
    cfg = SynthesisConfig(length_scale=LENGTH_SCALE, noise_scale=0.6, noise_w_scale=0.7)

def synth(text):
    parts = []
    for ch in voice.synthesize(text, cfg):
        parts.append(ch.audio_float_array.astype(np.float32))
        parts.append(np.zeros(int(INNER_PAUSE * SR), np.float32))
    return np.concatenate(parts[:-1]) if parts else np.zeros(0, np.float32)

def narrate():
    script = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
    audio, t = [], 0.0
    chapters, cues, moves = [], [], []
    lead = 1.0  # тишина в самом начале
    audio.append(np.zeros(int(lead * SR), np.float32)); t = lead
    for ci, ch in enumerate(script):
        chapters.append({'t': round(t, 2), 'title': ch['t']})
        for st in ch['s']:
            if isinstance(st, dict):
                moves.append({'t': round(t, 2), 'f': st['f'], 'ms': st.get('ms', 4000)})
            elif isinstance(st, (int, float)):
                audio.append(np.zeros(int(st * SR), np.float32)); t += st
            else:
                a = synth(st)
                cues.append({'t0': round(t, 2), 't1': round(t + len(a) / SR, 2), 'text': st})
                audio.append(a); t += len(a) / SR
                audio.append(np.zeros(int(AFTER_LINE * SR), np.float32)); t += AFTER_LINE
        print(f'{ci+1:2d} {ch["t"]:<16} до {t/60:5.2f} мин', flush=True)
    audio.append(np.zeros(int(2 * SR), np.float32)); t += 2

    pcm = (np.clip(np.concatenate(audio), -1, 1) * 32767).astype('<i2').tobytes()
    with tempfile.TemporaryDirectory() as d:
        raw, mp3 = os.path.join(d, 'a.raw'), os.path.join(HERE, 'narration.mp3')
        open(raw, 'wb').write(pcm)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', raw,
                        '-af', 'loudnorm=I=-18:TP=-2:LRA=11', '-ar', '22050',
                        '-c:a', 'libmp3lame', '-b:a', '48k', mp3], check=True)
    timeline = {'duration': round(t, 2), 'chapters': chapters, 'cues': cues, 'moves': moves}
    json.dump(timeline, open(os.path.join(HERE, 'timeline.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if not HTML_ONLY:
    narrate()
timeline = json.load(open(os.path.join(HERE, 'timeline.json'), encoding='utf-8'))
t = timeline['duration']
html = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
b64 = lambda p: base64.b64encode(open(os.path.join(HERE, p), 'rb').read()).decode()
for key, val in [('__IMG__', 'data:image/jpeg;base64,' + b64('levitan-nad-vechnym-pokoem.jpg')),
                 ('__AUDIO__', 'data:audio/mpeg;base64,' + b64('narration.mp3')),
                 ('"__TIMELINE__"', json.dumps(timeline, ensure_ascii=False))]:
    assert html.count(key) == 1, key
    html = html.replace(key, val)
open(os.path.join(HERE, 'nad-vechnym-pokoem.html'), 'w', encoding='utf-8').write(html)
print(f'готово: {t/60:.1f} мин, mp3 {os.path.getsize(os.path.join(HERE, "narration.mp3"))//1024} КБ')
