from machine import Pin, I2C
from keypad4_i2c import Keypad4x4_I2C
from machine import Pin, I2C
from i2c_lcd import I2cLcd
from time import sleep

key = None


i2c = I2C(1, sda=Pin(21), scl=Pin(22))
teclado_4x4_i2c = Keypad4x4_I2C(i2c, 0x20)

lcd_i2c = I2cLcd(id=1,sda=21,scl=22, i2c_addr=0x3f, num_lines=2, num_columns=16)
while True:
  key = teclado_4x4_i2c.get_key()
  if key:
    lcd_i2c.putstr(key)
  sleep(0.1)
