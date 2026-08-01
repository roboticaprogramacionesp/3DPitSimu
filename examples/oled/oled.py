from oled import OLED
oled = OLED(id=1, sda=21, scl=22)
oled.text('Hola', 0, 0, 1)
oled.text20('Texto', 0, 20)