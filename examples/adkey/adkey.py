from machine import Pin, ADC
from time import sleep
key = None
adkey=ADC(Pin(4))
adkey.atten(ADC.ATTN_11DB)
adkey.width(ADC.WIDTH_10BIT)
while True:
  key = adkey.read()
  print(key)
  if key >= 0 and key < 150:
    print('Enter')
  if key >= 150 and key < 300:
    print('Derecha')
  if key >= 350 and key < 550:
    print('Izquierda')
  if key >= 550 and key < 750:
    print('Abajo')
  if key >= 750 and key < 900:
    print('Arriba')
  sleep(1)