"""
Шаг 3 акустической проверки — решающий: «дальних» или «дальных»?

Метод. Фонемный распознаватель wav2vec2 XLSR-53, дообученный выдавать
фонемы IPA (facebook/wav2vec2-xlsr-53-espeak-cv-ft). У него НЕТ словаря и
языковой модели — он не знает слов и потому не может «поправить» ы на и.
Он просто говорит, какой звук слышит в каждом кадре (кадр = 20 мс).

Различие «дальних» / «дальных» в безударном окончании сводится к
мягкости согласного: в «дальних» перед [и] «н» обязательно мягкое
([nʲ], модель пишет его символом ɲ), в «дальных» — твёрдое [n].
Поэтому для каждого кадра, где модель распознала «н», печатаем
вероятности P[n] (твёрдое), P[ɲ] и P[nʲ] (мягкое).

Калибровка — на ТОМ ЖЕ голосе, в той же записи: слова с заведомо мягким
«н» («НЕнужный», «НЕбо», «сиНЕе») и заведомо твёрдым («родНОе»,
«печальНЫх»). Если модель на этом голосе различает мягкость, её ответ
по спорному слову можно принимать.

Результат на 20_ryzhiy1.mp3:
  калибровка мягкое:  P[ɲ]+P[nʲ] = 0.78–0.87
  калибровка твёрдое: P[n] = 0.93–0.98
  «дальн?х», строка 1: P[n] = 0.61, P[мягк.] = 0.01   -> твёрдое
  «дальн?х», финал:    P[n] = 0.92, P[мягк.] = 0.00   -> твёрдое
  => в чтении звучит «дальных», оба раза.

Подготовка:
    pip install torch --index-url https://download.pytorch.org/whl/cpu
    pip install transformers phonemizer soundfile
    apt-get install -y espeak-ng          # нужен токенизатору этой модели
Запуск:
    python3 tools/audio/phon3.py ryzhy.wav       # wav моно 16 кГц, как для asr.py

Времена отрезков ниже — для конкретного файла 20_ryzhiy1.mp3 (по asr.py).
"""
import sys

import soundfile as sf
import torch
from transformers import AutoProcessor, Wav2Vec2ForCTC

MID = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
proc = AutoProcessor.from_pretrained(MID)
model = Wav2Vec2ForCTC.from_pretrained(MID).eval()
tok = proc.tokenizer
v = tok.get_vocab()
N, NJ = v['n'], v['ɲ']   # твёрдое и мягкое (палатальное) «н»
NJ2 = v.get('nʲ')        # ещё один вариант записи мягкого «н», если есть в словаре

a, sr = sf.read(sys.argv[1], dtype="float32")


def probe(s, e, label):
    """Распознать отрезок [s, e] секунд и показать все кадры с «н»."""
    x = a[int(s * sr):int(e * sr)]
    with torch.no_grad():
        P = model(proc(x, sampling_rate=sr, return_tensors="pt").input_values).logits[0].softmax(-1)
    ids = P.argmax(-1).tolist()   # самый вероятный символ в каждом 20-мс кадре
    res = []
    for i, t in enumerate(ids):
        if t in (N, NJ) or (NJ2 and t == NJ2):
            # следующий распознанный символ — чтобы видеть, какой гласный после «н»
            nxt = next((tok.convert_ids_to_tokens(u) for u in ids[i + 1:]
                        if u not in (t, tok.pad_token_id)), '')
            res.append(f"{tok.convert_ids_to_tokens(t)}@{s + i * 0.02:.2f}(→{nxt}) "
                       f"P[n]={P[i, N]:.2f} P[ɲ]={P[i, NJ]:.2f}"
                       + (f" P[nʲ]={P[i, NJ2]:.2f}" if NJ2 else ''))
    print(f"== {label}")
    for r in res:
        print('   ', r)


# Спорное слово (+ «печальных» как твёрдый контроль в той же строке)
probe(0.0, 4.4, "строка 1 (дальн?х ≈1.34; печальных ≈2.54)")
probe(60.9, 63.3, "финал (дальн?х ≈62.40)")
# Калибровка на том же голосе
probe(11.9, 15.8, "калибровка: ненужный, небо (мягкие)")
probe(42.1, 43.8, "калибровка: родное (твёрдое)")
probe(38.6, 40.5, "калибровка: синее (мягкое)")
