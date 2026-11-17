#!/usr/bin/env bash
# Re-download Boris Ryzhy editions (copyrighted: kept out of git, see .gitignore).
set -e
D="${1:-corpus/ryzhy}"; mkdir -p "$D/raw"; cd "$D/raw"
curl -sL -o k.zip https://flibusta.is/b/308127/fb2 && unzip -o -q k.zip && rm k.zip   # В кварталах дальних и печальных (2012), fb2
curl -sL -o 703898_I-vse-takoe.pdf        https://flibusta.is/b/703898/fb2            # И всё такое... (pdf)
curl -sL -o 703899_Na-holodnom-vetru.pdf  https://flibusta.is/b/703899/fb2            # На холодном ветру (pdf)
curl -sL -o 732115_Opravdanie-zhizni.djvu https://flibusta.is/b/732115/fb2            # Оправдание жизни (2015, djvu)
cd ..
python3 ../../tools/fb2_to_txt.py raw/*.fb2 ryzhy_v-kvartalah-2012.txt
pdftotext -layout raw/703898_I-vse-takoe.pdf ryzhy_i-vse-takoe.txt
pdftotext -layout raw/703899_Na-holodnom-vetru.pdf ryzhy_na-holodnom-vetru.txt
djvutxt raw/732115_Opravdanie-zhizni.djvu ryzhy_opravdanie-zhizni.txt   # apt-get install djvulibre-bin
