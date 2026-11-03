# =============================================================
# PitSimulator — HAL DFPlayer Mini (reproductor MP3 por UART)
# No necesita su propia clase "UART" -- igual que hc-06.hal.py/
# gps.hal.py, ese reemplazo ya vive siempre en _uart_bus_wasm.py
# (se inyecta siempre, tengas o no un componente UART en el
# lienzo). La libreria real mp3_player.py (ver
# components_wasm/libs/bundle.json, clave "mp3_player") solo
# ESCRIBE comandos (protocolo de 8 bytes: 0x7E/0xFF/0x06/cmd/
# 0x00/hbyte/lbyte/0xEF) -- nunca lee una respuesta del modulo,
# asi que no hace falta simular nada bidireccional como con el
# HC-06 (no hay "telefono virtual" para el DFPlayer).
# Este archivo existe solo como marcador, igual que bocina.hal.py.
# =============================================================
