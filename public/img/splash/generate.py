#!/usr/bin/env python3
"""
Genera las imágenes de splash de iOS (public/img/splash/*.png) a partir del
logo (public/img/logo.png, PNG transparente) sobre el fondo cream de la app
(--color-bg en styles.css). Requiere Pillow: pip install pillow

Uso: python3 public/img/splash/generate.py
(desde la raíz del repo, o ajustando las rutas de abajo)

Si el logo cambia, corre esto de nuevo y actualiza los <link
rel="apple-touch-startup-image"> de index.html solo si cambiaron los
tamaños de archivo (los nombres ya son fisicos_w x fisico_h, no cambian
aunque cambie el diseño del logo).
"""

from PIL import Image
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGO_PATH = os.path.join(BASE_DIR, '..', 'logo.png')
BG_COLOR = (253, 249, 250)  # --color-bg (#FDF9FA) en styles.css

# (ancho físico, alto físico) de pantalla — portrait — para cada tamaño de
# iPhone/iPad que Safari reconoce vía apple-touch-startup-image. El nombre
# de archivo generado es "{w}x{h}.png"; el media query correspondiente
# (device-width/device-height en puntos CSS + -webkit-device-pixel-ratio)
# vive en index.html, no aquí.
SIZES = [
    (640, 1136),   # iPhone SE 1a gen / 5s
    (750, 1334),   # iPhone 6/6s/7/8, SE 2a/3a gen
    (1242, 2208),  # iPhone 6/7/8 Plus
    (1125, 2436),  # iPhone X/XS, 11 Pro, 12 mini, 13 mini
    (828, 1792),   # iPhone XR, 11
    (1242, 2688),  # iPhone XS Max, 11 Pro Max
    (1170, 2532),  # iPhone 12, 12 Pro, 13, 13 Pro, 14
    (1284, 2778),  # iPhone 12 Pro Max, 13 Pro Max, 14 Plus
    (1179, 2556),  # iPhone 14 Pro, 15, 15 Pro, 16
    (1290, 2796),  # iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    (1206, 2622),  # iPhone 16 Pro
    (1320, 2868),  # iPhone 16 Pro Max
    (1536, 2048),  # iPad mini 1-5, iPad Air 1-2, iPad 9.7"/10.2" viejos
    (1488, 2266),  # iPad mini 6a gen
    (1620, 2160),  # iPad 10.2" (7a-9a gen)
    (1640, 2360),  # iPad 10.9" (10a gen), iPad Air 10.9" (4a/5a gen)
    (1668, 2224),  # iPad Pro 10.5", iPad Air 3a gen
    (1668, 2388),  # iPad Pro 11" (1a-4a gen), iPad Air 11" M2
    (1668, 2420),  # iPad Pro 11" M4
    (2048, 2732),  # iPad Pro 12.9" (todas las generaciones)
    (2064, 2752),  # iPad Air 13" M2, iPad Pro 13" M4
]


def main():
    logo = Image.open(LOGO_PATH)
    if logo.mode != 'RGBA':
        logo = logo.convert('RGBA')

    for w, h in SIZES:
        canvas = Image.new('RGB', (w, h), BG_COLOR)
        target_w = min(round(w * 0.62), 900)
        scale = target_w / logo.width
        target_h = round(logo.height * scale)
        resized = logo.resize((target_w, target_h), Image.LANCZOS)
        x = (w - target_w) // 2
        y = (h - target_h) // 2
        canvas.paste(resized, (x, y), resized)
        canvas.save(os.path.join(BASE_DIR, f'{w}x{h}.png'))

    print(f'Generadas {len(SIZES)} imágenes de splash en {BASE_DIR}')


if __name__ == '__main__':
    main()
