# =============================================================
# PitSimulator — render real de pantallas OLED I2C para el runtime
# WASM (SSD1306 y SH1106).
#
# A diferencia de casi todo lo demás en components_wasm/ (DHT11,
# BH1750, MPU6050...), estos dos NO tienen ningún .hal.py propio que
# los reemplace -- components_wasm/libs/ssd1306.py y sh1106.py son
# los drivers REALES de la comunidad, sin modificar, que hablan I2C
# de verdad registro por registro (i2c.writeto()/writevto()).
#
# Hasta este archivo, _i2c_bus_wasm.py sabía RECIBIR esos comandos
# pero "nada del lado JS reacciona a I2CW: más que loguearlo" (ver su
# propio comentario) -- ningún OLED mostraba nada en modo navegador,
# ni SSD1306 ni SH1106 (confirmado en vivo con Playwright: pantalla
# siempre en negro/apagada, capturando los píxeles reales del canvas,
# aunque el código del alumno corriera sin ningún error).
#
# Qué hace este archivo: envuelve i2c.writeto()/writevto() (las dos
# únicas formas en que estos drivers mandan algo -- nunca usan
# writeto_mem) y reconstruye el framebuffer de 128x64 a mano,
# interpretando el protocolo de control que comparten las dos
# familias de chip (primer byte de cada transacción: 0x80 ó 0x00 =
# lo que sigue son comandos, 0x40 = lo que sigue son datos de
# píxeles) + los comandos de posicionamiento propios de cada chip
# (SET_COL_ADDR/SET_PAGE_ADDR de SSD1306; páginas 0xB0-0xB7 y nibbles
# de columna 0x00-0x1F de SH1106). Parser GENÉRICO a propósito -- no
# hace falta saber cuál de los dos chips está conectado, y de hecho
# no hay forma de saberlo: el canvas solo tiene UN componente "OLED"
# (ver components/oled/), el chip lo elige el alumno importando
# ssd1306 o sh1106 en su código, igual que con un módulo físico real.
#
# Cuando se completa una escritura de datos, manda
# "OLED:128x64:<buffer en hex>" por stdout -- MISMO protocolo que ya
# entendía WasmBridge.js (y que manda components/oled/oled.hal.py en
# modo QEMU) -- sin address ni id de componente, porque ese protocolo
# ya asumía un solo OLED por circuito desde siempre (ver
# SignalEngine.applyOledFramebuffer(), no recibe ningún id tampoco).
# Nada del lado JS/Renderer necesita cambiar.
#
# Limitación conocida: el SH1106 físico tiene 132 columnas, los
# drivers lo usan centrado a 128 con un corrimiento de 2 píxeles (ver
# "_LOW_COLUMN_ADDRESS | 2" en sh1106.py) -- este parser no resta ese
# offset (para no necesitar saber qué chip es), así que el texto en
# una pantalla "SH1106" puede verse ~2px corrido a la derecha.
# Cosmético nada más, no rompe el dibujo.
#
# Tamaño fijo 128x64 a propósito: es el único tamaño que existe hoy
# en el catálogo de PitSimulator (components/oled/oled.json declara
# screenWidth/screenHeight fijos en 128/64) -- si algún día se agrega
# una pantalla de otro tamaño, esto necesita generalizarse.
#
# SEGUNDO bug real encontrado armando esto (además del monkey-patch
# de más abajo): aunque este archivo y _i2c_bus_wasm.py ya andaban
# bien solos, SH1106 seguía en negro en el canvas real -- resultó que
# ReplPanel._buildPendingHal() manda el components/oled/oled.hal.py
# REAL (pensado para QEMU) por CUALQUIER componente "oled" en el
# lienzo, sin importar si el bridge es WASM o QEMU. Ese .hal.py hace
# "machine.I2C = I2C" con una clase dummy PROPIA (ver su docstring:
# está pensado para QEMU, donde varios .hal.py "compiten" por esa
# asignación) que NO llama a _oled_process_write() -- pisa el
# machine.I2C bueno de _i2c_bus_wasm.py DESPUÉS de que este archivo ya
# cargó. Para SSD1306 "funcionaba" por pura casualidad (oled.hal.py
# también reemplaza sys.modules["ssd1306"] con su propia
# implementación, que sí manda OLED: bien) -- pero no hay equivalente
# ahí para sh1106, así que SH1106 quedaba sin nadie que lo maneje.
# Fix real en js/ui/ReplPanel.js (ReplPanel.WASM_SKIP_HAL_TYPES):
# "oled" se salta ahí cuando el bridge es WASM, dejando que ESTE
# archivo (más _i2c_bus_wasm.py y los drivers reales de
# components_wasm/libs/) sea la única implementación activa.
# =============================================================

