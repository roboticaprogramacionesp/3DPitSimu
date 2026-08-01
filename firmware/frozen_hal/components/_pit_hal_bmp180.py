# =============================================================
# PitSimulator — HAL "bmp180" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/bmp180/bmp180.hal.py -- NO EDITAR A MANO. Cualquier
# cambio real va en el .hal.py original; después correr
# "node firmware/frozen_hal/build_components.js" de nuevo y
# recompilar el firmware (ver firmware/frozen_hal/README.md).
#
# Único agregado real respecto al original: el/los import(s) de
# abajo -- ver el comentario grande en build_components.js sobre
# por qué hacen falta (namespace propio de módulo vs. exec() en
# el namespace global del REPL, que es como corre hoy pasteado).
# =============================================================

from _pit_base import register_line_handler
from _pit_i2c_bus import I2C, register_i2c_device

# =============================================================
# PitSimulator — HAL BMP180 (presión barométrica + temperatura, I2C)
#
# A diferencia del BH1750 (sin registros) y como el MPU6050 (mapa de
# registros real vía readfrom_mem/writeto_mem), el BMP180 tiene:
#   - 0xD0            Chip ID (siempre 0x55)
#   - 0xAA..0xBF       22 bytes de calibración de fábrica (11 valores
#                      de 16 bits, algunos con signo, ver datasheet)
#   - 0xF4             Registro de control (qué medir + oversampling)
#   - 0xF6/0xF7/0xF8   Resultado (MSB/LSB/XLSB)
#
# Cualquier librería bmp180.py real hace, en esencia:
#   1. Lee los 22 bytes de calibración UNA vez al construirse.
#   2. Para temperatura:  writeto_mem(addr, 0xF4, b'\x2E')
#                         (esperar ~4.5ms) -> readfrom_mem(addr, 0xF6, 2)
#   3. Para presión:      writeto_mem(addr, 0xF4, bytes([0x34 | (oss<<6)]))
#                         (esperar según oss) -> readfrom_mem(addr, 0xF6, 3)
#   4. Aplica las fórmulas de compensación del datasheet de Bosch
#      (con las 11 constantes de calibración) para convertir el
#      valor crudo (UT/UP) a °C / Pa reales.
#
# ── La estrategia de este HAL ─────────────────────────────────────
# En vez de intentar "engañar" un chip con física realista, se
# usan constantes de calibración ELEGIDAS por este simulador (no las
# de ningún chip real) que hacen que la fórmula de compensación de
# Bosch se pueda INVERTIR fácilmente:
#   - AC1=AC2=AC3=B1=B2=0  y  MC=0  →  eliminan casi todos los
#     términos cruzados de las fórmulas de temperatura y presión,
#     dejando relaciones directas (lineales) entre UT/UP y °C/Pa.
#   - MD=20000 (bien lejos del rango real de X1) evita división por
#     cero en la fórmula de temperatura (que sigue calculando
#     MC*2048/(X1+MD) aunque el resultado sea 0 -- la división en sí
#     no debe romperse).
#   - Queda un término de corrección final en la fórmula de presión
#     (el ajuste "X1/X2/3791" del datasheet) que NO se invierte --
#     su magnitud es de decenas de Pa sobre ~100000 Pa (<0.3% de
#     error), imperceptible para cualquier uso educativo.
# Esto es autoconsistente: cualquier librería real que implemente
# el algoritmo estándar de Bosch (son casi todas iguales) va a
# devolver el °C/Pa que este HAL le pidió mostrar, con ese margen de
# error mínimo.
#
# ── Rango soportado ────────────────────────────────────────────
# Temperatura: -40°C a 85°C (rango del datasheet real).
# Presión: 30000-110000 Pa (300-1100 hPa, rango del datasheet real
# -- MUY por fuera de esto puede desbordar el empaquetado de 3 bytes
# con oversampling alto, por eso el panel no deja pasarse).
#
# ── Protocolo de entrada: "BMP180:" ───────────────────────────────
#   BMP180:<addr>:<temp_c>:<pressure_pa>
# ejemplo: BMP180:119:22.5:101325.0   (119 decimal = 0x77, dirección
# fija del BMP180 real -- a diferencia del BH1750/MPU6050, no tiene
# pin ADDR).
# =============================================================

import struct as _struct

_BMP_ADDR = 0x77

_bmp_state = {}  # addr -> (temp_c, pressure_pa)
_bmp_mode = {}   # addr -> ("temp"|"pressure", oss)
_bmp_ctrl = {}   # addr -> último byte crudo escrito en 0xF4

_BMP_DEFAULT = (22.0, 101325.0)

