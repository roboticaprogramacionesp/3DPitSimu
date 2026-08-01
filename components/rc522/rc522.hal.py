# =============================================================
# PitSimulator — HAL RC522 (RFID 13.56MHz, SPI a nivel de registros)
#
# A diferencia de I2C/ADC (donde el "dummy" solo necesita responder
# con UN valor por pin, sin estado), el driver real de MFRC522 hace
# transacciones SPI de VERDAD a nivel de REGISTRO del chip (escribe
# comandos, sondea flags de IRQ, drena un FIFO byte a byte) -- para
# que un driver real de MicroPython (no una versión simplificada
# nuestra) funcione tal cual, hay que emular ese protocolo de
# registros, no solo "aceptar cualquier cosa" como hace el SPI dummy
# de tft_st7789.hal.py.
#
# Esta emulación fue construida y VERIFICADA (offline, fuera de
# QEMU) contra el archivo mfrc522.py real que se usó para este
# proyecto -- incluye dos bugs reales de ese driver (usa "~" en vez
# de "not" en dos chequeos) que en la práctica no rompen nada (uno
# de los dos, `~(n&0x01)`/`~(n&wait_irq)` encadenados con "and",
# terminan comportándose como si fuera `n & wait_irq` por doble
# negación) pero hay que respetarlos tal cual para que el loop de
# espera de IRQ corte en el momento correcto.
#
# ── LIMITACIÓN CONOCIDA ──────────────────────────────────────────
# Igual que tft_st7789.hal.py, esto REEMPLAZA machine.SPI entero (no
# lo envuelve) -- si en el mismo circuito hay un RC522 Y una pantalla
# TFT ST7789 a la vez, el que cargue su HAL último "gana" el
# machine.SPI, y el otro deja de funcionar. No hay bus SPI compartido
# real en este proyecto todavía (cada componente SPI arma su propio
# reemplazo completo) -- si necesitás los dos a la vez, avisá.
#
# ── Protocolo "RFID:" (simulador → firmware) ────────────────────
# El navegador manda "RFID:<uid_hex8>\n" (ej. "RFID:AABBCCDD") cuando
# el usuario clickea/"tapea" una tarjeta en el canvas, o "RFID:NONE"
# cuando se saca (o se tapea otra, lo que destapa la anterior). Acá
# se guarda en _regs.current_uid, que es lo que la emulación de
# registros usa para decidir si un request()/anticoll()/select()
# "encuentra" una tarjeta o no.
#
# Uso en código del usuario (idéntico al real):
#   from machine import Pin, SPI
#   from mfrc522 import MFRC522
#   rdr = MFRC522(sck=18, mosi=23, miso=19, rst=22, cs=5)
#   while True:
#       (stat, tag_type) = rdr.request(rdr.REQIDL)
#       if stat == rdr.OK:
#           (stat, uid) = rdr.SelectTagSN()
#           if stat == rdr.OK:
#               print("UID:", rdr.tohexstring(uid))
# =============================================================

import sys as _sys


