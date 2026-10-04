# =============================================================
# PitSimulator — "requests"/"urequests" simulados para el runtime WASM
#
# WiFi real no existe acá (ver _espnow_wasm.py -- WLAN.connect() es
# 100% simulado), pero las requests HTTP que el alumno haga DESPUÉS
# de "conectarse" SÍ son reales: esto las delega a fetch() del
# navegador (ver WasmBridge._handleHttpRequest()) -- confirmado que
# este build no tiene "socket" compilado (probado en vivo: "no module
# named 'socket'"), así que replicar requests.py real (que arma el
# pedido HTTP a mano sobre un socket TCP) no es una opción -- en vez
# de eso, esto imita la API PÚBLICA de la librería real
# (confirmada contra su fuente antes de escribir esto, no inventada):
#   https://github.com/micropython/micropython-lib/blob/master/python-ecosys/requests/requests/__init__.py
# por dentro, delega todo el trabajo de red al navegador.
#
# Protocolo con JS (WasmBridge.js):
#   PEDIDO (Python -> JS), por stdout, igual que ESPNOW_TX/GPIO/etc:
#     HTTP_REQ:<id>:<method hex>:<url hex>:<headers JSON, hex>:<body hex>
#   RESPUESTA (JS -> Python): BUG REAL encontrado en vivo -- a
#   diferencia de todo lo demás (GPIO/I2C/ESPNOW), esto NO llega por
#   process_line()/register_line_handler(). request() (acá abajo)
#   agota decenas de time.sleep() por pedido, sondeando una respuesta
#   que puede tardar cientos de ms en llegar -- cuando SÍ llega
#   mientras ese mismo sleep() sigue "en vuelo" (suspendido, sin
#   rewindear todavía), un SEGUNDO mp.runPython() disparado por
#   process_line() revienta todo el módulo WASM ("RuntimeError: ...
#   We cannot start an async operation when one is already in
#   flight") -- dos operaciones Asyncify superpuestas en el mismo
#   módulo no son válidas, sin importar que la segunda sea rápida.
#   Confirmado en vivo con un bucle de requests.get() -- se caía
#   siempre, no a veces.
#
#   Arreglo: WasmBridge.js escribe la respuesta DIRECTO como variable
#   global (mp.globals.set(), que no ejecuta nada -- no es un ccall
#   asyncify-wrapped) bajo la clave "_pit_http_res_<id>", y request()
#   la lee ella misma en su propio sondeo (ya está despierta cada
#   poll_ms de todos modos, no hace falta que nadie la "despierte").
#   Empaquetada como "<status>|<reason hex>|<headers hex>|<body hex>"
#   o "ERROR|<mensaje hex>" (un solo string, sin más mensajes de por
#   medio).
#
# Todo hex (nunca ":" ni "|" sueltos en el contenido) por el mismo
# motivo que _espnow_wasm.py: una URL/header/body reales están llenos
# de ":" (http://, "Content-Type: ...", etc.).
# =============================================================

import sys
import time


def _hex_to_bytes(h):
    return bytes(int(h[i:i + 2], 16) for i in range(0, len(h), 2))


def _bytes_to_hex(b):
    return "".join("%02x" % x for x in b)


_http_pending_id = 0


def _parse_http_res(packed):
    # packed = "ERROR|<mensaje hex>" o "<status>|<reason hex>|<headers hex>|<body hex>"
    parts = packed.split("|")

    if parts[0] == "ERROR":
        message = _hex_to_bytes(parts[1]).decode("utf-8", "ignore") if len(parts) > 1 and parts[1] else "error de red"
        return ("ERROR", message)

    if len(parts) < 4:
        return ("ERROR", "respuesta mal formada del simulador")

    try:
        status = int(parts[0])
    except ValueError:
        return ("ERROR", "respuesta mal formada del simulador")

    reason = _hex_to_bytes(parts[1]).decode("utf-8", "ignore") if parts[1] else ""
    headers = {}
    if parts[2]:
        try:
            import json
            headers = json.loads(_hex_to_bytes(parts[2]).decode("utf-8", "ignore"))
        except Exception:
            headers = {}
    body = _hex_to_bytes(parts[3]) if parts[3] else b""

    return ("OK", status, reason, headers, body)


