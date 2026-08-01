# =============================================================
# PitSimulator — HAL DS3231 (RTC de alta precisión, I2C)
#
# Mismo criterio que mpu6050.hal.py/tcs34725.hal.py: se emula el MAPA
# DE REGISTROS REAL del chip (fijo por datasheet Maxim/Analog
# Devices, igual para CUALQUIER librería que hable con un DS3231 de
# verdad) contra el bus I2C compartido (_i2c_bus.py). Dirección FIJA
# 0x68 (sin pin ADDR, como el BMP180/TCS34725).
#
# ── Mapa de registros que se simula (datasheet real) ────────────
#   0x00  segundos   (BCD, 0-59)
#   0x01  minutos    (BCD, 0-59)
#   0x02  horas      (BCD, 0-23 -- siempre modo 24hs, bit6=0)
#   0x03  día de semana (binario, 1-7, no BCD -- cabe en un nibble)
#   0x04  día del mes (BCD, 1-31)
#   0x05  mes        (BCD, 1-12, bit7=siglo siempre en 0)
#   0x06  año        (BCD, 0-99, representa 2000+valor)
#   0x0F  status      -- bit7 (OSF, "el oscilador se detuvo") siempre
#                        en 0: para este simulador el reloj nunca
#                        "pierde la hora" por corte de energía
#   0x11  temperatura (MSB aprox, valor fijo 25 -- no se modela
#                      temperatura real, ver KY-001/DHT11 para eso)
#   cualquier otro registro (alarmas, control, etc.): lectura 0x00,
#   cualquier escritura se acepta y se ignora
#
# ── Por qué NO se usa el módulo time de MicroPython ──────────────
# Convertir epoch -> (año, mes, día, hora, min, seg, día-semana) acá
# abajo con aritmética propia (algoritmo de Howard Hinnant, dominio
# público, verificado contra 4 fechas de referencia conocidas) en vez
# de time.localtime()/gmtime(): evita depender de que el reloj
# interno de ESTE build de MicroPython/QEMU esté sincronizado con
# nada real -- la hora "de verdad" viaja siempre desde el navegador
# (que si sabe la hora real de la compu del usuario).
#
# ── Protocolo de entrada: "RTC:" ─────────────────────────────────
# El simulador manda un "RTC:<addr>:<epoch_segundos_utc>" apenas el
# HAL termina de cargar (ver signal.resync en ds3231.behavior.js) y
# de ahí en más solo ocasionalmente (re-sync de deriva cada 60s, o
# al ajustar la fecha/hora desde el panel de propiedades) -- NO cada
# segundo. Entre un "RTC:" y el siguiente, este archivo calcula la
# hora actual solo con time.ticks_ms() (ver _current_epoch()), sin
# depender de que llegue un mensaje nuevo a cada tick.
#
# ANTES mandaba uno por segundo sin parar -- BUG REAL confirmado
# (reportado como SyntaxError en bucle en el REPL): esas líneas
# "RTC:104:..." solo las consume poll_input(), que a su vez solo
# corre mientras HAY código de usuario ejecutándose (o el Timer de
# fondo, si logra armarse). En cuanto el firmware vuelve al prompt
# ">>>" (nada corriendo), CADA "RTC:" que llega se interpreta como
# si el usuario la hubiera tecleado -- de ahí el "SyntaxError:
# invalid syntax" repetido sin parar. Iba a pasar con cualquier
# protocolo que mande algo sin parar mientras el REPL está inactivo;
# la solución real es mandar poco (acá) en vez de intentar que el
# REPL inactivo "no se confunda" (no hay forma de lograr eso desde
# acá -- ver la nota grande en QemuBridge.send()/beginPasteLock()
# para el caso, relacionado pero distinto, de que esto corrompiera
# un paste en curso).
#
# "última muestra gana" por dirección, igual que el resto de los
# sensores I2C de este proyecto.
# =============================================================

import time

DS3231_ADDR = 0x68

_ds_epoch_base = None  # último epoch recibido vía "RTC:" ...
_ds_ticks_base = 0      # ... y el time.ticks_ms() de ESE momento

