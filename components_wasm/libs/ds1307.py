# system packages
from machine import I2C
try:
    from micropython import const
except ImportError:
    def const(x):
        return x


class _Subscriptable():
    def __getitem__(self, item):
        return None


_subscriptable = _Subscriptable()

Optional = _subscriptable
Tuple = _subscriptable

DATETIME_REG = const(0)     # 0x00-0x06
CHIP_HALT = const(128)
CONTROL_REG = const(7)      # 0x07
RAM_REG = const(8)          # 0x08-0x3F


class DS1307(object):
    def __init__(self, addr=0x68, i2c: Optional[I2C] = None) -> None:
        self._addr = addr

        if i2c is None:
            # default assignment, check the docs
            self._i2c = I2C(0)
        else:
            self._i2c = i2c

        self._weekday_start = 0
        self._halt = False

    @property
    def addr(self) -> int:
        return self._addr

    @property
    def weekday_start(self) -> int:
        return self._weekday_start

    @weekday_start.setter
    def weekday_start(self, value: int) -> None:
        if 0 <= value <= 6:
            self._weekday_start = value
        else:
            raise ValueError("Weekday can only be in range 0-6")

    @property
    def datetime(self) -> Tuple[int, int, int, int, int, int, int, int]:
        buf = bytearray(7)

        buf = self._i2c.readfrom_mem(self._addr, DATETIME_REG, 7)

        year = self._bcd_to_dec(buf[6]) + 2000
        month = self._bcd_to_dec(buf[5])
        day = self._bcd_to_dec(buf[4])
        yearday = self.day_of_year(year=year, month=month, day=day)
        return (
            year,
            month,
            day,
            self._bcd_to_dec(buf[2]),           # hour
            self._bcd_to_dec(buf[1]),           # minute
            self._bcd_to_dec(buf[0] & 0x7F),    # second
            self._bcd_to_dec(buf[3] - self._weekday_start),     # weekday
            yearday,
        )

    @datetime.setter
    def datetime(self, datetime: Tuple[int, int, int, int, int, int, int, int]) -> None:    # noqa: E501
        buf = bytearray(7)

        # msb = CH, 1 = halt, 0 = go
        buf[0] = self._dec_to_bcd(datetime[5]) & 0x7F   # second
        buf[1] = self._dec_to_bcd(datetime[4])  # minute
        buf[2] = self._dec_to_bcd(datetime[3])  # hour
        buf[3] = self._dec_to_bcd(datetime[6] + self._weekday_start)
        buf[4] = self._dec_to_bcd(datetime[2])  # day
        buf[5] = self._dec_to_bcd(datetime[1])  # month
        buf[6] = self._dec_to_bcd(datetime[0] - 2000)   # year

        if (self._halt):
            buf[0] |= (1 << 7)

        self._i2c.writeto_mem(self._addr, DATETIME_REG, buf)

    @property
    def year(self) -> int:
        return self.datetime[0]

    @property
    def month(self) -> int:
        return self.datetime[1]

    @property
    def day(self) -> int:
        return self.datetime[2]

    @property
    def hour(self) -> int:
        return self.datetime[3]

    @property
    def minute(self) -> int:
        return self.datetime[4]

    @property
    def second(self) -> int:
        return self.datetime[5]

    @property
    def weekday(self) -> int:
        return self.datetime[5]

    @property
    def yearday(self) -> int:
        return self.datetime[7]

    def is_leap_year(self, year: int) -> bool:
        return (year % 4 == 0)

    def day_of_year(self, year: int, month: int, day: int) -> int:
        month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        year -= 2000
        days16 = day

        for x in range(1, month):
            days16 += month_days[x - 1]

        if month >= 2 and self.is_leap_year(year=year):
            days16 += 1

        return days16

    @property
    def halt(self) -> bool:
        return self._halt

    @halt.setter
    def halt(self, value: bool = False) -> None:
        reg = self._i2c.readfrom_mem(self._addr, DATETIME_REG, 1)[0]

        if value:
            reg |= CHIP_HALT
        else:
            reg &= ~CHIP_HALT

        self._halt = bool(value)
        self._i2c.writeto_mem(self._addr, DATETIME_REG, bytearray([reg]))

    def square_wave(self, sqw: int = 0, out: int = 0) -> None:
        if sqw not in (0, 1, 4, 8, 32):
            raise ValueError(
                "Squarewave can be set to 0Hz, 1Hz, {}Hz, {}Hz or {}Hz".format(
                    2 ** 12, 2 ** 13, 2 ** 15)
            )

        rs0 = 1 if sqw == 4 or sqw == 32 else 0
        rs1 = 1 if sqw == 8 or sqw == 32 else 0
        out = 1 if out > 0 else 0
        sqw = 1 if sqw > 0 else 0

        reg = rs0 | rs1 << 1 | sqw << 4 | out << 7

        self._i2c.writeto_mem(self._addr, CONTROL_REG, bytearray([reg]))

    def _dec_to_bcd(self, value: int) -> int:
        return (value // 10) << 4 | (value % 10)

    def _bcd_to_dec(self, value: int) -> int:
        return ((value >> 4) * 10) + (value & 0x0F)
