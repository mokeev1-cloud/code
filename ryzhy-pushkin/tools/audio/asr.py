"""
Шаг 1 акустической проверки: расшифровка записи «Моря» Whisper'ом
с пословными таймкодами.

Зачем: получить текст устного исполнения (сравнить с печатным) и
приблизительные времена слов «дальн?х» / «печальных».

ВАЖНО: Whisper НЕ годится для ответа «дальних или дальных» — у него внутри
языковая модель, обученная на нормативном русском, и она «исправляет»
услышанное в сторону нормы. Он оба раза пишет «дальних» (p = 0.75 / 0.94),
но это ничего не доказывает. Для ответа — phon3.py.

Подготовка:
    pip install faster-whisper soundfile
    ffmpeg -i запись.mp3 -ac 1 -ar 16000 ryzhy.wav    # моно 16 кГц

Запуск:
    python3 tools/audio/asr.py ryzhy.wav large-v3
(вторым аргументом — размер модели: tiny/base/small/medium/large-v3;
 модель скачивается с Hugging Face при первом запуске; на 4 ядрах CPU
 large-v3 обрабатывает минуту записи за несколько минут)

Примечание: аудио читается через soundfile и передаётся массивом, потому
что встроенный в faster-whisper декодер (PyAV) в этом окружении оказался
несовместим по версии.
"""
import sys

import soundfile as sf
from faster_whisper import WhisperModel

m = WhisperModel(sys.argv[2], device="cpu", compute_type="int8")
audio, _ = sf.read(sys.argv[1], dtype="float32")

segs, info = m.transcribe(
    audio,
    language="ru",
    word_timestamps=True,               # таймкоды каждого слова
    beam_size=5,
    condition_on_previous_text=False,   # меньше «галлюцинаций» на стихах
)
for s in segs:
    print(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text}")
    # Отдельно печатаем интересующие слова с вероятностью распознавания.
    for w in s.words:
        if 'даль' in w.word.lower() or 'печал' in w.word.lower():
            print(f"    WORD {w.word!r} {w.start:.2f}-{w.end:.2f} p={w.probability:.2f}")
