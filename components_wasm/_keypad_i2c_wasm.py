# =============================================================
# PitSimulator — Teclado matricial 4x4 I2C (keypad4x4_i2c) para el
# runtime WASM
#
# Por qué esto no se resuelve con el mecanismo genérico I2CR:/I2CW:
# que ya usa _i2c_bus_wasm.py para el resto de sensores I2C:
# keypad4_i2c.py (la librería real, en libs/) hace writeto() (escanea
# una fila) seguido INMEDIATAMENTE de readfrom() (lee las columnas)
# DENTRO DE LA MISMA llamada sincrónica a mp.runPython() -- y ese
# protocolo depende de un viaje ida-y-vuelta por postMessage() entre
# el Worker y el hilo principal (ver el comentario grande en
# _i2c_bus_wasm.py y wasmWorker.js) que NO puede completarse
# mientras el Worker sigue corriendo Python de forma sincrónica.
# Confirmado en vivo: get_key() siempre devolvía None, sin importar
# qué tecla se apriete (0% de detección, no solo degradado).
#
# Arreglo: en vez de depender del viaje ida-y-vuelta, el estado de
# "qué tecla está apretada" se inyecta ACÁ, en Python, ANTES de que
# arranque cada corrida (ver wasmWorker.js, mensaje "run" ->
# _pit_apply_keypad_snapshot()), armado por WasmBridge.js leyendo
# component.keypadPressed del lado JS. Con eso ya adentro,
# writeto()/readfrom() resuelven TODO en Python puro sin ningún
# postMessage de por medio: writeto() ya actualiza _i2c_reg_out[addr]
# sincrónicamente (eso siempre funcionó, es local), así que el
# on_read() de acá abajo solo necesita leer ESE valor + el snapshot
# para calcular qué columnas quedan en bajo -- se registra como
# "on_read" de _i2c_bus_wasm.py (mismo mecanismo que ya usan otros
# sensores I2C) la primera vez que aparece una dirección nueva en un
# snapshot.
#
# ACTUALIZADO -- la limitación de arriba ("solo se ve la tecla si se
# aprieta ANTES de Ejecutar") quedó resuelta: WasmBridge.js ahora
# también empuja el snapshot por setGlobal (_pit_keypad_snapshot_live,
# ver setKeypadI2cLive()) cada vez que cambia qué teclas están
# apretadas, CON el script ya corriendo -- mismo mecanismo ya probado
# para IN: del teclado por GPIO (setGlobal nunca dispara
# mp.runPython(), así que es seguro llamarlo mientras el script
# principal está suspendido en su propio sleep()). _on_read() de abajo
# relee esa variable en cada lectura I2C en vez de depender solo del
# snapshot congelado al arrancar (_pit_apply_keypad_snapshot(), que
# sigue existiendo -- es lo que registra la dirección la primera vez).
# =============================================================

_pit_keypad_pressed_by_addr = {}
_pit_keypad_registered_addrs = set()
_pit_keypad_live_raw_seen = None


def _pit_parse_keypad_raw(raw):
    # Mismo formato ("<addr>=<fila,col>;...|<addr>=...") que
    # _pit_apply_keypad_snapshot() de más abajo -- separado acá porque
    # ahora lo usan DOS caminos (el snapshot inicial de cada corrida Y
    # el refresco en vivo de _pit_refresh_keypad_live()).
    result = {}
    if not raw:
        return result
    for part in raw.split("|"):
        if "=" not in part:
            continue
        addr_str, pairs = part.split("=", 1)
        try:
            addr = int(addr_str)
        except ValueError:
            continue
        pressed = set()
        for pair in pairs.split(";"):
            if pair:
                pressed.add(pair)
        result[addr] = pressed
    return result


def _pit_refresh_keypad_live():
    # Llamado al principio de cada _on_read() -- lee
    # _pit_keypad_snapshot_live (variable global, la escribe
    # WasmBridge.setKeypadI2cLive() por setGlobal, nunca por
    # mp.runPython()) y la compara contra la última vista para no
    # reparsear en cada llamada si no cambió nada. A diferencia de
    # _pit_apply_keypad_snapshot() (que solo corre UNA vez, al
    # arrancar cada corrida), esto se re-evalúa en CADA lectura I2C --
    # por eso una tecla apretada mientras el script ya está en su
    # propio while True: ahora sí se ve.
    global _pit_keypad_live_raw_seen

    raw = globals().get("_pit_keypad_snapshot_live")
    if raw is None or raw == _pit_keypad_live_raw_seen:
        return

    _pit_keypad_live_raw_seen = raw
    fresh = _pit_parse_keypad_raw(raw)

    # Direcciones ya registradas: se actualizan SIEMPRE (incluso a un
    # set() vacío si ya no hay nada apretado ahí -- si no, una tecla
    # soltada quedaría "pegada" para siempre).
    for addr in _pit_keypad_registered_addrs:
        _pit_keypad_pressed_by_addr[addr] = fresh.get(addr, set())

    # Direcciones nuevas que el snapshot inicial todavía no conocía
    # (ej. el teclado se construyó recién, el primer cambio en vivo es
    # lo primero que avisa de esta dirección).
    for addr, pressed in fresh.items():
        if addr in _pit_keypad_registered_addrs:
            continue
        _pit_keypad_registered_addrs.add(addr)
        _pit_keypad_pressed_by_addr[addr] = pressed
        register_i2c_device(addr, on_read=_pit_keypad_i2c_make_on_read(addr))

