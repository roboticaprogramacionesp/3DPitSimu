# =============================================================
# PitSimulator — HAL BH1750 (sensor de luz ambiental, I2C)
#
# A diferencia del MPU6050 (mapa de registros real, readfrom_mem),
# el BH1750 es un chip "sin registros": cualquier librería bh1750.py
# que ande dando vueltas hace, en esencia, esto:
#
#   i2c.writeto(addr, bytes([0x10]))   # Continuous H-Res Mode (1 lx)
#   time.sleep_ms(180)
#   raw = i2c.readfrom(addr, 2)        # 2 bytes big-endian
#   lux = (raw[0] << 8 | raw[1]) / 1.2
#
# Por eso acá se usa on_read (no on_read_mem): un solo comando de
# modo (byte) configura qué se mide, y la lectura es un readfrom()
# plano de 2 bytes. Esto solo funciona porque _i2c_bus.hal.py ahora
# sabe devolver bytes CRUDOS desde on_read() (antes repetía el mismo
# byte nbytes veces, insuficiente para un valor de 16 bits con 2
# bytes distintos como este).
#
# ── Opcodes que se interpretan (datasheet real) ──────────────────
#   0x01        Power On
#   0x00        Power Down
#   0x07        Reset
#   0x10 / 0x20 Continuous / One-Time H-Res Mode   (1 lx,   factor 1.2)
#   0x11 / 0x21 Continuous / One-Time H-Res Mode 2 (0.5 lx, factor 2.4)
#   0x13 / 0x23 Continuous / One-Time L-Res Mode   (4 lx,   factor 1.2)
# Cualquier otro valor se ignora -- no hace falta modelar el
# consumo/reset real para que el código educativo típico funcione.
#
# ── Protocolo de entrada: "BH1750:" ───────────────────────────────
# El simulador manda, cada vez que cambia el slider de lux del panel:
#   BH1750:<addr>:<lux>
# ejemplo: BH1750:35:500.0   (35 decimal = 0x23)
# "última muestra gana" por dirección, mismo criterio que mpu6050.hal.py.
# =============================================================

_bh_lux = {}    # addr -> lux actual (float)
_bh_mode2 = {}  # addr -> True si el modo activo es "Mode 2" (factor x2)

_BH_DEFAULT_LUX = 200.0  # luz de interior típica


def _on_bh1750_line(parts):
    # parts = ["BH1750", "<addr>", "<lux>"]
    if len(parts) < 3:
        return
    try:
        addr = int(parts[1])
        lux = float(parts[2])
    except ValueError:
        return
    _bh_lux[addr] = lux


register_line_handler("BH1750:", _on_bh1750_line)


def _make_on_write(addr):
    def _on_write(value):
        if value in (0x11, 0x21):
            _bh_mode2[addr] = True
        elif value in (0x10, 0x20, 0x13, 0x23):
            _bh_mode2[addr] = False
        # 0x00/0x01/0x07 y cualquier otro valor: no afectan el
        # factor de conversión.
    return _on_write


def _make_on_read(addr):
    def _on_read():
        lux = _bh_lux.get(addr, _BH_DEFAULT_LUX)
        factor = 2.4 if _bh_mode2.get(addr) else 1.2
        raw = int(round(lux * factor))
        if raw < 0:
            raw = 0
        if raw > 65535:
            raw = 65535
        return bytes([(raw >> 8) & 0xFF, raw & 0xFF])
    return _on_read


for _addr in (0x23, 0x5C):
    register_i2c_device(_addr, on_write=_make_on_write(_addr), on_read=_make_on_read(_addr))
