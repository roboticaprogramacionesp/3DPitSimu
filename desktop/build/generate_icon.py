# ==========================================================
# PitSimulator - desktop/build/generate_icon.py
#
# Genera desktop/build/icon.ico (cuadrado, multi-resolucion) a partir
# del 3DPit.ico existente en la raiz del repo (82x31px, no cuadrado,
# un solo tamaño -- no sirve tal cual como icono de app de Windows).
#
# Se corre una sola vez (python desktop/build/generate_icon.py), el
# resultado se versiona en el repo. No hace falta volver a correrlo
# salvo que cambie el logo fuente.
# ==========================================================

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_ICO = REPO_ROOT / "3DPit.ico"
OUTPUT_ICO = Path(__file__).resolve().parent / "icon.ico"

SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main():

    if not SOURCE_ICO.exists():
        raise SystemExit(f"No se encontró {SOURCE_ICO}")

    img = Image.open(SOURCE_ICO).convert("RGBA")
    print(f"Fuente: {SOURCE_ICO} ({img.width}x{img.height}px)")

    # 3DPit.ico es un banner de 82x31 (no cuadrado) -- se centra sobre
    # un lienzo cuadrado transparente (lado = el mayor de los dos) en
    # vez de estirar/deformar la imagen. Se acepta la pérdida de
    # nitidez al escalar desde una fuente tan chica -- ya charlado con
    # el usuario, no hay un logo de mayor resolución disponible.
    src_size = max(img.width, img.height)
    canvas = Image.new("RGBA", (src_size, src_size), (0, 0, 0, 0))
    offset = ((src_size - img.width) // 2, (src_size - img.height) // 2)
    canvas.paste(img, offset, img)

    # Pillow's ICO writer no hace upscale solo al pasarle "sizes"
    # mayores al canvas base (los descarta en silencio, confirmado en
    # la práctica: pedí hasta 256 y el .ico resultante solo traía hasta
    # 64) -- se generan las imágenes en cada tamaño A MANO, con buen
    # filtro de resampling, para que el .ico final SÍ tenga las
    # resoluciones grandes que Windows pide (Explorador, accesos
    # directos grandes, etc.).
    frames = [canvas.resize(s, Image.LANCZOS) for s in SIZES]
    frames[-1].save(OUTPUT_ICO, format="ICO", sizes=SIZES, append_images=frames[:-1])
    print(f"Generado: {OUTPUT_ICO} ({OUTPUT_ICO.stat().st_size} bytes, {len(SIZES)} tamaños)")


if __name__ == "__main__":
    main()
