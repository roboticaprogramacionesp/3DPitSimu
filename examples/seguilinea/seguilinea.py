from machine import Pin
from time import sleep
linea = None
ir4 = Pin(4, Pin.IN, None)
while True:
  linea = ir4.value()
  print(linea)
  sleep(1)