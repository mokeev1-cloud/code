import sys
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[2], device="cpu", compute_type="int8")
import soundfile as sf
audio,_=sf.read(sys.argv[1],dtype="float32")
segs, info = m.transcribe(audio, language="ru", word_timestamps=True, beam_size=5, condition_on_previous_text=False)
for s in segs:
    print(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text}")
    for w in s.words:
        if 'даль' in w.word.lower() or 'печал' in w.word.lower(): print(f"    WORD {w.word!r} {w.start:.2f}-{w.end:.2f} p={w.probability:.2f}")
