# =============================================================
# PitSimulator — Bus I2C compartido (dummy)
#
# Se inyecta UNA sola vez, junto con _base_hal.py, siempre ANTES
# que cualquier hal.py de componente I2C (LCD, OLED, teclado I2C,
# el que venga después).
#
# ── Por qué existe este archivo ─────────────────────────────────
# Hasta ahora, cada hal.py de componente I2C (lcd_16x2_i2c_hal.py,
# keypad4x4_i2c_hal.py, y presumiblemente oled_hal.py) traía SU
# PROPIA copia de esta misma clase "I2C", y todos hacían
# "machine.I2C = I2C" al cargar -- el que se inyecta último gana
# esa asignación. Andaba porque el estado vivía en sys.modules
# (compartido entre copias), pero cada copia eran ~70 líneas que
# había que mantener bit-a-bit idénticas a mano para siempre -- el
# día que alguien arregle un bug en una copia (ej. un cambio en
# _settle(), o en el formato de "I2CW:") y se olvide de replicarlo
# en las otras dos, quedan comportamientos inconsistentes según
# cuál componente haya sido el último en cargar. Acá vive UNA sola
# vez -- los hal.py de componente dejan de traer su propia clase
# I2C y en cambio se REGISTRAN contra esta con
# register_i2c_device().
#
# ── Qué sigue igual que antes ───────────────────────────────────
# El protocolo por texto no cambia (I2CW:/I2CR:, PININFO:i2c:...) --
# esto es un refactor interno, no un cambio de protocolo. Todo lo
# que ya haga QemuBridge.js/SignalEngine.js del lado del navegador
# sigue funcionando sin tocar nada ahí.
# =============================================================

import sys as _sys

# Direcciones "conocidas" (declaradas por algún componente al
# construirse, ej. I2cLcd(i2c_addr=0x27)), para que scan() las vea
# aunque todavía no se haya escrito/leído nada.
_known_addrs = set()

# { addr: {"on_write": callback|None, "on_read": callback|None} }
# Registrado por cada componente I2C vía register_i2c_device().
_devices = {}


def _i2c_registry():
    state = _sys.modules.setdefault("_pit_state", {})
    return state.setdefault("i2c_registry", {"out": {}, "in": {}})


