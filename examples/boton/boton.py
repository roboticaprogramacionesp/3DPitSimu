from machine import Pin
from time import sleep
contador = None
btn = None
btn_4 = Pin(4, Pin.IN)
contador = 0
while True:
  btn = btn_4.value()
  print(btn)
  if btn:
    contador = (contador if isinstance(contador, int) else 0) + 1
    print(contador)
  sleep(1)