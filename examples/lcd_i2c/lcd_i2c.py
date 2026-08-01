from machine import Pin, I2C
from i2c_lcd import I2cLcd
lcd_i2c = I2cLcd(id=1,sda=21,scl=22, i2c_addr=0x3f, num_lines=2, num_columns=16)
lcd_i2c.putstr('ESP32')