import sys

_OLED_WIDTH = 128
_OLED_HEIGHT = 64
_OLED_PAGES = _OLED_HEIGHT // 8
_OLED_BUFSIZE = _OLED_WIDTH * _OLED_PAGES

# Comandos que consumen N bytes de parámetro ADICIONALES, mandados
# como comandos sueltos aparte (uno por cada write_cmd(), ver el
# comentario grande arriba) -- sin esto, un byte de parámetro
# cualquiera (ej. el 0x00 que sigue a SET_MEM_ADDR) se confundiría
# con un comando de columna/página de SH1106 (que vive justo en el
# rango 0x00-0x1F) y desincroniza el cursor. Confirmado línea por
# línea contra ssd1306.py/sh1106.py, no adivinado.
_CMD_PARAM_COUNT = {
    0x81: 1,  # SET_CONTRAST
    0x20: 1,  # SET_MEM_ADDR (SSD1306)
    0x21: 2,  # SET_COL_ADDR (SSD1306)
    0x22: 2,  # SET_PAGE_ADDR (SSD1306)
    0xA8: 1,  # SET_MUX_RATIO
    0xD3: 1,  # SET_DISP_OFFSET
    0xDA: 1,  # SET_COM_PIN_CFG
    0xD5: 1,  # SET_DISP_CLK_DIV
    0xD9: 1,  # SET_PRECHARGE
    0xDB: 1,  # SET_VCOM_DESEL
    0xAD: 1,  # SET_IREF_SELECT
    0x8D: 1,  # SET_CHARGE_PUMP
}

_HEXCHARS = "0123456789abcdef"

def _hex(buf):
    out = []
    for b in buf:
        out.append(_HEXCHARS[(b >> 4) & 0xF])
        out.append(_HEXCHARS[b & 0xF])
    return "".join(out)

# Estado por dirección I2C -- nada impide (en teoría) tener más de un
# OLED en direcciones distintas del mismo bus, aunque el canvas de
# PitSimulator hoy solo tiene un componente "oled" para mostrarlo.
_oled_buffers = {}   # addr -> bytearray(1024)
_oled_cursor = {}    # addr -> [page, col]
_oled_pending = {}   # addr -> [cmd, params_needed, params_collected] o None

def _oled_state(addr):
    if addr not in _oled_buffers:
        _oled_buffers[addr] = bytearray(_OLED_BUFSIZE)
        _oled_cursor[addr] = [0, 0]
        _oled_pending[addr] = None
    return _oled_buffers[addr], _oled_cursor[addr]

