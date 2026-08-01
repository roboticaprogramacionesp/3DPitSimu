from machine import Pin
from lcd import CharLCD
lcd = CharLCD(rs=12,en=13,d4=5,d5=23,d6=19,d7= 18, cols=16, rows=2)
lcd.message('ESP32')