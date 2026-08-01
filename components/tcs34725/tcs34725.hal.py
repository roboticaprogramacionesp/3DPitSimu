# =============================================================
# PitSimulator — HAL TCS34725 (sensor de color RGB + clear, I2C)
#
# Mismo criterio que mpu6050.hal.py: en vez de reemplazar una
# librería Python puntual (el usuario pegó un "import tcs34725" con
# su propia clase TCS34725, cuyo código fuente no tenemos -- solo su
# forma de uso), se emula el MAPA DE REGISTROS REAL del chip (fijo
# por datasheet AMS/ScioSense, igual para CUALQUIER librería que
# hable con un TCS34725 de verdad) contra el bus I2C compartido
# (_i2c_bus.py). Dirección FIJA 0x29 (sin pin ADDR, como el BMP180).
#
# ── Mapa de registros que se simula ─────────────────────────────
#   0x12  ID       -- siempre 0x44 (TCS34725/TCS34721 real)
#   0x13  STATUS   -- bit0 (AVALID) siempre en 1: "hay una lectura
#                     lista", ya que acá no hay integración real que
#                     esperar
#   0x14-0x15  CDATA (clear, low/high, little-endian)
#   0x16-0x17  RDATA (rojo)
#   0x18-0x19  GDATA (verde)
#   0x1A-0x1B  BDATA (azul)
#   cualquier otro registro (ENABLE, ATIME, CONTROL/gain, etc.):
#   se acepta cualquier escritura y se ignora, lectura siempre 0x00
#   -- no modelamos tiempos de integración/ganancia, siempre se
#   reporta el color "ya integrado" que eligió el panel.
#
# El byte de comando real de este chip (bit 0x80, más 0x20 de
# auto-incremento) va OR-eado en el mismo argumento "memaddr" de
# readfrom_mem/writeto_mem -- por eso acá se enmascara con & 0x1F
# antes de comparar contra la tabla de arriba, sin importar qué
# combinación exacta de bits de comando use la librería del usuario.
#
# ── Protocolo de entrada: "TCS:" ─────────────────────────────────
# El simulador manda, cada vez que cambia el color en el panel:
#   TCS:<addr>:<r_u16>:<g_u16>:<b_u16>:<c_u16>
# ejemplo: TCS:41:20000:5000:3000:28000  (41 = 0x29 en decimal)
# "última muestra gana" por dirección, igual que mpu6050.hal.py/
# bh1750.hal.py.
# =============================================================

import struct as _struct

TCS34725_ADDR = 0x29

_tcs_state = {}  # addr -> (r_u16, g_u16, b_u16, c_u16)

# Default antes de la primera actualización real del panel: un gris
# neutro tenue, ni "negro total" (que parecería sensor tapado) ni
# saturado.
_TCS_DEFAULT = (8000, 8000, 8000, 24000)


def _on_tcs_line(parts):
    # parts = ["TCS", "<addr>", "<r>", "<g>", "<b>", "<c>"]
    if len(parts) < 6:
        return
    try:
        addr = int(parts[1])
        values = tuple(int(p) for p in parts[2:6])
    except ValueError:
        return
    _tcs_state[addr] = values


register_line_handler("TCS:", _on_tcs_line)


def _channel_bytes(addr):
    r, g, b, c = _tcs_state.get(addr, _TCS_DEFAULT)
    # Orden real del chip: CDATA, RDATA, GDATA, BDATA (0x14..0x1B),
    # cada uno 16 bits little-endian.
    return _struct.pack("<HHHH", c, r, g, b)


def _make_read_mem(addr):
    def _on_read_mem(reg, nbytes):
        base_reg = reg & 0x1F

        if base_reg == 0x12:
            return bytes([0x44] * nbytes)

        if base_reg == 0x13:
            return bytes([0x01] * nbytes)

        if 0x14 <= base_reg <= 0x1B:
            data = _channel_bytes(addr)
            start = base_reg - 0x14
            padded = data + bytes(nbytes)
            return padded[start : start + nbytes]

        return bytes(nbytes)

    return _on_read_mem


def _on_write_mem(reg, buf):
    # ENABLE (encender/PON+AEN), ATIME (tiempo de integración),
    # CONTROL (ganancia), etc: se acepta y se ignora -- este
    # simulador siempre responde con el color ya "integrado" que
    # eligió el panel, sin modelar tiempos de espera reales.
    pass


register_i2c_device(TCS34725_ADDR, on_read_mem=_make_read_mem(TCS34725_ADDR), on_write_mem=_on_write_mem)