class _MFRC522Registers:
    """
    Estado interno del chip emulado -- un FIFO de "bytes salientes"
    (lo que el driver escribió antes de disparar Transceive/CalcCRC),
    un FIFO de "bytes entrantes" (lo que la "tarjeta" responde,
    preparado en _prepare_response() según qué comando se detectó) y
    el UID de la tarjeta actualmente "tapeada" (None = ninguna).
    """

    def __init__(self):
        self._pending_write_reg = None
        self._pending_read_reg = None
        self._request_fifo = []
        self._response_fifo = []
        self._response_ready = False
        self.current_uid = None

    def handle_write_byte(self, byte):
        if self._pending_write_reg is not None:
            self._write_register(self._pending_write_reg, byte)
            self._pending_write_reg = None
            return
        is_read = bool(byte & 0x80)
        reg = (byte >> 1) & 0x3F
        if is_read:
            self._pending_read_reg = reg
        else:
            self._pending_write_reg = reg

    def handle_read_byte(self):
        reg = self._pending_read_reg
        self._pending_read_reg = None
        return self._read_register(reg)

    def _write_register(self, reg, value):
        if reg == 0x01:  # CommandReg
            if value == 0x0C:  # Transceive -- "mandar a la tarjeta"
                self._prepare_response()
            elif value == 0x0F:  # SoftReset
                self._request_fifo = []
        elif reg == 0x09:  # FIFODataReg (escritura = acumular byte saliente)
            self._request_fifo.append(value & 0xFF)
        elif reg == 0x0A:  # FIFOLevelReg, bit 0x80 = FlushBuffer
            if value & 0x80:
                self._request_fifo = []
        # el resto (ComIEnReg, BitFramingReg, TModeReg, etc.) es
        # configuración pura que este driver nunca vuelve a leer --
        # no hace falta simular nada más.

    def _read_register(self, reg):
        if reg == 0x04:  # CommIrqReg
            # 0x30 = RxIRq|IdleIRq (wait_irq de Transceive) -- corta el
            # loop de espera del driver enseguida. Sumamos 0x01
            # (TimerIRq) cuando NO hay tarjeta para que ADEMÁS dispare
            # NOTAGERR al toque, en vez de esperar el timeout completo
            # de 2000 iteraciones (que también funcionaría, solo que
            # más lento).
            return 0x30 if self._response_ready else 0x31
        if reg == 0x05:  # DivIrqReg -- CRCIrq siempre "listo"
            return 0x04
        if reg == 0x06:  # ErrorReg -- sin errores nunca
            return 0x00
        if reg == 0x09:  # FIFODataReg (lectura = drenar byte entrante)
            if self._response_fifo:
                return self._response_fifo.pop(0)
            return 0x00
        if reg == 0x0A:  # FIFOLevelReg -- cuántos bytes quedan por leer
            return len(self._response_fifo)
        if reg == 0x0C:  # ControlReg -- RxLastBits=0 (bytes completos)
            return 0x00
        if reg == 0x14:  # TxControlReg
            return 0x00
        if reg in (0x21, 0x22):  # CRCResultRegL/H -- no se valida en ningún lado
            return 0x00
        return 0x00

    def _prepare_response(self):
        """
        Se llama cuando el driver dispara Transceive (CommandReg=0x0C)
        -- mira qué bytes acumuló en _request_fifo para decidir qué
        FASE de la conversación con la tarjeta es (REQA, anticolisión,
        o selección) y arma la respuesta correspondiente, tomada del
        UID actualmente "tapeado" (self.current_uid).
        """
        sent = self._request_fifo
        self._request_fifo = []
        card = self.current_uid

        if len(sent) == 1 and sent[0] in (0x26, 0x52):
            # request(REQIDL/REQALL) -- responde ATQA (Mifare Classic 1K típico)
            if card is not None:
                self._response_ready = True
                self._response_fifo = [0x04, 0x00]
            else:
                self._response_ready = False
                self._response_fifo = []
        elif len(sent) == 2 and sent[0] in (0x93, 0x95, 0x97) and sent[1] == 0x20:
            # anticoll() -- responde 4 bytes de UID + BCC (XOR de los 4)
            if card is not None:
                self._response_ready = True
                bcc = card[0] ^ card[1] ^ card[2] ^ card[3]
                self._response_fifo = [card[0], card[1], card[2], card[3], bcc]
            else:
                self._response_ready = False
                self._response_fifo = []
        elif len(sent) >= 7 and sent[0] in (0x93, 0x95, 0x97) and sent[1] == 0x70:
            # PcdSelect() -- responde SAK (0x08 = Mifare Classic 1K, sin cascada) + 2 bytes
            if card is not None:
                self._response_ready = True
                self._response_fifo = [0x08, 0x00, 0x00]
            else:
                self._response_ready = False
                self._response_fifo = []
        else:
            # Comando no reconocido (ej. MFAuthent, que usa CommandReg
            # 0x0E, no 0x0C -- no debería llegar acá) -- responder "nada".
            self._response_ready = False
            self._response_fifo = []


_regs = _MFRC522Registers()


def _on_rfid_line(parts):
    if len(parts) < 2:
        return
    val = parts[1].strip()
    if val == "NONE" or val == "":
        _regs.current_uid = None
        return
    try:
        uid_int = int(val, 16)
    except ValueError:
        return
    _regs.current_uid = [
        (uid_int >> 24) & 0xFF,
        (uid_int >> 16) & 0xFF,
        (uid_int >> 8) & 0xFF,
        uid_int & 0xFF,
    ]


register_line_handler("RFID:", _on_rfid_line)


class SPI:
    """
    Reemplaza a machine.SPI -- a diferencia del dummy "ignora todo"
    de tft_st7789.hal.py, acá SÍ hace falta responder de verdad a
    nivel de byte (ver _MFRC522Registers arriba), porque el driver
    real de MFRC522 depende de leer valores de registro específicos
    para decidir cuándo hay/no hay tarjeta.
    """

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def init(self, *args, **kwargs):
        pass

    def deinit(self):
        pass

    def write(self, buf):
        for b in buf:
            _regs.handle_write_byte(b)

    def read(self, nbytes, write=0x00):
        return bytes(_regs.handle_read_byte() for _ in range(nbytes))

    def readinto(self, buf, write=0x00):
        for i in range(len(buf)):
            buf[i] = _regs.handle_read_byte()

    def write_readinto(self, write_buf, read_buf):
        for i in range(len(write_buf)):
            _regs.handle_write_byte(write_buf[i])
        for i in range(len(read_buf)):
            read_buf[i] = _regs.handle_read_byte()


import machine as _machine_module
_machine_module.SPI = SPI