def register_i2c_device(address, on_write=None, on_read=None, on_read_mem=None, on_write_mem=None, on_write_buf=None):
    """
    Llamado por el hal.py de CADA componente I2C (LCD, teclado,
    OLED, el que venga) para anunciar "esta dirección me
    pertenece" -- en vez de pelear por "machine.I2C = I2C", que ya
    lo hizo este archivo una sola vez, al final.

    on_write(value): opcional. Se llama con cada byte escrito a
    esta dirección (ADEMÁS de guardarse en el registro común, por
    si algo más lee por readfrom() genérico). Usalo si tu
    componente necesita reaccionar directo en Python (ej. el LCD:
    decodificar el byte como comando/dato HD44780) en vez de
    depender de que algo del lado JS le mande un "I2CR:" de vuelta.

    on_read(): opcional. Si lo definís, se llama para CALCULAR lo
    que devuelve un readfrom(), en vez de usar el registro común --
    para dispositivos como el teclado I2C, que necesitan preguntarle
    al simulador (vía "I2CR:") qué está pasando en el canvas, no
    solo repetir el último valor conocido. Puede devolver un int
    (se repite nbytes veces, como siempre) o bytes/bytearray CRUDOS
    (se usan directo, sin repetir -- para chips como el BH1750, que
    responden 2 bytes DISTINTOS en un readfrom() plano).

    on_read_mem(reg, nbytes) / on_write_mem(reg, buf): igual que
    on_read/on_write, pero para readfrom_mem()/writeto_mem() --
    dispositivos direccionados por REGISTRO (no un solo byte por
    dirección I2C), como el MPU6050: el firmware hace
    i2c.readfrom_mem(0x68, 0x3B, 14) para leer 14 bytes arrancando
    en el registro 0x3B, y quien registró el dispositivo es quien
    sabe traducir eso a bytes reales (ver mpu6050_hal.py). Antes de
    este agregado, register_i2c_device() no tenía forma de atender
    esto -- todo era "un byte por dirección", suficiente para LCD/
    teclado pero no para un sensor con mapa de registros real.

    on_write_buf(buf): variante de on_write PENSADA PARA LIBRERÍAS
    QUE ARMAN SU PROPIO PROTOCOLO DE REGISTRO A MANO en vez de usar
    writeto_mem()/readfrom_mem() -- ej. qmc5883l.py real:
        i2c.writeto(addr, bytes([reg]) + buf)          # escribir
        i2c.writeto(addr, bytes([reg])); i2c.readfrom(addr, n)  # leer
    Acá el "valor" real vive en buf[1:], no en buf[0] (que es el
    puntero de registro) -- on_write(value) normal solo expone
    buf[0], insuficiente para este patrón. on_write_buf(buf) recibe
    el buffer COMPLETO tal cual llegó a writeto(), sin filtrar nada;
    quien lo registra decide cómo separar puntero de registro y
    datos (ver qmc5883l.hal.py, que además usa on_read() -- sin
    argumentos -- para responder según qué registro fue el último
    seleccionado por un writeto() previo, ya que este driver hace
    select-then-read con dos llamadas separadas, no readfrom_mem).
    Se llama SIEMPRE que haya buf (a diferencia de on_write, que solo
    dispara cuando buf[0] cambia respecto al último valor) porque acá
    cada escritura puede tener un significado distinto aunque el
    primer byte se repita.
    """
    _known_addrs.add(address)
    _devices[address] = {
        "on_write": on_write,
        "on_read": on_read,
        "on_read_mem": on_read_mem,
        "on_write_mem": on_write_mem,
        "on_write_buf": on_write_buf,
    }


def _gpio_num(pin_obj):
    if pin_obj is None:
        return None
    if isinstance(pin_obj, int):
        return pin_obj
    # "_pin_num" es el atributo REAL que usa la Pin de _base_hal.py
    # (ver su __init__) -- faltaba en esta lista, así que un Pin(N)
    # real pasado a I2C(scl=Pin(N), sda=Pin(N)) nunca se resolvía acá
    # (quedaba en None). El PININFO:i2c que depende de esto no se
    # mandaba nunca en ese caso -- enmascarado hasta ahora porque
    # isFullyConnected() cae a un chequeo genérico (isComponentPowered)
    # cuando no hay PININFO, así que I2C seguía "andando" igual, solo
    # sin la validación exacta de pin que se suponía que hacía.
    for attr in ("_pin_num", "id", "_id", "pin", "_pin", "num", "_num", "gpio", "_gpio"):
        val = getattr(pin_obj, attr, None)
        if isinstance(val, int):
            return val
    try:
        return int(pin_obj)
    except Exception:
        return None


_i2c_pins_declared = False


def _declare_i2c_pins(kwargs):
    """
    Manda "PININFO:i2c:sda=N,scl=N" UNA sola vez por corrida (ver
    SignalEngine.js: valida que el cable de datos del componente
    I2C llegue justo a esos GPIO). Antes esto vivía duplicado dentro
    de cada hal.py que necesitara declarar pines reales -- acá
    alcanza con que CUALQUIER componente construya un I2C(sda=..,
    scl=..) una vez, sin importar cuál.
    """
    global _i2c_pins_declared
    if _i2c_pins_declared:
        return
    sda_num = _gpio_num(kwargs.get("sda"))
    scl_num = _gpio_num(kwargs.get("scl"))
    if sda_num is not None and scl_num is not None:
        _i2c_pins_declared = True
        _sys.stdout.write("PININFO:i2c:sda=%d,scl=%d\n" % (sda_num, scl_num))


