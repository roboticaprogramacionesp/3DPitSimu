# =============================================================
# PitSimulator — HAL "qmc5883l" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/qmc5883l/qmc5883l.hal.py -- NO EDITAR A MANO. Cualquier
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
# PitSimulator — HAL QMC5883L (magnetómetro/brújula, I2C)
#
# Construido y verificado contra el archivo qmc5883l.py REAL que usa
# este proyecto (pegado por el usuario). A diferencia de mpu6050.hal.py
# /tcs34725.hal.py (que usan readfrom_mem/writeto_mem, la API "limpia"
# de MicroPython para chips con mapa de registros), ESTE driver arma
# su propio protocolo de registro a mano:
#
#   def i2c_writereg(self, regAddr, buff):
#       self.i2c.writeto(self.slvAddr, bytes([regAddr]) + buff)
#
#   def i2c_readregs(self, regAddr, bytenum):
#       self.i2c.writeto(self.slvAddr, bytes([regAddr]))
#       return self.i2c.readfrom(self.slvAddr, bytenum)
#
# Es decir: un writeto() con [registro]+[datos] para escribir, y un
# writeto() con SOLO [registro] seguido de un readfrom() aparte para
# leer -- ninguno de los dos pasa por writeto_mem()/readfrom_mem().
# Por eso este HAL usa el hook nuevo on_write_buf(buf) de
# _i2c_bus.py (ver su docstring) en vez de on_write_mem: recibe el
# buffer COMPLETO tal cual, guarda el primer byte como "último
# registro seleccionado", y on_read() (sin argumentos, porque
# readfrom() no lleva número de registro) responde según ESE estado.
#
# ── Direcciones cubiertas ────────────────────────────────────────
# 0x2C (default de este driver real) y 0x0D (el default más común en
# otros forks/librerías de QMC5883L/HMC5883L que circulan online) --
# mismo criterio que mpu6050.hal.py cubriendo 0x68 Y 0x69 sin saber
# de antemano cuál usará el código del usuario.
#
# ── Mapa de registros que se simula ──────────────────────────────
#   0x00-0x05  X_L,X_H,Y_L,Y_H,Z_L,Z_H (16 bits con signo, LE, cada
#              uno) -- el driver real lee 6 bytes arrancando en 0x01
#              (offset real del chip: 0x00 es "info", los datos
#              arrancan en 0x01), se respeta ese offset acá también.
#   0x09       STATUS -- bit0 DRDY siempre en 1 (dato listo), bit1
#              OVL siempre en 0 (nunca "fuera de rango") para que el
#              __init__ real (que hace polling de estos bits) salga
#              del loop en la primera vuelta sin importar timing.
#   Cualquier otra escritura (soft reset 0x0B, definición de signo
#   0x29, tasa/ganancia 0x0A): se acepta y se ignora -- este
#   simulador siempre reporta el heading que eligió el panel, sin
#   modelar rangos/ganancias reales.
#
# ── Protocolo de entrada: "MAG:" ─────────────────────────────────
# El simulador manda, cada vez que cambia el heading en el panel:
#   MAG:<addr>:<x_s16>:<y_s16>:<z_s16>
# ejemplo: MAG:44:2000:0:400  (44 = 0x2C en decimal)
# =============================================================

import struct as _struct

QMC5883_ADDRS = (0x2C, 0x0D)

_mag_state = {}      # addr -> (x, y, z) enteros con signo (16 bits)
_last_reg = {}        # addr -> último registro seleccionado por writeto()

_MAG_DEFAULT = (2000, 0, 400)  # heading 0° por defecto


def _on_mag_line(parts):
    # parts = ["MAG", "<addr>", "<x>", "<y>", "<z>"]
    if len(parts) < 5:
        return
    try:
        addr = int(parts[1])
        x = int(parts[2])
        y = int(parts[3])
        z = int(parts[4])
    except ValueError:
        return
    _mag_state[addr] = (x, y, z)


register_line_handler("MAG:", _on_mag_line)


def _make_write_buf(addr):
    def _on_write_buf(buf):
        if not buf:
            return
        _last_reg[addr] = buf[0]
        # buf[1:] (reset/signo/ganancia/tasa): se ignora a propósito,
        # ver comentario grande arriba.
    return _on_write_buf


def _make_read(addr):
    def _on_read():
        reg = _last_reg.get(addr)

        if reg == 0x09:
            return 0x01  # DRDY=1, OVL=0

        if reg == 0x01 or reg == 0x00:
            x, y, z = _mag_state.get(addr, _MAG_DEFAULT)
            data = _struct.pack("<3h", x, y, z)
            # El driver real siempre pide exactamente 6 bytes
            # arrancando en 0x01 -- si algún código pidiera desde
            # 0x00 (1 byte de offset), igual devolvemos el bloque
            # completo, ya truncado/paddeado por readfrom() del lado
            # del bus compartido según nbytes pedido.
            return data

        return 0x00

    return _on_read


for _addr in QMC5883_ADDRS:
    register_i2c_device(_addr, on_read=_make_read(_addr), on_write_buf=_make_write_buf(_addr))
