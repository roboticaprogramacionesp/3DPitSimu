# =============================================================
# PitSimulator — Bus I2C compartido para el runtime WASM
#
# Equivalente a components/_i2c_bus/_i2c_bus.hal.py, mismo contrato
# público (register_i2c_device, class I2C) para que los .hal.py de
# componente I2C existentes (bh1750, mpu6050, etc.) puedan portarse
# con cambios mínimos -- ver el plan en curso, Fase 1/3.
#
# Diferencia real respecto al original: no hay "machine" module acá
# (ver _base_wasm.py) así que no hace falta "machine.I2C = I2C" al
# final -- el .hal.py de cada componente construye I2C() directo
# (nombre ya global en el mismo namespace, ejecutado después de este
# archivo).
#
# Mismo protocolo de texto (I2CW:<addr>:<value>) que el original --
# hoy nada del lado JS reacciona a I2CW: mas que loguearlo (no hay
# visualización específica todavía), se mantiene por si hace falta
# más adelante y para no divergir del contrato real.
# =============================================================

import sys

_known_addrs = set()
_devices = {}
_i2c_reg_out = {}
_i2c_reg_in = {}


def register_i2c_device(address, on_write=None, on_read=None, on_read_mem=None, on_write_mem=None, on_write_buf=None):
    _known_addrs.add(address)
    _devices[address] = {
        "on_write": on_write,
        "on_read": on_read,
        "on_read_mem": on_read_mem,
        "on_write_mem": on_write_mem,
        "on_write_buf": on_write_buf,
    }


class I2C:

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def start(self):
        pass

    def stop(self):
        pass

    def writeto(self, addr, buf, stop=True):
        if not buf:
            return
        value = buf[0]

        device = _devices.get(addr)

        if device and device.get("on_write_buf"):
            device["on_write_buf"](bytes(buf))

        if _i2c_reg_out.get(addr) != value:
            _i2c_reg_out[addr] = value
            if device and device.get("on_write"):
                device["on_write"](value)
            sys.stdout.write("I2CW:%d:%d\n" % (addr, value))

    def readfrom(self, addr, nbytes, stop=True):
        device = _devices.get(addr)
        if device and device.get("on_read"):
            value = device["on_read"]()
            if isinstance(value, (bytes, bytearray)):
                data = bytes(value)
                if len(data) < nbytes:
                    data = data + bytes(nbytes - len(data))
                return data[:nbytes]
            return bytes([value] * nbytes)
        value = _i2c_reg_in.get(addr, 0xFF)
        return bytes([value] * nbytes)

    def readfrom_into(self, addr, buf, stop=True):
        data = self.readfrom(addr, len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]

    def readfrom_mem(self, addr, memaddr, nbytes, addrsize=8):
        device = _devices.get(addr)
        if device and device.get("on_read_mem"):
            return device["on_read_mem"](memaddr, nbytes)
        if device and device.get("on_read"):
            value = device["on_read"]()
        else:
            value = _i2c_reg_in.get(addr, 0xFF)
        return bytes([value] * nbytes)

    def readfrom_mem_into(self, addr, memaddr, buf, addrsize=8):
        data = self.readfrom_mem(addr, memaddr, len(buf), addrsize=addrsize)
        for i in range(len(buf)):
            buf[i] = data[i]

    def writeto_mem(self, addr, memaddr, buf, addrsize=8):
        device = _devices.get(addr)
        if device and device.get("on_write_mem"):
            device["on_write_mem"](memaddr, bytes(buf))

    def scan(self):
        return sorted(set(_i2c_reg_out.keys()) | set(_i2c_reg_in.keys()) | _known_addrs)


SoftI2C = I2C

# Se agrega al MISMO módulo "machine" falso que ya armó _base_wasm.py
# (cargado siempre antes que este archivo) -- no se pisa el objeto,
# solo se le suman estos dos nombres, igual que
# "_machine_module.I2C = I2C" en _i2c_bus.hal.py real.
import sys
machine = sys.modules["machine"]
machine.I2C = I2C
machine.SoftI2C = SoftI2C
