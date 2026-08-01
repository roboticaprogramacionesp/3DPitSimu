# =============================================================
# PitSimulator — HAL RC522 (RFID 13.56MHz, SPI a nivel de registros)
# Idéntico a components/rc522/rc522.hal.py (mismo circuito real,
# 'rc522_real' solo cambia el aspecto visual -- ver ese archivo para
# el detalle completo del mapa de registros MFRC522 emulado).
# =============================================================

import sys as _sys


class _MFRC522Registers:

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

    def _read_register(self, reg):
        if reg == 0x04:  # CommIrqReg
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
        sent = self._request_fifo
        self._request_fifo = []
        card = self.current_uid

        if len(sent) == 1 and sent[0] in (0x26, 0x52):
            if card is not None:
                self._response_ready = True
                self._response_fifo = [0x04, 0x00]
            else:
                self._response_ready = False
                self._response_fifo = []
        elif len(sent) == 2 and sent[0] in (0x93, 0x95, 0x97) and sent[1] == 0x20:
            if card is not None:
                self._response_ready = True
                bcc = card[0] ^ card[1] ^ card[2] ^ card[3]
                self._response_fifo = [card[0], card[1], card[2], card[3], bcc]
            else:
                self._response_ready = False
                self._response_fifo = []
        elif len(sent) >= 7 and sent[0] in (0x93, 0x95, 0x97) and sent[1] == 0x70:
            if card is not None:
                self._response_ready = True
                self._response_fifo = [0x08, 0x00, 0x00]
            else:
                self._response_ready = False
                self._response_fifo = []
        else:
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