class Response:

    def __init__(self, status_code, reason, headers, content):
        self.status_code = status_code
        self.reason = reason
        self.headers = headers
        self.encoding = "utf-8"
        self._content = content

    @property
    def content(self):
        return self._content

    @property
    def text(self):
        return str(self._content, self.encoding)

    def json(self):
        import json
        return json.loads(self._content)

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# DEFAULT_TIMEOUT_MS: cuánto esperar como máximo una respuesta antes
# de tirar OSError -- real fetch() del navegador ya falla solo ante
# DNS/CORS/conexión rechazada (rápido), esto es sobre todo para el
# caso "el servidor existe pero nunca contesta".
DEFAULT_TIMEOUT_MS = 15000


def request(method, url, data=None, json=None, headers=None, stream=None, auth=None, timeout=None, parse_headers=True):

    global _http_pending_id

    if headers is None:
        headers = {}
    else:
        headers = dict(headers)

    if auth is not None:
        import ubinascii
        username, password = auth
        token = ubinascii.b2a_base64(("%s:%s" % (username, password)).encode())[:-1].decode()
        headers["Authorization"] = "Basic " + token

    body = data
    if json is not None:
        import json as _json
        body = _json.dumps(json)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"

    if body is None:
        body_bytes = b""
    elif isinstance(body, str):
        body_bytes = body.encode("utf-8")
    else:
        body_bytes = bytes(body)

    import json as _json
    headers_json = _json.dumps(headers)

    _http_pending_id += 1
    rid = _http_pending_id

    sys.stdout.write("HTTP_REQ:%d:%s:%s:%s:%s\n" % (
        rid,
        _bytes_to_hex(method.encode()),
        _bytes_to_hex(url.encode()),
        _bytes_to_hex(headers_json.encode()),
        _bytes_to_hex(body_bytes),
    ))

    # poll_ms=150: margen razonable frente al ASYNCIFY_STACK_SIZE del
    # binario compilado (ver Makefile del puerto) -- cada time.sleep()
    # de este sondeo usa Asyncify para cederle el control a JS. 150ms
    # sigue siendo imperceptible para el alumno (una respuesta HTTP
    # real rara vez baja de eso).
    poll_ms = 150
    waited = 0
    timeout_ms = int(timeout * 1000) if timeout else DEFAULT_TIMEOUT_MS

    key = "_pit_http_res_%d" % rid
    g = globals()

    packed = g.get(key)
    while packed is None:
        time.sleep(poll_ms / 1000)
        waited += poll_ms
        if waited >= timeout_ms:
            raise OSError(
                "Tiempo de espera agotado esperando la respuesta HTTP "
                "(revisá tu conexión a internet, la URL, o si el servidor "
                "permite CORS desde el navegador)"
            )
        packed = g.get(key)

    del g[key]
    result = _parse_http_res(packed)

    if result[0] == "ERROR":
        raise OSError(result[1])

    _, status, reason, resp_headers, content = result
    resp = Response(status, reason, resp_headers if parse_headers is not False else {}, content)
    return resp


def head(url, **kw):
    return request("HEAD", url, **kw)


def get(url, **kw):
    return request("GET", url, **kw)


def post(url, **kw):
    return request("POST", url, **kw)


def put(url, **kw):
    return request("PUT", url, **kw)


def patch(url, **kw):
    return request("PATCH", url, **kw)


def delete(url, **kw):
    return request("DELETE", url, **kw)


class _FakeRequestsModule:
    pass


# Mismo truco que el resto de los módulos falsos de esta carpeta (ver
# _FakeMachineModule en _base_wasm.py) -- "urequests" real (ver la
# fuente linkeada arriba) es hoy un simple re-export de "requests"
# (micropython-lib los unificó), así que acá se registran los DOS
# nombres apuntando al mismo módulo -- cubre tanto tutoriales viejos
# ("import urequests") como código nuevo ("import requests").
if "requests" not in sys.modules:
    sys.modules["requests"] = _FakeRequestsModule()

requests = sys.modules["requests"]
requests.Response = Response
requests.request = request
requests.head = head
requests.get = get
requests.post = post
requests.put = put
requests.patch = patch
requests.delete = delete

sys.modules["urequests"] = requests
