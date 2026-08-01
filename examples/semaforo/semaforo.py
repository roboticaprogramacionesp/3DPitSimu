from machine import Pin
from time import sleep
semaforo_g = Pin(18, Pin.OUT, value=0)
semaforo_y = Pin(19, Pin.OUT, value=0)
semaforo_r = Pin(23, Pin.OUT, value=0)
while True:
  semaforo_g.value(1)
  semaforo_y.value(0)
  semaforo_r.value(0)
  sleep(1)
  semaforo_g.value(0)
  semaforo_y.value(1)
  semaforo_r.value(0)
  sleep(1)
  semaforo_g.value(0)
  semaforo_y.value(0)
  semaforo_r.value(1)
  sleep(1)
