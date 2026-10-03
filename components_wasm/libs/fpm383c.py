import time
from machine import UART
import struct

class FPM383C:
    def __init__(self, uart=2, tx=17, rx=16, baud=57600):
        self.uart = UART(uart, baudrate=baud, tx=tx, rx=rx)

    def write_cmd(self, cmd):
        self.uart.write(cmd)
        time.sleep(0.05)

    def read_cmd(self, timeout=800):
        start = time.ticks_ms()
        data = b""
        while time.ticks_diff(time.ticks_ms(), start) < timeout:
            chunk = self.uart.read()
            if chunk:
                data += chunk
        return data

    def build_cmd(self, instruction, params=b""):
        header = b"\xEF\x01"
        addr = b"\xFF\xFF\xFF\xFF"
        packet_type = b"\x01"

        length = len(params) + 3
        body = packet_type + struct.pack(">H", length) + bytes([instruction]) + params
        checksum = sum(body) & 0xFFFF

        return header + addr + body + struct.pack(">H", checksum)

    def get_status(self, resp):
        if len(resp) >= 10:
            return resp[9]
        return None
    
    def read_sysparam(self):
        cmd = self.build_cmd(0x0F)
        self.write_cmd(cmd)
        resp = self.read_cmd()

        if len(resp) >= 28 and resp[9] == 0x00:
            capacity = (resp[14] << 8) | resp[15]
            security = (resp[16] << 8) | resp[17]
            return capacity, security

        return None
    
    def wait_finger(self, timeout=5000):
        start = time.ticks_ms()
        while time.ticks_diff(time.ticks_ms(), start) < timeout:
            r = self.gen_img()
            if r and self.get_status(r) == 0x00:
                return True
        return False

    def led(self, color=2):
        params = bytes([3, color, color, 1])
        cmd = self.build_cmd(0x3C, params)
        self.write_cmd(cmd)
        return self.read_cmd()

    def empty_database(self):
        cmd = self.build_cmd(0x0D)
        self.write_cmd(cmd)
        return self.read_cmd()

    def delete_model(self, fid):
        params = struct.pack(">HH", fid, 1)
        cmd = self.build_cmd(0x0C, params)
        self.write_cmd(cmd)
        return self.read_cmd()

    def get_template_count(self):
        cmd = b"\xEF\x01\xFF\xFF\xFF\xFF\x01\x00\x03\x1D\x00\x21"
        self.write_cmd(cmd)
        resp = self.read_cmd()

        if len(resp) >= 12:
            return (resp[10] << 8) | resp[11]
        return 0

    def gen_img(self):
        cmd = self.build_cmd(0x01)
        self.write_cmd(cmd)
        return self.read_cmd()

    def img2tz(self, buf_id):
        cmd = self.build_cmd(0x02, bytes([buf_id]))
        self.write_cmd(cmd)
        return self.read_cmd()

    def reg_model(self):
        cmd = self.build_cmd(0x05)
        self.write_cmd(cmd)
        return self.read_cmd()

    def store(self, buf_id, fid):
        params = bytes([buf_id]) + struct.pack(">H", fid)
        cmd = self.build_cmd(0x06, params)
        self.write_cmd(cmd)
        return self.read_cmd()

    def search(self, buf_id=1):
        params = bytes([buf_id]) + struct.pack(">HH", 0, 200)
        cmd = self.build_cmd(0x04, params)
        self.write_cmd(cmd)
        resp = self.read_cmd()

        if len(resp) >= 16 and resp[9] == 0x00:
            fid = (resp[10] << 8) | resp[11]
            score = (resp[12] << 8) | resp[13]
            return True, fid, score

        return False, None, None

    def finger_exists(self, retries=3):
        for i in range(retries):
            if not self.wait_finger():
                continue

            if self.get_status(self.img2tz(1)) != 0x00:
                continue

            found, fid, score = self.search()
            if found:
                return True, fid
        return False, None
    
    def blink(self, color, times=2, delay=0.2):
        for _ in range(times):
            self.led(color)
            time.sleep(delay)
            self.led(0)
            time.sleep(delay)
        
    def enroll_safe(self, fid, repeat=2):
        self.led(0)
        for i in range(repeat):
            # 👉 Esperando dedo
            self.blink(1)  # azul
            print("Pon tu dedo...")

            if not self.wait_finger():
                self.led(4)  # rojo
                print("Timeout dedo")
                return False

            # 👉 Leyendo
            self.led(6)  # amarillo
            print("Capturando", i+1)

            if self.get_status(self.img2tz(1 if i == 0 else 2)) != 0x00:
                self.led(4)  # rojo
                print("Error al convertir imagen")
                return False

            # 👉 Quitar dedo
            self.led(3)  # cyan o morado
            print("Quita el dedo...")
            time.sleep(1.5)

        # 👉 Procesando modelo
        self.led(6)  # amarillo
        print("Procesando...")

        if self.get_status(self.reg_model()) != 0x00:
            self.led(4)  # rojo
            print("Error al crear modelo")
            return False

        if self.get_status(self.store(1, fid)) != 0x00:
            self.led(4)  # rojo
            print("Error al guardar")
            return False

        # 👉 Éxito
        self.led(2)  # verde
        print("Guardado en ID:", fid)
        return True

    def enroll_safe2(self, fid, repeat=3):
        for i in range(repeat):
            self.led(6) #amarillo
            print("Captura", i+1)

            if not self.wait_finger():
                self.led(4) #rojo
                print("Timeout dedo")
                return False

            if self.get_status(self.img2tz(1 if i == 0 else 2)) != 0x00:
                return False
            self.led(3) #cyan 
            print("Quita dedo...")
            time.sleep(1.5)

        if self.get_status(self.reg_model()) != 0x00:
            return False

        if self.get_status(self.store(1, fid)) != 0x00:
            return False
        self.led(2) #verde
        print("Guardado en ID:", fid)
        return True