class I2C:
    """
    ÚNICA clase I2C dummy de todo el proyecto. Cualquier componente
    I2C nuevo se suma vía register_i2c_device() -- no
    reimplementando esta clase en su propio hal.py.
    """

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        _declare_i2c_pins(kwargs)

    def start(self):
        # Primitiva real de machine.I2C (control manual del bus, ver
        # la sección "primitive I2C operations" de la doc oficial) --
        # encontrado con una librería bmp180.py real que la llama
        # sola, sin start()/stop() emparejados alrededor de nada más.
        # No modelamos líneas SDA/SCL de verdad, así que no hay nada
        # que hacer acá -- pero FALTABA el método (AttributeError),
        # cuando en un ESP32 real esta llamada es válida y no hace
        # nada visible tampoco.
        pass

    def stop(self):
        pass

    def writeto(self, addr, buf, stop=True):
        if not buf:
            return
        value = buf[0]
        reg = _i2c_registry()

        device = _devices.get(addr)

        # on_write_buf: SIEMPRE, con el buffer completo -- ver su
        # docstring en register_i2c_device(). Independiente del resto
        # de esta función (que sigue igual, para no romper LCD/
        # teclado/BH1750, todos "un byte por dirección").
        if device and device.get("on_write_buf"):
            device["on_write_buf"](bytes(buf))

        if reg["out"].get(addr) != value:
            reg["out"][addr] = value

            if device and device.get("on_write"):
                device["on_write"](value)

            _sys.stdout.write("I2CW:%d:%d\n" % (addr, value))
            # Ver _base_hal.py: mismo handshake SYNC que Pin.on()/off(),
            # necesario para que un readfrom() inmediatamente después
            # (ej. keypad: baja fila -> lee columna en el mismo tick)
            # no se adelante a la respuesta real.
            _settle()

    def readfrom(self, addr, nbytes, stop=True):
        poll_input()

        device = _devices.get(addr)
        if device and device.get("on_read"):
            value = device["on_read"]()
            # A partir de bh1750_hal.py: on_read() puede devolver
            # bytes/bytearray CRUDOS (ej. un valor de 16 bits con 2
            # bytes distintos) en vez de un solo entero repetido --
            # antes solo existía el caso "un entero -> bytes([value]
            # * nbytes)", suficiente para LCD/teclado (1 byte por
            # dirección) pero no para un chip como el BH1750 que
            # responde 2 bytes DIFERENTES en un readfrom() plano
            # (sin readfrom_mem, que es para chips con mapa de
            # registros como el MPU6050).
            if isinstance(value, (bytes, bytearray)):
                data = bytes(value)
                if len(data) < nbytes:
                    data = data + bytes(nbytes - len(data))
                return data[:nbytes]
            return bytes([value] * nbytes)
        else:
            reg = _i2c_registry()
            value = reg["in"].get(addr, 0xFF)

        return bytes([value] * nbytes)

    def readfrom_into(self, addr, buf, stop=True):
        """
        Variante "sin allocar" de readfrom() -- en vez de devolver un
        bytes nuevo, llena el buffer (bytearray) que le pasaron. Real
        en MicroPython (evita crear un objeto por lectura); FALTABA
        acá -- encontrado con la librería bh1750.py real del usuario
        (BH1750.measurement la usa en vez de readfrom()), reventaba
        con AttributeError. Reutiliza toda la lógica de readfrom()
        (on_read, bytes crudos, etc.) en vez de duplicarla.
        """
        data = self.readfrom(addr, len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]

    def readfrom_mem(self, addr, memaddr, nbytes, addrsize=8):
        """
        Lectura direccionada por REGISTRO (ej. i2c.readfrom_mem(0x68,
        0x3B, 14) para leer 14 bytes del MPU6050 arrancando en el
        registro 0x3B). addrsize se acepta por compatibilidad de
        firma con la API real pero no se usa (este dummy no simula
        direcciones de registro de 16 bits, ningún componente
        actual lo necesita).

        Si el dispositivo registrado no definió on_read_mem, se
        cae al mismo comportamiento "byte único repetido" que
        readfrom() -- mejor que un OSError para no romper firmware
        que por error lea un registro de un dispositivo que no lo
        soporta.
        """
        poll_input()

        device = _devices.get(addr)
        if device and device.get("on_read_mem"):
            return device["on_read_mem"](memaddr, nbytes)

        if device and device.get("on_read"):
            value = device["on_read"]()
        else:
            reg = _i2c_registry()
            value = reg["in"].get(addr, 0xFF)

        return bytes([value] * nbytes)

    def readfrom_mem_into(self, addr, memaddr, buf, addrsize=8):
        """
        Variante "sin allocar" de readfrom_mem() -- mismo motivo que
        readfrom_into() de arriba (evita crear un objeto por lectura),
        FALTABA acá -- encontrado con la librería ds3231.py real del
        usuario (DS3231.datetime()/_OSF_reset() la usan en vez de
        readfrom_mem()), reventaba con AttributeError. Reutiliza toda
        la lógica de readfrom_mem() en vez de duplicarla.
        """
        data = self.readfrom_mem(addr, memaddr, len(buf), addrsize=addrsize)
        for i in range(len(buf)):
            buf[i] = data[i]

    def writeto_mem(self, addr, memaddr, buf, addrsize=8):
        """
        Escritura direccionada por registro (ej. escribir 0x00 en
        PWR_MGMT_1 (0x6B) del MPU6050 para "despertarlo"). Mismo
        criterio que writeto(): si el dispositivo definió
        on_write_mem, se lo llama; si no, no hacemos nada (no hay
        registro común "por memaddr" como sí existe para writeto()
        por dirección -- no hace falta, ningún componente actual lo
        necesita para nada más que el hook).
        """
        device = _devices.get(addr)
        if device and device.get("on_write_mem"):
            device["on_write_mem"](memaddr, bytes(buf))
            _settle()

    def scan(self):
        reg = _i2c_registry()
        return sorted(set(reg["out"].keys()) | set(reg["in"].keys()) | _known_addrs)


