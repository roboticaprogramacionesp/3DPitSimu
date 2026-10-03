# Matriz de NeoPixel 8x8 -- texto fijo + texto con scroll (ezFBmarquee)
#
# Puntos importantes para que el texto se vea bien:
#   1. El color del texto (fg) tiene que ser DISTINTO al color de
#      fondo (bg) -- si son iguales, el texto queda invisible (se
#      "pinta" con el mismo color que ya tenía el fondo debajo).
#   2. .text() usa la fuente GRANDE que trae framebuf (8x8 por
#      caracter) -- en una matriz de 8 columnas, UN SOLO caracter ya
#      ocupa el ancho entero, así que con .text() no entra más de una
#      letra por vez. Para texto más largo, usar ezFBmarquee (fuente
#      chica 4x6 + scroll), como se ve más abajo.
#   3. brightness muy bajo (ej. 0.2) se ve MUY oscuro -- para probar
#      que algo funciona, conviene arrancar con brightness alto (1.0)
#      y bajarlo después si hace falta.

from np import NeoMatrix
from time import sleep
from ezFBmarquee import ezFBmarquee
import ezFBfont_4x6_latin_06 as font


def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


matrix = NeoMatrix(12, 8, 8, layout=0, rotation=0)

# --- Paso 1: un caracter fijo con .text() (fuente grande, 8x8) ---
# Fondo azul oscuro, texto amarillo -- bien distinguibles.
matrix.fill(rgb565(0, 0, 40))
matrix.text("H", 0, 0, rgb565(255, 255, 0))
matrix.show(brightness=1.0)
sleep(2)

# --- Paso 2: texto largo con scroll (ezFBmarquee, fuente chica) ---
matrix.fill(0)
marquee = ezFBmarquee(
    display=matrix,
    font=font,
    x=0,
    y=1,
    width=matrix.width,
    fg=rgb565(255, 80, 0),   # naranja -- distinto del fondo negro
    bg=0x0000,
    move="left",
)
marquee.start("Hola!")

while True:
    marquee.step()
    matrix.show(brightness=1.0)
    sleep(0.1)
