# =============================================================
# PitSimulator — HAL MPU6050 (acelerómetro + giroscopio + temp)
#
# A diferencia de hcsr04_hal.py/lcd_16x2_i2c_hal.py, ESTE archivo
# no reemplaza ninguna librería de MicroPython importable (no hay
# un "from mpu6050 import MPU6050" universal -- cada quien usa la
# suya, o pega el código a mano). Lo único verdaderamente común
# entre TODAS esas variantes es que, tarde o temprano, llaman a
#   i2c.readfrom_mem(0x68, 0x3B, 14)
# (o algún subconjunto de esos registros) sobre un machine.I2C real
# -- ESE es el punto de enganche, no una clase Python. Por eso este
# HAL no define ningún módulo nuevo ni toca sys.modules: solo se
# registra contra el bus I2C compartido (_i2c_bus.py) para las dos
# direcciones posibles del MPU6050 (0x68 con AD0 a GND, que es el
# 99% de los breakouts; 0x69 con AD0 a 3.3V).
#
# ── Mapa de registros que se simula (datasheet real) ────────────
#   0x3B..0x40  ACCEL_XOUT_H/L, ACCEL_YOUT_H/L, ACCEL_ZOUT_H/L
#   0x41..0x42  TEMP_OUT_H/L
#   0x43..0x48  GYRO_XOUT_H/L,  GYRO_YOUT_H/L,  GYRO_ZOUT_H/L
#   0x75        WHO_AM_I (siempre 0x68, sea cual sea la dirección
#               real del bus -- así es el chip de verdad)
# Cualquier otro registro leído devuelve 0x00 (ej. PWR_MGMT_1 en
# reposo); cualquier escritura (wake-up, configuración de rango,
# etc.) se acepta y se ignora -- este simulador no modela distintos
# full-scale range, siempre usa ±2g / ±250°/s (los defaults de
# fábrica del chip), que es lo que la enorme mayoría del código
# educativo asume sin cambiar nada.
#
# ── Protocolo de entrada: "MPU:" ─────────────────────────────────
# El simulador manda, cada vez que cambia algún slider del panel:
#   MPU:<addr>:<ax_g>:<ay_g>:<az_g>:<temp_c>:<gx_dps>:<gy_dps>:<gz_dps>
# ejemplo: MPU:104:0.0:0.0:1.0:24.0:0.0:0.0:0.0
# (104 = 0x68 en decimal; el simulador siempre manda la dirección
# en decimal, igual que el resto de los protocolos de este
# proyecto -- ver SignalEngine.js:_notifyMpuToFirmware).
#
# "última muestra gana" por dirección, mismo criterio que
# joystick.hal.py -- no hace falta más que eso: a diferencia del
# encoder, acá no hay que capturar transiciones intermedias, cada
# lectura del firmware simplemente toma el valor MÁS RECIENTE.
# =============================================================

import struct as _struct

_mpu_state = {}  # addr -> (ax_g, ay_g, az_g, temp_c, gx_dps, gy_dps, gz_dps)

# Valores default razonables si todavía no llegó ningún "MPU:" para
# esta dirección (recién armado el circuito, panel sin abrir
# todavía): reposo sobre una mesa -- Z a 1g, resto en 0, temperatura
# ambiente. Evita que el firmware arranque leyendo puro 0 (que
# parecería "caída libre" en los 3 ejes, un estado físicamente raro
# para arrancar).
_MPU_DEFAULT = (0.0, 0.0, 1.0, 24.0, 0.0, 0.0, 0.0)


def _on_mpu_line(parts):
    # parts = ["MPU", "<addr>", "<ax>", "<ay>", "<az>", "<temp>", "<gx>", "<gy>", "<gz>"]
    if len(parts) < 9:
        return
    try:
        addr = int(parts[1])
        values = tuple(float(p) for p in parts[2:9])
    except ValueError:
        return
    _mpu_state[addr] = values


register_line_handler("MPU:", _on_mpu_line)


def _clamp_s16(value):
    if value > 32767:
        return 32767
    if value < -32768:
        return -32768
    return value


def _build_registers(addr):
    """
    Arma los 14 bytes reales (big-endian, con signo, como los
    devuelve el chip de verdad) a partir del último estado
    conocido para esta dirección -- accel en LSB/g = 16384 (rango
    ±2g), gyro en LSB/(°/s) = 131 (rango ±250°/s), temperatura con
    la fórmula del datasheet (Temp = raw/340 + 36.53).
    """
    ax_g, ay_g, az_g, temp_c, gx_dps, gy_dps, gz_dps = _mpu_state.get(
        addr, _MPU_DEFAULT
    )

    accel_raw = [_clamp_s16(int(v * 16384)) for v in (ax_g, ay_g, az_g)]
    temp_raw = _clamp_s16(int((temp_c - 36.53) * 340))
    gyro_raw = [_clamp_s16(int(v * 131)) for v in (gx_dps, gy_dps, gz_dps)]

    values = accel_raw[:3] + [temp_raw] + gyro_raw[:3]
    return _struct.pack(">7h", *values)  # 14 bytes: 7 enteros de 16 bits


def _make_read_mem(addr):
    # Closure por dirección -- así 0x68 y 0x69 (si algún día conviven
    # dos MPU6050 en el mismo canvas) no se pisan entre sí.
    def _on_read_mem(reg, nbytes):
        if reg == 0x75:
            # WHO_AM_I: siempre 0x68, sea cual sea la dirección real
            # del bus (así responde el chip real también).
            return bytes([0x68] * nbytes)

        if 0x3B <= reg <= 0x48:
            base = _build_registers(addr)
            start = reg - 0x3B
            # Padding con ceros por si algún código pide de más
            # (leer más allá de 0x48) -- no debería pasar con
            # librerías reales, pero mejor no tirar IndexError.
            padded = base + bytes(nbytes)
            return padded[start : start + nbytes]

        # Cualquier otro registro (PWR_MGMT_1, CONFIG, rangos, etc.):
        # 0x00 siempre -- consistente con "recién despertado / rango
        # default", que es el estado que asume casi todo el código
        # educativo sin leer estos registros para nada.
        return bytes(nbytes)

    return _on_read_mem


def _on_write_mem(reg, buf):
    # Se acepta y se ignora cualquier escritura (wake-up de
    # PWR_MGMT_1, cambio de rango, reset, etc.) -- este simulador
    # siempre responde con ±2g/±250°/s sin importar qué configure
    # el firmware. Si en algún momento hace falta modelar rangos de
    # verdad, acá es donde engancharía.
    pass


for _addr in (0x68, 0x69):
    register_i2c_device(_addr, on_read_mem=_make_read_mem(_addr), on_write_mem=_on_write_mem)
