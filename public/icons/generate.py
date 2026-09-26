#!/usr/bin/env python3
"""
Genera los íconos de la app a partir del monograma cuadrado "MR."
(public/img/icon-mark.png, 1024x1024, fondo Blanco Humo #F4F4F4):

- icon-192.png e icon-512.png: los del manifest ("any maskable"). El
  monograma cabe dentro del círculo seguro del 80 %, así que Android puede
  recortarlo en círculo sin cortar letras.
- apple-touch-icon.png (180x180): el que se ve al "Agregar a inicio" en iOS.

Se usa el monograma y no el logo completo porque "MARTHA RDZ." es muy
ancho y bajo: a 180 px el "HAIR ARTIST" quedaría ilegible.

El monograma usa la misma tipografía del logo (DejaVu Serif Bold para
"MR." y DejaVu Sans espaciada para "HAIR ARTIST", en Verde Menta). Si
cambia, reemplaza icon-mark.png (mínimo 512x512) y corre esto de nuevo.

Requiere Pillow: pip install pillow
Uso: python3 public/icons/generate.py (desde la raíz del repo)
"""

from PIL import Image
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MARK_PATH = os.path.join(BASE_DIR, '..', 'img', 'icon-mark.png')

TARGETS = [
    (192, 'icon-192.png'),
    (512, 'icon-512.png'),
    (180, 'apple-touch-icon.png'),
]


def main():
    mark = Image.open(MARK_PATH).convert('RGB')
    for size, filename in TARGETS:
        mark.resize((size, size), Image.LANCZOS).save(os.path.join(BASE_DIR, filename), optimize=True)
    print(f'Generados {len(TARGETS)} íconos en {BASE_DIR}')


if __name__ == '__main__':
    main()
