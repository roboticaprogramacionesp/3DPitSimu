from machine import Pin
import dht
from time import sleep
dht4 = dht.DHT11(Pin(4))
while True:
  dht4.measure()
  sleep(1)
  print(dht4.temperature())
  print(dht4.humidity())