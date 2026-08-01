# =============================================================
# PitSimulator — lista de tipos de componente con HAL congelado.
#
# Generado por build_components.js -- NO EDITAR A MANO. ReplPanel.js
# lo lee vía un probe de una línea al conectar (ver
# _resyncHalAfterBoot()/FROZEN_PROBE_MARK) para saber, tipo por
# tipo, si puede mandar "import _pit_hal_<tipo>" (rápido) en vez de
# pastear el .hal.py completo por paste-mode (lento).
#
# Módulo INERTE a propósito -- solo este frozenset, nada más -- se
# importa incondicionalmente en boot.py (ver boot_snippet.py), sin
# ningún riesgo de colisión. Los módulos de componente en sí
# (components/_pit_hal_*.py) NO se importan acá ni en boot.py --
# varios comparten dirección I2C por defecto (ej. bmp180/bmp280 en
# 0x77, ds3231/mpu6050 en 0x68) y solo tiene sentido cargar el HAL
# de lo que el proyecto ACTUAL tiene realmente en el canvas --
# ReplPanel.js sigue decidiendo eso, igual que en el camino
# pasteado de siempre, con este frozenset solo como "menú" de qué
# puede pedir por import en vez de por paste.
# =============================================================

FROZEN_TYPES = frozenset([
    "adkey",
    "adkey_real",
    "bh1750",
    "bmp180",
    "bmp280",
    "buzzer",
    "dht11",
    "ds3231",
    "hcsr04",
    "ky-009",
    "ky-011",
    "ky-016",
    "ky_001",
    "lcd16x2",
    "lcd_16x2_i2c",
    "max7219",
    "mpu6050",
    "neopixel_matrix",
    "neopixel_ring",
    "oled",
    "qmc5883l",
    "rc522",
    "rc522_real",
    "sg90",
    "tcs34725",
    "tft_st7789",
    "tm1637",
])