# Estado de escaneo por dirección: {addr: [ultimo output_byte visto, cantidad
# de on_read() consecutivos con ESE MISMO output_byte]} -- se reinicia cada
# vez que cambia el byte escrito (writeto), o sea, cada vez que el firmware
# pasa a escanear una fila distinta (set_row_low/set_row_high). Ver el porqué
# completo en _pit_keypad_i2c_make_on_read.
_pit_keypad_scan_state = {}


def _pit_keypad_i2c_make_on_read(addr):

    # Simula un "tap" (apretar y soltar), no una tecla mantenida.
    #
    # BUG REAL encontrado probando esto en vivo (primer intento,
    # "consumir en la primera lectura que matchee"): get_key()
    # (keypad4_i2c.py) llama a get_column_state(col) UNA VEZ POR
    # COLUMNA dentro del escaneo de una fila ("for col in range(4):
    # if not self.get_column_state(col): ..."), y cada una de esas
    # llamadas dispara un on_read() acá -- pero on_read() no sabe
    # qué columna le interesa al que llama (I2C solo devuelve EL
    # BYTE completo, no "qué bit vas a mirar"). Consumir apenas se
    # encuentra la tecla en el primer on_read() (disparado por la
    # columna 0, que ni siquiera es la que matchea) la soltaba ANTES
    # de que la columna correcta (ej. columna 1 para la tecla "5")
    # llegue a leerla -- resultado: nunca se detectaba nada.
    #
    # Arreglo real: en vez de contar "cuántas veces se leyó", se
    # cuenta la POSICIÓN del on_read() dentro del escaneo de la fila
    # actual (1er llamado, 2do, 3ro...) y se compara contra la
    # columna que realmente está presionada. get_key() siempre
    # prueba las columnas en orden 0,1,2,3 -- así que la tecla en la
    # columna K aparece "presionada" justo en el llamado número K+1,
    # y "suelta" en cualquier otro (incluido el K+2, que es
    # exactamente el que usa el while de espera-a-que-se-suelte para
    # salir solo, sin trabarse para siempre). Mismo criterio para
    # varias teclas apretadas a la vez en filas distintas: cada una
    # tiene su propia columna K, así que cada una dispara en SU
    # propio llamado número K+1 dentro del escaneo de SU fila.
    def _on_read():
        _pit_refresh_keypad_live()

        output_byte = _i2c_reg_out.get(addr, 0xFF)
        pressed = _pit_keypad_pressed_by_addr.get(addr)

        state = _pit_keypad_scan_state.setdefault(addr, {"byte": None, "count": 0})
        if state["byte"] != output_byte:
            state["byte"] = output_byte
            state["count"] = 0
        state["count"] += 1
        call_index = state["count"]  # 1-indexado, se reinicia por fila

        if not pressed:
            return 0xFF

        read_byte = output_byte
        for row in range(4):
            if ((output_byte >> row) & 1) != 0:
                continue
            for col in range(4):
                if call_index == col + 1 and ("%d,%d" % (row, col)) in pressed:
                    read_byte &= ~(1 << (4 + col))
        return read_byte & 0xFF

    return _on_read


def _pit_apply_keypad_snapshot(raw):
    # Formato: "<addr>=<fila,col>;<fila,col>|<addr>=..." -- texto
    # plano a propósito (sin json.loads) para no depender de que el
    # módulo "json" esté compilado en este build del puerto. Armado
    # del lado JS en WasmBridge.js, ver sendData(). Sigue corriendo
    # UNA vez por corrida (ver wasmWorker.js, mensaje "run") -- lo que
    # pase DESPUÉS, con el script ya corriendo, lo cubre
    # _pit_refresh_keypad_live() más arriba.
    _pit_keypad_pressed_by_addr.clear()
    _pit_keypad_scan_state.clear()
    for addr, pressed in _pit_parse_keypad_raw(raw).items():
        _pit_keypad_pressed_by_addr[addr] = pressed
        if addr not in _pit_keypad_registered_addrs:
            _pit_keypad_registered_addrs.add(addr)
            register_i2c_device(addr, on_read=_pit_keypad_i2c_make_on_read(addr))
