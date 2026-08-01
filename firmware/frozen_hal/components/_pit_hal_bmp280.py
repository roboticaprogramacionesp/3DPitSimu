# =============================================================
# PitSimulator — HAL "bmp280" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/bmp280/bmp280.hal.py -- NO EDITAR A MANO. Cualquier
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
# PitSimulator — HAL BMP280 (presión barométrica + temperatura, I2C)
#
# Mismo enfoque que bmp180.hal.py (constantes de calibración
# ELEGIDAS por este simulador para poder invertir la fórmula de
# compensación de Bosch), pero con el mapa de registros y la
# fórmula REALES del BMP280 (distintas de las del BMP180):
#
#   - 0xD0            Chip ID (0x58 para BMP280, 0x60 sería BME280)
#   - 0x88..0x9F       24 bytes de calibración, LITTLE-ENDIAN (a
#                      diferencia del BMP180, que es big-endian) --
#                      11 valores de 16 bits: T1(u),T2,T3,P1(u),
#                      P2..P9
#   - 0xE0             Reset (escribir 0xB6)
#   - 0xF3             Status (bit3=measuring, bit0=updating)
#   - 0xF4             Control (power mode + oversampling)
#   - 0xF5             Config (IIR filter + standby)
#   - 0xF7..0xFC       Datos: press MSB/LSB/XLSB, temp MSB/LSB/XLSB
#                      (20 bits cada uno, MISMO ancho sin importar
#                      el oversampling -- a diferencia del BMP180,
#                      acá no hay que desplazar según oss)
#
# ── Constantes de calibración elegidas (no son de ningún chip real) ──
# T3=0 y P2=P3=P4=P5=P6=P7=P8=P9=0 eliminan todos los términos no
# lineales/cruzados de ambas fórmulas, dejando T y P como funciones
# lineales (invertibles a mano) de t_raw/p_raw. T1=22500, T2=12000
# y P1=20000 se eligieron para que t_raw/p_raw se mantengan siempre
# dentro del rango real de 20 bits (0..1048575) en todo el rango del
# datasheet (-40..85°C, 300..1100 hPa) -- verificado con la fórmula
# de compensación REAL (la del datasheet, sin simplificar) en tests
# offline: error de temperatura <0.02°C, error de presión ~0% (la
# simplificación quedó exacta, a diferencia del BMP180 que sí tenía
# un residuo de la corrección final que no se invertía).
#
# ── Protocolo de entrada: "BMP280:" ───────────────────────────────
#   BMP280:<addr>:<temp_c>:<pressure_pa>
# ejemplo: BMP280:118:22.5:101325.0   (118 decimal = 0x76, dirección
# default -- el BMP280 real also soporta 0x77 si el pin SDO se ata a
# VCC en vez de GND, configurable en properties.i2cAddress igual que
# BH1750/MPU6050).
# =============================================================

import struct as _struct

_bmp_state = {}   # addr -> (temp_c, pressure_pa)
_bmp_ctrl = {}     # addr -> último byte escrito en 0xF4
_bmp_config = {}   # addr -> último byte escrito en 0xF5

_BMP_DEFAULT = (22.0, 101325.0)

# Constantes de calibración ELEGIDAS (ver comentario grande arriba).
_T1, _T2, _T3 = 22500, 12000, 0
_P1 = 20000
_P2 = _P3 = _P4 = _P5 = _P6 = _P7 = _P8 = _P9 = 0


def _on_bmp280_line(parts):
    # parts = ["BMP280", "<addr>", "<temp_c>", "<pressure_pa>"]
    if len(parts) < 4:
        return
    try:
        addr = int(parts[1])
        temp_c = float(parts[2])
        pressure_pa = float(parts[3])
    except ValueError:
        return
    _bmp_state[addr] = (temp_c, pressure_pa)


register_line_handler("BMP280:", _on_bmp280_line)


def _calib_bytes():
    # Little-endian, a diferencia del BMP180 -- orden real del
    # datasheet: T1(u16),T2,T3,P1(u16),P2..P9 (todos h salvo T1/P1).
    return _struct.pack(
        "<HhhHhhhhhhh",
        _T1, _T2, _T3, _P1, _P2, _P3, _P4, _P5, _P6, _P7, _P8,
    ) + _struct.pack("<h", _P9)


def _compute_t_raw(temp_c):
    """
    Inversa de la fórmula de temperatura con T3=0 (var2=0, t_fine=var1):
    var1 = ((t_raw>>3) - (T1<<1)) * T2 >> 11 ; T = ((t_fine*5+128)>>8)/100
    """
    t_hundredths = int(round(temp_c * 100))
    t_fine = int(round((t_hundredths * 256 - 128) / 5))
    x = int(round(t_fine * 2048 / _T2))
    t_raw = ((_T1 * 2) + x) * 8
    return max(0, min(0xFFFFF, t_raw))


def _compute_p_raw(pressure_pa):
    """
    Inversa de la fórmula de presión con P2=P3=P4=P5=P6=P7=P8=P9=0
    (var2=0, y el divisor ((1<<47)*P1)>>33 se simplifica a P1*16384
    exacto): p = ((p_pre<<31))*3125/(P1*16384) ; pressure=(p>>8)/256
    """
    b_div = _P1 * 16384
    p_target = pressure_pa * 65536.0
    p_pre = p_target * b_div / 3125.0 / (1 << 31)
    p_raw = 1048576 - int(round(p_pre))
    return max(0, min(0xFFFFF, p_raw))


def _make_on_write_mem(addr):
    def _on_write_mem(reg, buf):
        if not buf:
            return
        if reg == 0xF4:
            _bmp_ctrl[addr] = buf[0]
        elif reg == 0xF5:
            _bmp_config[addr] = buf[0]
        # 0xE0 (reset): se acepta y se ignora -- no hace falta
        # modelar el reset real para que el código educativo típico
        # funcione.
    return _on_write_mem


def _make_on_read_mem(addr):
    def _on_read_mem(reg, nbytes):
        if reg == 0xD0:
            return bytes([0x58] * nbytes)

        if 0x88 <= reg <= 0x9F:
            base = _calib_bytes()
            start = reg - 0x88
            padded = base + bytes(nbytes)
            return padded[start : start + nbytes]

        if reg == 0xF3:
            # Status: siempre "listo" (bit3 measuring=0, bit0
            # updating=0) -- no modelamos el tiempo real de
            # conversión, mismo criterio que bmp180.hal.py.
            return bytes(nbytes)

        if reg == 0xF4:
            return bytes([_bmp_ctrl.get(addr, 0)] * nbytes)

        if reg == 0xF5:
            return bytes([_bmp_config.get(addr, 0)] * nbytes)

        if 0xF7 <= reg <= 0xFC:
            temp_c, pressure_pa = _bmp_state.get(addr, _BMP_DEFAULT)
            p_raw = _compute_p_raw(pressure_pa)
            t_raw = _compute_t_raw(temp_c)

            result = bytes([
                (p_raw >> 12) & 0xFF, (p_raw >> 4) & 0xFF, (p_raw << 4) & 0xFF,
                (t_raw >> 12) & 0xFF, (t_raw >> 4) & 0xFF, (t_raw << 4) & 0xFF,
            ])

            start = reg - 0xF7
            padded = result + bytes(nbytes)
            return padded[start : start + nbytes]

        return bytes(nbytes)

    return _on_read_mem


for _addr in (0x76, 0x77):
    register_i2c_device(
        _addr,
        on_write_mem=_make_on_write_mem(_addr),
        on_read_mem=_make_on_read_mem(_addr),
    )