# Fallback razonable si todavía no llegó ningún "RTC:" (recién
# armado el circuito, antes de que el navegador mande el primer
# valor): 2025-01-01 00:00:00 UTC.
_DS_DEFAULT_EPOCH = 1735689600


def _on_rtc_line(parts):
    # parts = ["RTC", "<addr>", "<epoch>"]
    global _ds_epoch_base, _ds_ticks_base
    if len(parts) < 3:
        return
    try:
        _ds_epoch_base = int(parts[2])
    except ValueError:
        return
    _ds_ticks_base = time.ticks_ms()


register_line_handler("RTC:", _on_rtc_line)


def _current_epoch():
    if _ds_epoch_base is None:
        return _DS_DEFAULT_EPOCH
    elapsed_ms = time.ticks_diff(time.ticks_ms(), _ds_ticks_base)
    return _ds_epoch_base + elapsed_ms // 1000


def _to_bcd(n):
    return ((n // 10) << 4) | (n % 10)


def _civil_from_days(z):
    """
    Algoritmo de Howard Hinnant ("chrono-Compatible Low-Level Date
    Algorithms", dominio público) -- convierte días desde epoch
    (1970-01-01) a (año, mes, día) gregoriano, sin depender de
    time.*. Verificado contra 4 fechas de referencia conocidas antes
    de usarse acá.
    """
    z += 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    y = y + 1 if m <= 2 else y
    return y, m, d


def _build_time_bytes(epoch):
    days = epoch // 86400
    rem = epoch % 86400
    hour = rem // 3600
    minute = (rem % 3600) // 60
    second = rem % 60
    year, month, day = _civil_from_days(days)
    weekday_idx = (days + 4) % 7  # 0=domingo (1970-01-01 fue jueves)

    return bytes([
        _to_bcd(second),
        _to_bcd(minute),
        _to_bcd(hour),
        weekday_idx + 1,
        _to_bcd(day),
        _to_bcd(month),
        _to_bcd(year % 100),
    ])


def _on_read_mem(reg, nbytes):
    if 0x00 <= reg <= 0x06:
        data = _build_time_bytes(_current_epoch())
        start = reg - 0x00
        padded = data + bytes(nbytes)
        return padded[start : start + nbytes]

    if reg == 0x11:
        return bytes([25] * nbytes)

    # 0x0F (status/OSF) y cualquier otro registro no modelado: 0x00.
    return bytes(nbytes)


def _from_bcd(n):
    return ((n >> 4) * 10) + (n & 0x0F)


def _days_from_civil(y, m, d):
    """
    Inversa de _civil_from_days() -- mismo algoritmo de Howard
    Hinnant, verificado (junto con su ida y vuelta) contra 7 fechas
    de referencia conocidas (incluye límites de año bisiesto) antes
    de usarse acá.
    """
    y = y - 1 if m <= 2 else y
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _on_write_mem(reg, buf):
    # Escritura de hora (registros 0x00-0x06, BCD, igual mapa que
    # _on_read_mem/_build_time_bytes -- fijo por datasheet, no
    # depende de qué librería Python esté usando el firmware): se
    # decodifica y pasa a ser el nuevo "ancla" de tiempo, igual que
    # si hubiera llegado un "RTC:" con ese valor -- así el reloj
    # simulado sigue corriendo sola en tiempo real desde el valor que
    # el propio firmware acaba de poner (ej. rtc.datetime((...))),
    # tal como lo haría una pila real. Escrituras a otros registros
    # (alarmas, control, etc.) se siguen aceptando e ignorando.
    global _ds_epoch_base, _ds_ticks_base

    if reg != 0x00 or len(buf) < 7:
        return

    try:
        second = _from_bcd(buf[0])
        minute = _from_bcd(buf[1])
        hour = _from_bcd(buf[2])
        day = _from_bcd(buf[4])
        month = _from_bcd(buf[5])
        year = 2000 + _from_bcd(buf[6])
        days = _days_from_civil(year, month, day)
        epoch = days * 86400 + hour * 3600 + minute * 60 + second
    except Exception:
        return

    _ds_epoch_base = epoch
    _ds_ticks_base = time.ticks_ms()


register_i2c_device(DS3231_ADDR, on_read_mem=_on_read_mem, on_write_mem=_on_write_mem)
