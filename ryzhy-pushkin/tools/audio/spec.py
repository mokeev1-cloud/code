"""
Шаг 2 акустической проверки: спектрограммы двух строк с «дальн?х»
и наложенными формантами F1 (красные точки) и F2 (синие).

Идея, которая НЕ сработала (и почему): мягкое «нь» перед «и» и твёрдое
«н» перед «ы» должны различаться по F2 гласного (у [и] F2 высокая,
~2000+ Гц; у [ы] ниже, ~1500). Но в записи есть ровный тональный фон —
горизонтальные полосы около 600 Гц (строка 1) и 940 Гц (финал), — и
трекер формант Praat «прилипает» к нему. Поэтому картинка оставлена как
документ (видно и фон, и сегментацию), а вывод делается в phon3.py.

Подготовка:  pip install praat-parselmouth matplotlib numpy
Запуск:      python3 tools/audio/spec.py ryzhy.wav spectrogram.png

Времена окон (в секундах) — для конкретного файла 20_ryzhiy1.mp3,
подобраны по таймкодам из asr.py.
"""
import sys

import matplotlib
matplotlib.use('Agg')  # рисуем в файл, без экрана
import matplotlib.pyplot as plt
import numpy as np
import parselmouth

snd = parselmouth.Sound(sys.argv[1])
out = sys.argv[2]
wins = [(0.55, 2.75, 'строка 1: «В кварталах ДАЛЬН?Х и ПЕЧАЛЬНЫХ»'),
        (61.55, 63.25, 'последняя строка: «ДАЛЬН?Х и ПЕЧАЛЬНЫХ»')]

fig, axs = plt.subplots(2, 1, figsize=(16, 9))
for ax, (a, b, t) in zip(axs, wins):
    part = snd.extract_part(a, b)
    # Широкополосная спектрограмма (окно 5 мс) — хорошо видны форманты.
    sp = part.to_spectrogram(window_length=0.005, maximum_frequency=4500)
    X, Y = sp.x_grid() + a, sp.y_grid()
    db = 10 * np.log10(sp.values + 1e-12)
    ax.pcolormesh(X, Y, db, vmin=db.max() - 60, cmap='Greys', shading='auto')

    # Форманты рисуем только на звонких участках (где Praat нашёл основной тон);
    # p.get_value_at_time(x) == сам себе  <=>  не NaN.
    fm = part.to_formant_burg(time_step=0.005, maximum_formant=5000)
    p = part.to_pitch(time_step=0.005)
    ts = np.arange(0, b - a, 0.005)
    for k, c in [(1, 'tab:red'), (2, 'tab:blue')]:
        v = [fm.get_value_at_time(k, x) if p.get_value_at_time(x) == p.get_value_at_time(x) else np.nan
             for x in ts]
        ax.plot(ts + a, v, '.', ms=2, color=c)

    ax.set_xticks(np.arange(round(a, 1), b, 0.1))
    ax.tick_params(axis='x', labelsize=7)
    ax.grid(axis='x', alpha=.3)
    ax.set_title(t)
    ax.set_ylabel('Hz')

plt.tight_layout()
plt.savefig(out, dpi=110)
