from machine import Pin, I2C
from sh1106 import SH1106_I2C
from ezFBfont import ezFBfont
#import ezFBfont_7x13B_latin_12
#import ezFBfont_10x20_full_20
import ezFBfont_10x20_latin_20
import framebuf, array
from icons_px import get_ch
from time import sleep


class OLED():
    def __init__(self, id=1, sda=21, scl=22, width=128, height=64, res=None, addr=0x3c, rotate=0):
        self._width = width
        self._height = height
        self._res = res
        self._addr = addr
        self._rotate = rotate
        try:
            self.i2c = I2C(id, sda=Pin(sda), scl=Pin(scl))
            self.oled = SH1106_I2C(width, height, self.i2c, res=res, addr=addr, rotate=rotate)
            #self.font1 = ezFBfont(self.oled, ezFBfont_7x13B_latin_12)
            #self.font1 = ezFBfont(self.oled, ezFBfont_10x20_full_20)
            self.font1 = ezFBfont(self.oled, ezFBfont_10x20_latin_20)
        except:
            print('No Oled')

    def rotate(self, angle=0):
        # angle must be 0, 90, 180 or 270
        # 0/180 and 90/270 are mirror pairs that share the same buffer
        # layout, but switching between the two families (e.g. 0 -> 90)
        # swaps width/height and the buffer format internally, so the
        # driver needs to be re-created to do it safely.
        if angle not in (0, 90, 180, 270):
            raise ValueError("angle must be 0, 90, 180 or 270")
        self._rotate = angle
        self.oled = SH1106_I2C(self._width, self._height, self.i2c,
                                res=self._res, addr=self._addr, rotate=angle)
        self.oled.fill(0)
        self.oled.show()

    def icon(self, img, x, y, w, h, s):
        buffer = bytearray(img)
        fb = framebuf.FrameBuffer(buffer, w, h, framebuf.MONO_HLSB)
        if s == 0:
            fb.fill(0)
        self.oled.blit(fb, x, y)
        self.oled.show()

    def get_scaled_icon(self, buffer, scale=1):
        icon_data = bytearray(buffer)
        width = 12
        height = 12
        fb_orig = framebuf.FrameBuffer(icon_data, width, height, framebuf.MONO_HLSB)
        scaled_width = width * scale
        scaled_height = height * scale
        row_bytes = (scaled_width + 7) // 8
        scaled_buf = bytearray(row_bytes * scaled_height)
        fb_scaled = framebuf.FrameBuffer(scaled_buf, scaled_width, scaled_height, framebuf.MONO_HLSB)
        for y in range(height):
            for x in range(width):
                color = fb_orig.pixel(x, y)
                for dy in range(scale):
                    for dx in range(scale):
                        fb_scaled.pixel(x * scale + dx, y * scale + dy, color)
        return scaled_buf, scaled_width, scaled_height

    # Metodo para mostrar el icono en pantalla
    def icon2(self, memory, x=0, y=0, scale=1):
        icon_bytes = bytearray(get_ch(memory)[0])
        scaled_buf, w, h = self.get_scaled_icon(icon_bytes, scale)
        fb = framebuf.FrameBuffer(scaled_buf, w, h, framebuf.MONO_HLSB)
        self.oled.blit(fb, x, y)
        self.oled.show()

    def text(self, text="", x=0, y=0, s=1):
        self.oled.text(text, x, y, s)
        self.oled.show()

    def text20(self, text="", x=0, y=0, s=1):
        self.font1.write(text, x, y)
        self.oled.show()

    def clear(self):
        self.oled.fill(0)
        self.oled.show()

    def pixel(self, x, y):
        return self.oled.pixel(x, y)

    def contrast(self, bright):
        self.oled.contrast(bright)

    def line(self, x, y, x1, y1, s):
        self.oled.line(x, y, x1, y1, s)
        self.oled.show()

    def rect(self, x, y, x1, y1, s):
        self.oled.rect(x, y, x1, y1, s)
        self.oled.show()

    def fill_rect(self, x, y, x1, y1, s):
        self.oled.fill_rect(x, y, x1, y1, s)
        self.oled.show()

    def set_pixel(self, x, y, s):
        self.oled.pixel(x, y, s)
        self.oled.show()

    def hline(self, x, y, length, s):
        self.oled.hline(x, y, length, s)
        self.oled.show()

    def vline(self, x, y, length, s):
        self.oled.vline(x, y, length, s)
        self.oled.show()

    def circle(self, x, y, r, s):
        self.oled.ellipse(x, y, r, r, s)
        self.oled.show()

    def ellipse(self, x, y, w, h, s):
        self.oled.ellipse(x, y, w, h, s)
        self.oled.show()

    def scroll(self, dx, dy):
        self.oled.scroll(dx, dy)
        self.oled.show()

    def poly(self, fig, x, y, s, f):
        vertices = array.array('h', fig)
        self.oled.poly(x, y, vertices, s, f)
        self.oled.show()

    def poweroff(self):
        self.oled.poweroff()

    def poweron(self):
        self.oled.poweron()
