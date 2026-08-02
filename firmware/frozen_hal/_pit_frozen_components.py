# =============================================================
# PitSimulator — lista de tipos de componente con HAL congelado.
#
# Generado por build_components.js -- NO EDITAR A MANO. Este lado
# Python es solo un frozenset INERTE (ver más abajo) -- la lista
# que ReplPanel.js usa en el navegador para decidir "import
# _pit_hal_<tipo>" vs. paste completo vive en js/simulator/
# FrozenHalTypes.js (generado ACÁ MISMO, ver JS_MANIFEST_OUT), no
# se sondea el firmware conectado en tiempo real (eso se abandonó:
# era una sonda con timeout, propensa a carreras -- ver
# project_frozen_probe_timeout_fix.md). Si el import falla porque
# el firmware conectado en verdad NO lo tiene (versión vieja),
# ReplPanel.js cae solo al paste completo para ESE tipo (ver
# el listener de "qemu:hal-error").
#
# Módulo INERTE a propósito -- solo este frozenset, nada más -- se
# importa incondicionalmente en boot.py (ver boot_snippet.py), sin
# ningún riesgo de colisión. Los módulos de componente en sí
# (components/_pit_hal_*.py) NO se importan acá ni en boot.py --
# varios comparten dirección I2C por defecto (ej. bmp180/bmp280 en
# 0x77, ds3231/mpu6050 en 0x68) y solo tiene sentido cargar el HAL
# de lo que el proyecto ACTUAL tiene realmente en el canvas --
# ReplPanel.js sigue decidiendo eso, igual que en el camino
# pasteado de siempre.
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
