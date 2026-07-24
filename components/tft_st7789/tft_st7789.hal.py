# =============================================================
# PitSimulator — HAL TFT ST7789 SPI (240x240, IPS, color real)
#
# Reemplaza al driver ST7789 real (misma API pública que la librería
# más usada en MicroPython -- devbis/st7789py_mpy -- que expone:
#   ST7789(spi, width, height, reset=, dc=, cs=, backlight=, ...)
#   .init()
#   .fill(color)
#   .pixel(x, y, color)
#   .hline(x, y, length, color)
#   .vline(x, y, length, color)
#   .line(x0, y0, x1, y1, color)
#   .rect(x, y, width, height, color)        (solo borde)
#   .fill_rect(x, y, width, height, color)
#   .blit_buffer(buffer, x, y, width, height)
#   color565(r, g, b)  -- función de módulo
#
# Uso en código del usuario (idéntico a como ya lo harías con la
# librería real):
#   from machine import Pin, SPI
#   import st7789
#
#   spi = SPI(2, baudrate=30000000, sck=Pin(18), mosi=Pin(19))
#   tft = st7789.ST7789(spi, 240, 240,
#                        reset=Pin(4, Pin.OUT), dc=Pin(2, Pin.OUT),
#                        cs=Pin(5, Pin.OUT), backlight=Pin(15, Pin.OUT))
#   tft.init()
#   tft.fill(st7789.color565(0, 0, 0))
#   tft.fill_rect(10, 10, 50, 30, st7789.color565(255, 0, 0))
#
# ── Por qué "rectángulo sucio" y no framebuffer completo ───────
#
# El OLED/LCD/TM1637/MAX7219 mandan su contenido COMPLETO recién
# cuando el firmware llama a algo tipo .show() -- porque esas
# librerías SÍ buferizan en RAM (subclasean framebuf.FrameBuffer) y
# el .show() es el único momento en que hay que sincronizar con la
# "pantalla".
#
# El driver ST7789 real NO buferiza nada: cada llamada (pixel(),
# fill_rect(), etc.) escribe DIRECTO a la GRAM de la pantalla por
# SPI, ya con esos pixels definitivos. No hay ningún .show() que
# esperar. Si acá mandáramos los 240x240x2 = 115200 bytes completos
# en CADA pixel() suelto (ej. un texto de 20 caracteres dibujado
# glifo a glifo son cientos de pixel()/fill_rect() sueltos), el UART
# del REPL se saturaría enseguida y la simulación se pondría
# lentísima. En cambio, cada primitiva manda SOLO el rectángulo
# mínimo que tocó -- "TFT:<x>:<y>:<w>x<h>:<hex>" -- que para la
# mayoría de los dibujos (un pixel, una letra, un ícono chico) es
# información mínima. Ver Renderer.drawTftRegion(): el <canvas> del
# lado del simulador conserva el resto de la pantalla tal cual
# estaba, no hace falta reenviarla.
#
# ── SPI dummy ────────────────────────────────────────────────
# Mismo motivo que el I2C dummy de lcd_16x2_i2c.hal.py / oled.hal.py:
# no mandamos transacciones SPI reales (todo pasa por el rectángulo
# sucio + print), así que no hace falta un bus SPI de hardware real
# -- el machine.SPI real de QEMU sí lo necesita y falla si no está
# enganchado a nada.
#
# ── Limitaciones conocidas (por ahora) ──────────────────────────
# - .text(font, s, x, y, fg=WHITE, bg=BLACK) solo soporta módulos de
#   fuente bitmap de ancho fijo <= 8px (ej. vga_8x8) -- fuentes más
#   anchas o de ancho variable (proporcionales) todavía no.
# - .draw_icon() asume 1bpp fila por fila MSB-primero (formato más
#   común) -- si tu módulo de íconos usa otro layout, avisá.
# - self.rotation (0-3) SÍ rota posición y contenido de todo lo que
#   se dibuja (ver _logical_to_physical_rect/_rotate_buffer_content)
#   -- se lee como atributo simple (tft.rotation = 1), no como
#   método callable (tft.rotation(1) no funciona, a diferencia de
#   russhughes/st7789_mpy).
# - El pin "backlight" se maneja como un GPIO común (ver _base_hal.
#   Pin) -- prende/apaga como cualquier salida digital, pero no
#   atenúa ni oscurece la pantalla en el simulador todavía.
# =============================================================

