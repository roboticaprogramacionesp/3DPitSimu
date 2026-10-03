from machine import Pin

class SEG7:

  digits = {
    0: (1,1,1,1,1,1,0),
    1: (0,1,1,0,0,0,0),
    2: (1,1,0,1,1,0,1),
    3: (1,1,1,1,0,0,1),
    4: (0,1,1,0,0,1,1),
    5: (1,0,1,1,0,1,1),
    6: (1,0,1,1,1,1,1),
    7: (1,1,1,0,0,0,0),
    8: (1,1,1,1,1,1,1),
    9: (1,1,1,1,0,1,1)
  }

  def __init__(self, a, b, c, d, e, f, g, invert=False):

    self.pins = [
      Pin(a, Pin.OUT),
      Pin(b, Pin.OUT),
      Pin(c, Pin.OUT),
      Pin(d, Pin.OUT),
      Pin(e, Pin.OUT),
      Pin(f, Pin.OUT),
      Pin(g, Pin.OUT)
    ]

    self.invert = invert
    self.clear()

  def clear(self):

    for p in self.pins:
      p.value(0 if not self.invert else 1)

  def show(self, n):

    seg = self.digits.get(n, (0,0,0,0,0,0,0))

    for p, v in zip(self.pins, seg):

      if self.invert:
        p.value(1-v)
      else:
        p.value(v)
