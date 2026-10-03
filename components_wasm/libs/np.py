import framebuf
import neopixel
from machine import Pin
from ezFBmarquee import ezFBmarquee
import ezFBfont_4x6_latin_06 as font
from time import sleep

class NeoMatrix(framebuf.FrameBuffer):
  def __init__(self, pin, width, height, layout=0, rotation=0):

    self.rotation = rotation
    
    self.width = width
    self.height = height
    self.layout = layout

    self.n = width * height
    self.np = neopixel.NeoPixel(Pin(pin), self.n)

    self.buffer = bytearray(width * height * 2)

    super().__init__(self.buffer, width, height, framebuf.RGB565)

  def rotate(self, x, y):
    if self.rotation == 0:
      return x, y

    elif self.rotation == 90:
      return self.height - 1 - y, x

    elif self.rotation == 180:
      return self.width - 1 - x, self.height - 1 - y

    elif self.rotation == 270:
      return y, self.width - 1 - x

  def xy_to_index(self, x, y):
    if self.layout == 0:  # horizontal
      index = y * self.width + x
    elif self.layout == 1:  # horizontal zigzag
      if y % 2 == 0:
        index = y * self.width + x
      else:
        index = y * self.width + (self.width - 1 - x)
    elif self.layout == 2:  # vertical
      index = x * self.height + y
    elif self.layout == 3:  # vertical zigzag
      if x % 2 == 0:
        index = x * self.height + y
      else:
        index = x * self.height + (self.height - 1 - y)
    return index
  
  def show(self, brightness=0.1):
    buf = self.buffer
    np = self.np
    w = self.width

    h = self.height

    bright = brightness

    i = 0

    for y in range(h):
      for x in range(w):

        c = buf[i] | (buf[i+1] << 8)
        i += 2

        r = ((c >> 11) & 0x1F) * 255 // 31
        g = ((c >> 5) & 0x3F) * 255 // 63
        b = (c & 0x1F) * 255 // 31

        r = int(r * bright)
        g = int(g * bright)
        b = int(b * bright)

        x2, y2 = self.rotate(x, y)
        index = self.xy_to_index(x2, y2)

        np[index] = (r, g, b)

    np.write()