import sys as _sys


# Best-effort: sck/mosi (kwargs del SPI dummy) y reset/dc/cs/backlight
# (Pin directos en el constructor de ST7789) llegan como machine.Pin(N)
# real -- probamos los nombres de atributo más comunes para sacar el
# número de GPIO. OJO: sin ver la clase Pin real de _base_hal.py esto
# es una suposición razonable, no una certeza -- avisar si hace falta
# ajustar el atributo exacto.
def _gpio_num(pin_obj):
    if pin_obj is None:
        return None
    if isinstance(pin_obj, int):
        return pin_obj
    # Ver el mismo fix en _i2c_bus.hal.py/_adc_bus.hal.py -- faltaba
    # "_pin_num" (el atributo real de la Pin de _base_hal.py).
    for attr in ("_pin_num", "id", "_id", "pin", "_pin", "num", "_num", "gpio", "_gpio"):
        val = getattr(pin_obj, attr, None)
        if isinstance(val, int):
            return val
    try:
        return int(pin_obj)
    except Exception:
        return None


class SPI:
    """
    SPI dummy -- no hay bus físico real detrás, todo pasa por el
    rectángulo sucio que manda ST7789 directamente por stdout. Igual
    criterio que el I2C dummy de oled.hal.py / lcd_16x2_i2c.hal.py.
    """

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def init(self, *args, **kwargs):
        pass

    def deinit(self):
        pass

    def write(self, buf):
        pass

    def read(self, nbytes, write=0x00):
        return b"\x00" * nbytes

    def readinto(self, buf, write=0x00):
        pass

    def write_readinto(self, write_buf, read_buf):
        pass


import machine as _machine_module
_machine_module.SPI = SPI


def color565(r, g, b):
    """
    Empaqueta 3 bytes RGB888 a un entero RGB565 -- misma función que
    trae la librería real (a veces como color565() de módulo, a
    veces como método estático; acá la dejamos de módulo, que es el
    uso más común: "st7789.color565(255, 0, 0)").
    """
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