def _on_i2c_read_line(parts):
    # parts = ["I2CR", "<addr>", "<byte>"]
    if len(parts) < 3:
        return
    try:
        addr  = int(parts[1])
        value = int(parts[2])
    except ValueError:
        return
    reg = _i2c_registry()
    reg["in"][addr] = value & 0xFF


# register_line_handler/poll_input los define _base_hal.py como
# funciones de módulo -- se inyecta siempre antes que este archivo.
register_line_handler("I2CR:", _on_i2c_read_line)

# Reemplazo del atributo real del módulo, UNA sola vez -- mismo
# criterio que ya usa _base_hal.py para machine.Pin. Ya no hay
# ninguna carrera: este archivo siempre carga antes que cualquier
# hal.py de componente, así que siempre es esta clase la que gana.
import machine as _machine_module
_machine_module.I2C = I2C

# SoftI2C (I2C por bit-banging, mismo protocolo/API que I2C real)
# NO estaba reemplazada -- encontrada con una librería mpu6050.py
# real que usa "SoftI2C(scl=Pin(22), sda=Pin(21))" en vez de I2C()
# a secas. Sin este reemplazo, quedaba la SoftI2C REAL de QEMU, que
# rechaza esos pines con "ValueError: invalid pin" -- mismo síntoma
# y misma causa raíz que el ValueError de sg90.hal.py (un periférico
# real de QEMU que no acepta el pin en este build), resuelto acá con
# el mismo criterio: no heredar de la clase real, usar esta dummy
# para ambos nombres.
_machine_module.SoftI2C = I2C