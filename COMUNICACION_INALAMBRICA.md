# Comunicación inalámbrica con tu ESP32 simulado

PitSimulator permite probar tres formas de comunicación inalámbrica con
código MicroPython real, sin necesitar hardware físico:

- **ESP-NOW** — dos ESP32 hablando directo entre sí.
- **WiFi / Internet** — tu ESP32 mandando y recibiendo datos de internet de verdad.
- **Bluetooth (BLE)** — tu ESP32 hablando con un "teléfono virtual" dentro de la app.

Las tres usan las mismas librerías de MicroPython que usarías en una
placa real — el código que escribís acá funciona igual en un ESP32 físico
(con la excepción de WiFi: el `connect()` es simulado, ver más abajo).

---

## 1. ESP-NOW — dos ESP32 hablándose entre sí

Agregá **dos** componentes "ESP32 WeMos D1" al lienzo y dale "▶ Simular".
Si hay 2 o más ESP32, va a aparecer un selector arriba del panel REPL
para elegir cuál estás mirando/editando.

### Averiguar la MAC de un ESP32

Hacé clic en el ESP32 en el lienzo — el panel de propiedades (derecha)
muestra su MAC (`AA:BB:CC:DD:EE:FF`). También podés leerla desde código:

```python
import network
sta = network.WLAN(network.WLAN.IF_STA)
sta.active(True)
print("Mi MAC:", sta.config("mac").hex())
```

### Receptor (código para el ESP32 que va a recibir)

```python
import network, espnow

sta = network.WLAN(network.WLAN.IF_STA)
sta.active(True)

e = espnow.ESPNow()
e.active(True)

def on_recv(e):
    mac, msg = e.recv()
    print("Recibido de", mac.hex(), ":", msg)

e.irq(on_recv)
print("Escuchando...")
```

### Emisor (código para el otro ESP32 — cambiá el selector de dispositivo primero)

```python
import network, espnow

sta = network.WLAN(network.WLAN.IF_STA)
sta.active(True)

e = espnow.ESPNow()
e.active(True)

peer = bytes.fromhex("AABBCCDDEEFF")  # la MAC del receptor, SIN los ":"
e.add_peer(peer)
e.send(peer, "Hola!")
print("Enviado")
```

**Importante**: si cambiás al dispositivo receptor DESPUÉS de que le llegó
el mensaje, el `print()` de `on_recv` ya pasó mientras no lo estabas
mirando — no vas a verlo retroactivamente en la terminal. Para confirmar
que llegó, consultá el estado desde tu propio código (ej. guardando los
mensajes en una lista y revisándola después).

---

## 2. WiFi / Internet — peticiones HTTP reales

```python
import network, time, requests

wlan = network.WLAN(network.WLAN.IF_STA)
wlan.active(True)
wlan.connect("CualquierNombre", "CualquierClave")  # esto SIEMPRE "funciona"

while not wlan.isconnected():
    time.sleep(0.1)

print("Conectado! IP:", wlan.ifconfig()[0])
```

`wlan.connect(...)` es **100% simulado** — no hay ninguna red WiFi real
de por medio, así que podés poner cualquier nombre/clave y siempre
"conecta". Pero las peticiones que hagas DESPUÉS **sí son reales**, van a
internet de verdad:

```python
import requests

r = requests.get("https://jsonplaceholder.typicode.com/todos/1")
print("Status:", r.status_code)
print("Respuesta:", r.json())

r2 = requests.post(
    "https://jsonplaceholder.typicode.com/posts",
    json={"titulo": "hola", "valor": 42}
)
print("Status:", r2.status_code)
```

Soporta `requests.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`,
con `json=`, `data=`, `headers=`, `auth=`, `timeout=` — igual que la
librería `requests`/`urequests` real de MicroPython.

### CORS — por qué una URL puede fallar

Como el pedido sale del navegador de verdad, el servidor al que le
pegás tiene que permitir pedidos desde páginas web (CORS). La mayoría
de las APIs públicas lo permiten. Si ves un error que menciona "CORS"
o "no se pudo completar la solicitud", probablemente sea eso — no es
un problema de tu código.

### Mandar datos desde un celular real

Abrí `telefono_virtual.html` (en la carpeta del proyecto) desde el
navegador de un celular — es una página simple para mandar/recibir
mensajes de texto que tu ESP32 puede leer con `requests.get()`, usando
[ntfy.sh](https://ntfy.sh) como intermediario gratuito. Mismo nombre de
"canal" de los dos lados:

```python
import requests, json, time

CANAL = "mi-canal-unico-123"  # elegí algo que nadie más vaya a adivinar
visto = set()

while True:
    r = requests.get("https://ntfy.sh/" + CANAL + "/json?poll=1")
    for linea in r.text.strip().split("\n"):
        if not linea:
            continue
        msg = json.loads(linea)
        if msg["id"] not in visto:
            visto.add(msg["id"])
            print("Mensaje del celular:", msg["message"])
    time.sleep(2)
```

---

## 3. Bluetooth (BLE) — el "teléfono virtual"

Bluetooth real no es posible desde una página web (el navegador no
tiene radio Bluetooth con la que emparejarse a un ESP32 real) — en vez
de eso, PitSimulator trae un panel que simula un celular conectándose
por BLE, con la idea de la app **Serial Bluetooth Terminal**.

Abrí el panel con el botón **📱** (arriba a la derecha).

### Código del ESP32 (usando `BLEUART`, la forma más simple)

```python
from BLE import BLEUART
import bluetooth

ble = bluetooth.BLE()
uart = BLEUART(ble, "MiESP32")

def datos_recibidos():
    mensaje = uart.read().decode().strip()
    print("Recibido:", mensaje)
    uart.write("Recibí: " + mensaje)

uart.irq(handler=datos_recibidos)
print("Esperando conexion BLE...")
```

Con la simulación corriendo, tu ESP32 va a aparecer en el selector del
panel 📱 apenas corras este código. Elegilo, dale "Conectar", y ya
podés mandar mensajes de texto desde ahí — el chat muestra lo que
mandás (derecha) y lo que el ESP32 responde (izquierda).

### Forma alternativa (API de más bajo nivel)

Si tu curso usa el patrón `bluetooth.BLE()` + `gatts_register_services()`
directo (el que arma el servicio GATT a mano, sin la clase `BLEUART`),
también funciona — es el mismo ejemplo oficial de MicroPython
(`ble_simple_peripheral.py`). Lo único que importa para que el panel 📱
reconozca tu ESP32 es que uses el **Nordic UART Service** con sus UUIDs
estándar (`6E400001...`/`6E400002...`/`6E400003...`) — son los mismos
que trae cualquier tutorial de "ESP32 BLE UART".

---

## Resumen de qué es real y qué es simulado

| | ¿Qué tan real es? |
|---|---|
| ESP-NOW entre 2 ESP32 del lienzo | Simulado completo — mensajes van directo entre los Workers del navegador |
| `wlan.connect()` | 100% simulado — siempre "conecta", no hay red de verdad |
| `requests.get()/post()` | **Real** — sale a internet de verdad por el navegador |
| BLE con el panel 📱 | Simulado — el "teléfono" es un panel dentro de la misma app |
| `telefono_virtual.html` desde un celular real | **Real** — tu celular de verdad manda datos por internet (vía ntfy.sh) |
