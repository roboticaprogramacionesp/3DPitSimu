from machine import Pin, I2C
from time import sleep

class Keypad4x4_I2C:
    def __init__(self, i2c, address=0x20, rows=[0,1,2,3], cols=[4,5,6,7]):
        self.i2c = i2c
        self.address = address
        self.rows = rows
        self.cols = cols
        
        self.keys = [
            ['1', '2', '3', 'A'],
            ['4', '5', '6', 'B'],
            ['7', '8', '9', 'C'],
            ['*', '0', '#', 'D']
        ]

    def write_byte(self, value):
        self.i2c.writeto(self.address, bytearray([value]))

    def read_byte(self):
        return self.i2c.readfrom(self.address, 1)[0]

    def set_row_high(self, row):
        # Release all rows back to idle (all lines high, none asserted).
        self.write_byte(0xFF)

    def set_row_low(self, row):
        self.write_byte(0xFF ^ (1 << self.rows[row]))

    def get_column_state(self, col):
        return bool(self.read_byte() & (1 << self.cols[col]))

    def get_key(self):
        key = None

        for row in range(4):
            self.set_row_low(row)

            for col in range(4):
                if not self.get_column_state(col):
                    key = self.keys[row][col]

                    # Espera a que suelten la tecla
                    while not self.get_column_state(col):
                        sleep(0.01)

            self.set_row_high(row)

        return key