class ST7789:

    def __init__(self, spi, width=240, height=240, reset=None, dc=None,
                 cs=None, backlight=None, xstart=0, ystart=0, rotation=0):

        self.spi = spi
        self.width = width
        self.height = height
        self.xstart = xstart
        self.ystart = ystart
        self.rotation = rotation  # ver "Limitaciones conocidas" arriba

        self.reset_pin = reset
        self.dc_pin = dc
        self.cs_pin = cs
        self.backlight_pin = backlight

        # Declarar ante el simulador qué GPIO reales usó el código del
        # usuario -- una sola vez, al construirse. sck/mosi salen del
        # SPI dummy (self.spi.kwargs, ver la clase SPI más arriba);
        # reset/dc/cs/backlight ya los tenemos como parámetros acá
        # mismo. cs/backlight solo se incluyen si el usuario los pasó
        # (son opcionales en la vida real -- muchos módulos los traen
        # puenteados en la propia placa) -- ver SignalEngine, que ya
        # los marca "optional" en tft_st7789.json.
        spi_kwargs = getattr(spi, "kwargs", {}) or {}
        sck_num  = _gpio_num(spi_kwargs.get("sck"))
        mosi_num = _gpio_num(spi_kwargs.get("mosi"))
        rst_num  = _gpio_num(reset)
        dc_num   = _gpio_num(dc)
        cs_num   = _gpio_num(cs)
        blk_num  = _gpio_num(backlight)

        if sck_num is not None and mosi_num is not None and rst_num is not None and dc_num is not None:
            pins = "sck=%d,mosi=%d,rst=%d,dc=%d" % (sck_num, mosi_num, rst_num, dc_num)
            if cs_num is not None:
                pins += ",cs=%d" % cs_num
            if blk_num is not None:
                pins += ",blk=%d" % blk_num
            _sys.stdout.write("PININFO:tft:%s\n" % pins)

        # NO hay framebuffer interno -- la versión anterior guardaba
        # acá un bytearray(width*height*2) = 115200 bytes SOLO para
        # poder recortar el rectángulo mínimo de line()/rect(), pero
        # eso es más RAM de la que el heap del ESP32 emulado tiene
        # libre (MemoryError apenas se instancia el driver, antes de
        # dibujar nada). Cada primitiva de acá abajo arma y manda sus
        # bytes al vuelo, sin acumular nada persistente -- ver
        # _send_solid()/_send_pixel() más abajo.

        if self.cs_pin:
            self.cs_pin.value(1)
        if self.dc_pin:
            self.dc_pin.value(0)

    # ── Ciclo de vida ────────────────────────────────────────────

    def init(self):
        """
        El driver real manda acá toda la secuencia de comandos de
        inicialización del ST7789 (SWRESET, sleep out, color mode,
        etc.) -- no hay nada de eso que simular, así que solo
        dejamos la pantalla en negro (comportamiento visible
        equivalente: "recién prendida, sin dibujar nada todavía").
        """
        if self.reset_pin:
            self.reset_pin.value(0)
            self.reset_pin.value(1)
        if self.backlight_pin:
            self.backlight_pin.value(1)
        self.fill(0)

    # ── Helpers internos ─────────────────────────────────────────

    def _clip(self, x, y, w, h):
        """
        Recorta (x, y, w, h) para que caiga dentro de (0..width,
        0..height). Devuelve None si el rectángulo queda vacío.
        """
        if x < 0:
            w += x
            x = 0
        if y < 0:
            h += y
            y = 0
        if x + w > self.width:
            w = self.width - x
        if y + h > self.height:
            h = self.height - y
        if w <= 0 or h <= 0:
            return None
        return (x, y, w, h)

    def _logical_to_physical_rect(self, x, y, w, h):
        """
        Transforma un rectángulo axis-aligned de coordenadas LÓGICAS
        (las que usa el código del usuario -- siempre "ve" una
        pantalla igual sea cual sea self.rotation) a coordenadas
        FÍSICAS del canvas real, que nunca rota -- lo que rota es el
        CONTENIDO. self.rotation se lee en cada llamada, así que
        cambiarlo (tft.rotation = 1) afecta al próximo dibujo sin
        hacer falta reinicializar nada.

        Como el panel de este proyecto siempre es cuadrado (240x240),
        las 4 rotaciones quedan simétricas entre self.width y
        self.height. Fórmulas derivadas rotando cada esquina del
        rectángulo (0=0°, 1=90° horario, 2=180°, 3=270° horario).
        """
        r = self.rotation % 4
        if r == 0:
            return x, y, w, h
        if r == 2:
            return self.width - x - w, self.height - y - h, w, h
        if r == 1:
            return self.width - y - h, x, h, w
        # r == 3
        return y, self.height - x - w, h, w

    def _rotate_buffer_content(self, buf, w, h):
        """
        Rota el CONTENIDO de un buffer RGB565 de w x h según
        self.rotation (no solo su posición -- ver
        _logical_to_physical_rect para la posición). Necesario para
        blit_buffer()/text()/draw_icon(): si sólo moviéramos el
        rectángulo pero no reordenáramos los píxeles adentro, un
        ícono o una letra aparecerían en el lugar correcto pero
        "acostados" en vez de girados.

        Devuelve (buffer_nuevo, ancho_nuevo, alto_nuevo) -- para
        rotation 1/3 el ancho y alto se intercambian, igual que en
        _logical_to_physical_rect (misma matemática, aplicada acá
        píxel por píxel en vez de a las esquinas del rectángulo).
        """
        r = self.rotation % 4
        if r == 0:
            return buf, w, h

        new_w, new_h = (h, w) if r in (1, 3) else (w, h)
        out = bytearray(new_w * new_h * 2)

        for row in range(h):
            row_base = row * w
            for col in range(w):
                src_off = (row_base + col) * 2
                if r == 1:
                    nx, ny = h - 1 - row, col
                elif r == 2:
                    nx, ny = w - 1 - col, h - 1 - row
                else:  # r == 3
                    nx, ny = row, w - 1 - col
                dst_off = (ny * new_w + nx) * 2
                out[dst_off] = buf[src_off]
                out[dst_off + 1] = buf[src_off + 1]

        return out, new_w, new_h

    def _send_pixel(self, x, y, color):
        """Manda un único pixel -- usado por pixel() y por line()
        (Bresenham manda cada punto en cuanto lo calcula, no acumula
        nada). Sin buffer propio no hay forma barata de saber si dos
        pixeles son contiguos para agruparlos, así que cada uno viaja
        en su propio "TFT:x:y:1x1:hex" -- más mensajes por UART que
        antes, pero cero RAM extra, y para líneas/pixeles sueltos
        (no rellenos grandes) el volumen sigue siendo chico."""
        if not (0 <= x < self.width and 0 <= y < self.height):
            return
        hi = (color >> 8) & 0xFF
        lo = color & 0xFF
        _sys.stdout.write("TFT:%d:%d:1x1:%02x%02x\n" % (x, y, hi, lo))

    def _send_solid(self, x, y, w, h, color):
        """Manda un rectángulo sólido (un único color repetido) --
        usado por fill_rect()/hline()/vline() y por las 4 franjas de
        rect(). Arma la fila de hex UNA sola vez (todas las filas son
        idénticas en un relleno sólido) y la ESCRIBE h veces directo
        a stdout -- NO arma primero "row_hex * h" en un solo string
        gigante: para un fill() de pantalla completa (240x240) eso
        son 230.400 bytes de string temporal, la MISMA cantidad de
        memoria que el framebuffer que sacamos, solo que efímera en
        vez de persistente -- y el heap del ESP32 emulado tampoco
        la tiene. Escribir fila por fila mantiene en memoria, en
        todo momento, nomás una fila (unos pocos cientos de bytes)."""
        clipped = self._clip(x, y, w, h)
        if not clipped:
            return
        x, y, w, h = clipped

        hi = (color >> 8) & 0xFF
        lo = color & 0xFF
        row_hex = ("%02x%02x" % (hi, lo)) * w

        _sys.stdout.write("TFT:%d:%d:%dx%d:" % (x, y, w, h))
        for _ in range(h):
            _sys.stdout.write(row_hex)
        _sys.stdout.write("\n")

    # ── Primitivas de dibujo ─────────────────────────────────────

    def pixel(self, x, y, color):
        px, py, _, _ = self._logical_to_physical_rect(x, y, 1, 1)
        self._send_pixel(px, py, color)

    def fill_rect(self, x, y, width, height, color):
        px, py, pw, ph = self._logical_to_physical_rect(x, y, width, height)
        self._send_solid(px, py, pw, ph, color)

    def fill(self, color):
        self.fill_rect(0, 0, self.width, self.height, color)

    def hline(self, x, y, length, color):
        self.fill_rect(x, y, length, 1, color)

    def vline(self, x, y, length, color):
        self.fill_rect(x, y, 1, length, color)

    def line(self, x0, y0, x1, y1, color):
        """Bresenham clásico -- SIN buffer intermedio, cada punto se
        manda apenas se calcula (self._send_pixel). Antes se dibujaba
        sobre self._fb y se mandaba un único bounding box al final;
        eso ya no es viable sin framebuffer, porque el bounding box
        de una diagonal completa (ej. esquina a esquina) puede cubrir
        la pantalla entera y ahí no sabríamos qué mandar en los
        huecos que la línea no toca (ese contenido "de fondo" vivía
        únicamente en self._fb). Mandar punto a punto es más
        mensajes por UART pero no depende de memoria alguna."""

        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy

        x, y = x0, y0

        while True:
            px, py, _, _ = self._logical_to_physical_rect(x, y, 1, 1)
            self._send_pixel(px, py, color)
            if x == x1 and y == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x += sx
            if e2 <= dx:
                err += dx
                y += sy

    def rect(self, x, y, width, height, color):
        """Rectángulo SIN relleno (solo el borde) -- armado como 4
        franjas sólidas independientes (arriba, abajo, izquierda,
        derecha) en vez de un solo bounding box. Antes se apoyaba en
        self._fb para saber qué había en el INTERIOR del rectángulo
        (para no perderlo al mandar el bounding box completo); ahora,
        al no tocar el interior para nada, cada franja se manda con
        _send_solid() y el simulador conserva el interior tal cual
        estaba -- que es, además, el comportamiento correcto de un
        rect() sin relleno. Cada franja pasa por
        _logical_to_physical_rect() para que rect() también rote con
        self.rotation, igual que el resto de las primitivas."""
        if width <= 0 or height <= 0:
            return

        strips = [(x, y, width, 1)]                                   # borde superior
        if height > 1:
            strips.append((x, y + height - 1, width, 1))               # borde inferior
        if height > 2:
            strips.append((x, y + 1, 1, height - 2))                   # borde izquierdo
            if width > 1:
                strips.append((x + width - 1, y + 1, 1, height - 2))   # borde derecho

        for sx, sy, sw, sh in strips:
            px, py, pw, ph = self._logical_to_physical_rect(sx, sy, sw, sh)
            self._send_solid(px, py, pw, ph, color)

    def text(self, font, s, x, y, fg=0xFFFF, bg=0x0000):
        """
        Dibuja texto con un MÓDULO DE FUENTE bitmap externo (ej.
        vga_8x8, vga1_8x8 -- los típicos "vgaN_WxH.py" que se bajan
        sueltos o vienen con russhughes/st7789_mpy) -- mismo orden de
        argumentos que las librerías reales que usan esta convención:
        text(font, string, x, y, fg=WHITE, bg=BLACK).

        El módulo de fuente debe exponer:
          WIDTH, HEIGHT -- tamaño de cada glifo en píxeles (acá solo
                           soportamos WIDTH <= 8, ver más abajo)
          FIRST, LAST   -- primer/último código de caracter soportado
          FONT (o _FONT) -- bytes: HEIGHT bytes por glifo, 1 byte por
                            fila, bit más significativo = píxel más a
                            la izquierda, 1 = trazo / 0 = fondo. Es el
                            formato más común de estos módulos para
                            fuentes de ancho fijo <= 8px (como
                            vga_8x8).

        LIMITACIÓN: si el módulo de fuente es de ancho > 8px (ej.
        vga2_8x16 con glifos de más de 1 byte por fila, o fuentes
        PROPORCIONALES de ancho variable como las que usan
        write()/write_len() en devbis/st7789py_mpy) esto todavía no
        lo soporta -- levanta un error claro en vez de dibujar
        cualquier cosa rota. Si necesitás esa fuente en particular,
        avisá qué módulo es y lo sumamos.
        """
        font_w = getattr(font, "WIDTH", 8)
        font_h = getattr(font, "HEIGHT", 8)
        first  = getattr(font, "FIRST", 0x20)
        last   = getattr(font, "LAST", 0x7F)
        data   = getattr(font, "FONT", None)
        if data is None:
            data = getattr(font, "_FONT", None)

        if data is None:
            raise AttributeError(
                "El módulo de fuente no tiene FONT/_FONT -- no es un "
                "módulo de fuente bitmap compatible (se espera "
                "WIDTH/HEIGHT/FIRST/LAST/FONT, como vga_8x8.py)")

        if font_w > 8:
            raise NotImplementedError(
                "Fuente de %d px de ancho no soportada todavía -- "
                "este HAL solo dibuja fuentes de ancho fijo <= 8px "
                "(como vga_8x8). Avisá si necesitás una fuente más "
                "ancha para agregarle soporte." % font_w)

        fg_hi, fg_lo = (fg >> 8) & 0xFF, fg & 0xFF
        bg_hi, bg_lo = (bg >> 8) & 0xFF, bg & 0xFF

        cur_x = x
        for ch in s:
            code = ord(ch)
            if code < first or code > last:
                code = first  # fuera de rango -> cae al primer glifo (típ. espacio)
            glyph_offset = (code - first) * font_h

            buf = bytearray(font_w * font_h * 2)
            for row in range(font_h):
                row_bits = data[glyph_offset + row]
                for col in range(font_w):
                    bit = (row_bits >> (7 - col)) & 1
                    off = (row * font_w + col) * 2
                    if bit:
                        buf[off], buf[off + 1] = fg_hi, fg_lo
                    else:
                        buf[off], buf[off + 1] = bg_hi, bg_lo

            self.blit_buffer(buf, cur_x, y, font_w, font_h)
            cur_x += font_w

    def draw_icon(self, data, x, y, w, scale=1, fg=0xFFFF, bg=0x0000):
        """
        Dibuja un ícono/glifo bitmap monocromo empaquetado en bits --
        misma convención de argumentos que draw_icon() en
        russhughes/st7789_mpy: (data, x, y, width, scale=1, fg=WHITE,
        bg=BLACK).

        `data` son bytes 1bpp, fila por fila, MSB-primero, con
        ceil(width/8) bytes por fila. La ALTURA no se pasa como
        parámetro -- se infiere de len(data) // bytes_por_fila, que
        es como funcionan los módulos de íconos tipo
        icons_px.get_ch(), que devuelven los bytes crudos del glifo
        sin mandar la altura al lado.

        `scale` agranda cada bit a un bloque de scale x scale píxeles
        (upscale nearest-neighbor) -- típico para íconos chiquitos
        (12x12, 16x16) que se quieren ver más grandes en una pantalla
        de 240x240.

        OJO: no tengo el archivo icons_px.py de tu proyecto, así que
        esto asume el formato MÁS COMÚN para este tipo de función
        (1 bit por píxel, fila por fila, MSB-primero). Si el ícono
        sale con la forma incorrecta, pasame icons_px.py y ajusto el
        desempaquetado al formato real en vez de asumir.
        """
        scale = max(1, int(scale))
        bytes_per_row = (w + 7) // 8
        if bytes_per_row <= 0 or w <= 0:
            return
        h = len(data) // bytes_per_row
        if h <= 0:
            return

        fg_hi, fg_lo = (fg >> 8) & 0xFF, fg & 0xFF
        bg_hi, bg_lo = (bg >> 8) & 0xFF, bg & 0xFF

        out_w, out_h = w * scale, h * scale
        buf = bytearray(out_w * out_h * 2)

        for row in range(h):
            row_start = row * bytes_per_row
            for col in range(w):
                bit = (data[row_start + (col >> 3)] >> (7 - (col & 7))) & 1
                hi, lo = (fg_hi, fg_lo) if bit else (bg_hi, bg_lo)
                for sy in range(scale):
                    out_row_base = ((row * scale + sy) * out_w + col * scale) * 2
                    for sx in range(scale):
                        off = out_row_base + sx * 2
                        buf[off] = hi
                        buf[off + 1] = lo

        self.blit_buffer(buf, x, y, out_w, out_h)

    def blit_buffer(self, buffer, x, y, width, height):
        """
        Vuelca un buffer RGB565 ya armado por el usuario (ej. un
        ícono/sprite, o un framebuf.FrameBuffer propio con
        format=RGB565) en (x, y). `buffer` debe tener width*height*2
        bytes -- mismo contrato que la librería real.

        Ya no se copia primero a self._fb (no existe más) -- se lee
        directo del buffer del usuario fila por fila, y cada fila se
        escribe a stdout de inmediato (en vez de juntar todas las
        filas en una lista y un "".join() al final, que para un blit
        de pantalla completa -- ej. volcar una imagen de fondo --
        volvería a armar una string de 230KB en memoria, el mismo
        problema que _send_solid).

        Si self.rotation != 0, el CONTENIDO del buffer se rota antes
        de mandarlo (_rotate_buffer_content) y recién después se
        calcula dónde va físicamente (_logical_to_physical_rect) --
        en ese orden, porque el tamaño físico (pw, ph) depende de
        cómo quedó el buffer ya rotado, no del width/height lógico
        original. col_off/row_off son el desplazamiento dentro del
        buffer (ya rotado) cuando el recorte (_clip) movió el borde
        izquierdo/superior (ej. x físico negativo).
        """
        buf, bw, bh = self._rotate_buffer_content(buffer, width, height)
        px, py, pw, ph = self._logical_to_physical_rect(x, y, width, height)
        assert (pw, ph) == (bw, bh)  # misma matemática en ambos helpers

        clipped = self._clip(px, py, pw, ph)
        if not clipped:
            return
        cx, cy, cw, ch = clipped
        col_off = cx - px
        row_off = cy - py

        _sys.stdout.write("TFT:%d:%d:%dx%d:" % (cx, cy, cw, ch))
        for j in range(ch):
            row_start = ((row_off + j) * pw + col_off) * 2
            row_end = row_start + cw * 2
            _sys.stdout.write("".join("%02x" % b for b in buf[row_start:row_end]))
        _sys.stdout.write("\n")


class _St7789Module:
    ST7789 = ST7789
    color565 = staticmethod(color565)


# Se registra bajo los dos nombres de módulo más comunes en tutoriales
# ("st7789" de russhughes/st7789_mpy y "st7789py" de devbis/
# st7789py_mpy) -- la API pública que exponemos (constructor +
# métodos de dibujo + color565) es compatible con ambos para el
# subconjunto que soportamos (ver "Limitaciones conocidas" arriba).
_sys.modules["st7789"] = _St7789Module()
_sys.modules["st7789py"] = _St7789Module()