# Constantes de calibración ELEGIDAS (no son de ningún chip real,
# ver comentario grande arriba).
_AC1, _AC2, _AC3 = 0, 0, 0
_AC4 = 59500
_AC5 = 32757
_AC6 = 23153
_B1, _B2 = 0, 0
_MB = -32768
_MC = 0
_MD = 20000


def _on_bmp180_line(parts):
    # parts = ["BMP180", "<addr>", "<temp_c>", "<pressure_pa>"]
    if len(parts) < 4:
        return
    try:
        addr = int(parts[1])
        temp_c = float(parts[2])
        pressure_pa = float(parts[3])
    except ValueError:
        return
    _bmp_state[addr] = (temp_c, pressure_pa)


register_line_handler("BMP180:", _on_bmp180_line)


def _calib_bytes():
    return _struct.pack(
        ">hhhHHHhhhhh",
        _AC1, _AC2, _AC3, _AC4, _AC5, _AC6, _B1, _B2, _MB, _MC, _MD,
    )


def _compute_ut(temp_c):
    """
    Inversa de la fórmula de temperatura de Bosch con MC=0 (así
    B5=X1 exacto, sin el término no lineal): X1=(UT-AC6)*AC5/32768,
    T=(X1+8)>>4 en décimos de °C.
    """
    t_raw = int(round(temp_c * 10))
    x1 = t_raw * 16
    ut = _AC6 + int(x1 * 32768 / _AC5)
    return max(0, min(65535, ut))


def _compute_up(pressure_pa, oss):
    """
    Inversa (parcial -- ver comentario grande arriba sobre el
    término de corrección final que se ignora) de la fórmula de
    presión de Bosch con AC1=AC2=AC3=B1=B2=0: B3=AC1, B4=AC4,
    p=(B7*2)/B4 con B7=(UP-B3)*(50000>>oss).
    """
    b3 = _AC1
    b4 = _AC4
    p_raw = int(round(pressure_pa))
    if p_raw < 1:
        p_raw = 1

    b7_target = int(p_raw * b4 / 2)
    denom = 50000 >> oss
    up = int(b7_target / denom) + b3

    # Tope real: UP<<(8-oss) tiene que entrar en 3 bytes (24 bits).
    max_up = 0xFFFFFF >> (8 - oss)
    if up < 0:
        up = 0
    if up > max_up:
        up = max_up
    return up


def _make_on_write_mem(addr):
    def _on_write_mem(reg, buf):
        if reg == 0xF4 and buf:
            cmd = buf[0]
            _bmp_ctrl[addr] = cmd
            if cmd == 0x2E:
                _bmp_mode[addr] = ("temp", 0)
            elif (cmd & 0x0F) == 0x04:
                # 0x34 | (oss<<6): bits 6-7 = oversampling, bits 0-3
                # siempre 0x4 sea cual sea el oss.
                oss = (cmd >> 6) & 0x03
                _bmp_mode[addr] = ("pressure", oss)
    return _on_write_mem


def _make_on_read_mem(addr):
    def _on_read_mem(reg, nbytes):
        if reg == 0xD0:
            return bytes([0x55] * nbytes)

        if 0xAA <= reg <= 0xBF:
            base = _calib_bytes()
            start = reg - 0xAA
            padded = base + bytes(nbytes)
            return padded[start : start + nbytes]

        if reg == 0xF4:
            # Bit 5 (SCO, "conversión en curso") siempre en 0 --
            # librerías que hacen polling de este bit en vez de un
            # sleep fijo ven "listo" de inmediato, no modelamos el
            # tiempo real de conversión (mismo criterio que
            # mpu6050.hal.py con PWR_MGMT_1).
            ctrl = _bmp_ctrl.get(addr, 0) & ~0x20
            return bytes([ctrl] * nbytes)

        if reg in (0xF6, 0xF7, 0xF8):
            temp_c, pressure_pa = _bmp_state.get(addr, _BMP_DEFAULT)
            mode, oss = _bmp_mode.get(addr, ("temp", 0))

            if mode == "pressure":
                up = _compute_up(pressure_pa, oss)
                shifted = up << (8 - oss)
                result = bytes(
                    [(shifted >> 16) & 0xFF, (shifted >> 8) & 0xFF, shifted & 0xFF]
                )
            else:
                ut = _compute_ut(temp_c)
                result = bytes([(ut >> 8) & 0xFF, ut & 0xFF, 0x00])

            start = reg - 0xF6
            padded = result + bytes(nbytes)
            return padded[start : start + nbytes]

        return bytes(nbytes)

    return _on_read_mem


register_i2c_device(
    _BMP_ADDR,
    on_write_mem=_make_on_write_mem(_BMP_ADDR),
    on_read_mem=_make_on_read_mem(_BMP_ADDR),
)
