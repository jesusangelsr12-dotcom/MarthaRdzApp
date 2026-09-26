#!/usr/bin/env python3
"""
Genera los íconos del manifest (public/icons/icon-192.png, icon-512.png) a
partir del logo (public/img/logo.png) sobre el fondo cream de la marca —
mismo criterio que public/img/splash/generate.py, para que el ícono se
sienta parte del mismo sistema visual que el login y el splash, en vez de
un ícono genérico aparte (antes eran unas tijeras de una plantilla vieja).

apple-touch-icon.png (el que se ve al "Agregar a inicio" en iOS) NO se
genera aquí: usa el monograma cuadrado "MR" (public/img/icon-mark.png),
un asset aparte pensado para verse bien como ícono cuadrado — el wordmark
completo es demasiado ancho/bajo para eso. Para regenerarlo:

    python3 -c "
    from PIL import Image
    src = Image.open('public/img/icon-mark.png').convert('RGB')
    src.resize((180, 180), Image.LANCZOS).save('public/icons/apple-touch-icon.png')
    "

Requiere Pillow: pip install pillow
Uso: python3 public/icons/generate.py (desde la raíz del repo)
"""

from PIL import Image
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGO_PATH = os.path.join(BASE_DIR, '..', 'img', 'logo.png')
BG_COLOR = (253, 249, 250)  # --color-bg (#FDF9FA) en styles.css

# (tamaño, nombre de archivo) — 192/512 son los del manifest (maskable, por
# eso el logo se queda angosto: el sistema puede recortar en círculo en
# Android).
TARGETS = [
    (192, 'icon-192.png'),
    (512, 'icon-512.png'),
]


def main():
    logo = Image.open(LOGO_PATH)
    if logo.mode != 'RGBA':
        logo = logo.convert('RGBA')

    for size, filename in TARGETS:
        canvas = Image.new('RGB', (size, size), BG_COLOR)
        target_w = round(size * 0.62)
        scale = target_w / logo.width
        target_h = round(logo.height * scale)
        resized = logo.resize((target_w, target_h), Image.LANCZOS)
        x = (size - target_w) // 2
        y = (size - target_h) // 2
        canvas.paste(resized, (x, y), resized)
        canvas.save(os.path.join(BASE_DIR, filename))

    print(f'Generados {len(TARGETS)} íconos en {BASE_DIR}')


if __name__ == '__main__':
    main()