def _oled_handle_command_byte(addr, byte):
    pending = _oled_pending[addr]
    cursor = _oled_cursor[addr]

    if pending is not None:
        cmd, needed, collected = pending
        collected.append(byte)
        if len(collected) >= needed:
            if cmd == 0x21:    # SET_COL_ADDR -- collected[0] = columna inicial
                cursor[1] = collected[0] % _OLED_WIDTH
            elif cmd == 0x22:  # SET_PAGE_ADDR -- collected[0] = página inicial
                cursor[0] = collected[0] % _OLED_PAGES
            elif cmd == 0x81:  # SET_CONTRAST -- collected[0] = nivel 0-255
                # Mismo protocolo "OLEDC:<valor>" que ya entendía
                # WasmBridge.js (ver su comentario junto a "OLEDC:") --
                # antes lo mandaba oled.hal.py desde su propio
                # contrast() en Python; ahora que ese .hal.py se salta
                # en WASM (ver WASM_SKIP_HAL_TYPES en ReplPanel.js),
                # hace falta emitirlo acá para no perder el efecto del
                # control de brillo del panel de propiedades.
                sys.stdout.write("OLEDC:%d\n" % collected[0])
            _oled_pending[addr] = None
        else:
            _oled_pending[addr] = [cmd, needed, collected]
        return

    needed = _CMD_PARAM_COUNT.get(byte)
    if needed:
        _oled_pending[addr] = [byte, needed, []]
        return

    if 0xB0 <= byte <= 0xB7:          # SH1106: seleccionar página
        cursor[0] = byte - 0xB0
        cursor[1] = 0
    elif 0x00 <= byte <= 0x0F:        # SH1106: nibble bajo de columna
        cursor[1] = (cursor[1] & 0xF0) | byte
    elif 0x10 <= byte <= 0x1F:        # SH1106: nibble alto de columna
        cursor[1] = (cursor[1] & 0x0F) | ((byte & 0x0F) << 4)
    # cualquier otro comando de 0 parámetros (SET_DISP, SET_NORM_INV,
    # SET_SEG_REMAP, SET_ENTIRE_ON, SET_COM_OUT_DIR,
    # SET_DISP_START_LINE, etc.) no afecta el cursor -- se ignora a
    # propósito, no hace falta para reconstruir la imagen.

def _oled_handle_data_bytes(addr, data):
    buf, cursor = _oled_state(addr)
    page, col = cursor
    for b in data:
        idx = page * _OLED_WIDTH + col
        if 0 <= idx < _OLED_BUFSIZE:
            buf[idx] = b
        col += 1
        if col >= _OLED_WIDTH:
            col = 0
            page = (page + 1) % _OLED_PAGES
    cursor[0] = page
    cursor[1] = col
    sys.stdout.write("OLED:%dx%d:%s\n" % (_OLED_WIDTH, _OLED_HEIGHT, _hex(buf)))

def _oled_process_write(addr, buf):
    if not buf:
        return
    _oled_state(addr)
    control = buf[0]
    rest = buf[1:]
    if control == 0x40:             # datos de píxeles
        _oled_handle_data_bytes(addr, rest)
    elif control == 0x80 or control == 0x00:  # comando(s)
        for b in rest:
            _oled_handle_command_byte(addr, b)
    # cualquier otro primer byte: no es el protocolo Co/D-C que usan
    # estos drivers -- se ignora, no es tráfico de pantalla.

# ── Enganche con el I2C genérico (_i2c_bus_wasm.py) ──
# A propósito, NO se hace acá con un monkey-patch tipo
# "I2C.writeto = _oled_writeto" -- BUG REAL encontrado al armar esto:
# este build de MicroPython WASM no deja reemplazar un método que la
# clase YA tenía definido (confirmado en vivo: I2C.writeto.__name__
# seguía dando "writeto" después del parche, SH1106 -- que manda TODO
# por writeto(), a diferencia de SSD1306 que manda los datos por
# writevto() -- nunca disparaba nada). La llamada real a
# _oled_process_write() vive DENTRO de I2C.writeto() en
# _i2c_bus_wasm.py mismo (ver ese archivo) -- late binding de Python
# (el nombre global se resuelve recién cuando writeto() se LLAMA, no
# cuando se DEFINE) alcanza para que funcione sin importar si este
# archivo se carga antes o después de _i2c_bus_wasm.py, siempre que
# los dos terminen de cargar antes de que corra cualquier código del
# alumno -- que es como ya corren TODOS los _xxx_wasm.py, ver
# wasmWorker.js.
