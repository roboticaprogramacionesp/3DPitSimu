# Puente local (para usar PitSimulator publicado en GitHub Pages)

Cuando el simulador se abre desde una página web normal (GitHub Pages,
por ejemplo `https://tuusuario.github.io/PitSimulator/`) el navegador
**no puede** correr QEMU ni MicroPython real por su cuenta — solo
tiene JavaScript. El "puente local" es un programita chico que corrés
en tu propia PC (una sola vez, se queda corriendo en segundo plano):
levanta MicroPython real dentro de QEMU y un servidor que escucha en
`ws://127.0.0.1:8787`. Cuando después abrís la página del simulador y
apretás "▶ Simular", el navegador se conecta solo a ese puente en tu
PC — es exactamente lo mismo que ya hace la app de escritorio, nada
más que sin la ventana propia (la ventana la pone el navegador, con la
página de GitHub Pages adentro).

Esto es la alternativa al "modo navegador" (🌐, sin instalar nada,
pero con una limitación: mientras corre un `while True:` no se puede
mover ningún control del panel y ver el cambio reflejado en vivo, solo
entre corridas). Con el puente local no hay esa limitación — es
MicroPython real corriendo en QEMU real, igual que en la app de
escritorio.

## Uso (versión empaquetada)

1. Descargá y descomprimí `PitSimulator-Puente` (te lo pasa quien te
   compartió el simulador).
2. Antes de abrirlo por primera vez, si vas a usar la versión de
   GitHub Pages (no `localhost`), abrí una consola en esa carpeta y
   seteá `ALLOWED_ORIGINS` a tu propia URL, por ejemplo:

   ```powershell
   $env:ALLOWED_ORIGINS = "tuusuario.github.io"
   .\PitSimulator-Puente.exe
   ```

   (coma-separado si necesitás más de un host: `"host1,host2"`). Sin
   esto, el puente por default solo acepta conexiones desde páginas en
   `localhost`/`127.0.0.1` — lo rechaza todo lo demás por seguridad.
3. Dejá esa ventana de consola abierta (minimizada está bien) mientras
   uses el simulador. Para cerrar el puente: Ctrl+C en esa consola, o
   cerrar la ventana.
4. Abrí la página del simulador en el navegador y usala normalmente —
   "▶ Simular" va a conectar solo.

## ⚠️ Chrome puede pedir un permiso extra ("Red local")

Confirmado en la práctica: Chrome tiene una función de seguridad
relativamente nueva ("Local Network Access") que bloquea que una
página pública (como `*.github.io`) se conecte a `127.0.0.1` **salvo
que el usuario dé un permiso explícito** — el error en la consola del
navegador es `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. Esto pasa
AUNQUE el puente esté corriendo bien y `ALLOWED_ORIGINS` esté seteado
correctamente — es el navegador bloqueando antes de que el pedido
llegue siquiera al puente.

Qué hacer si "▶ Simular" no conecta:

1. Fijate si Chrome mostró un cartel/ícono pidiendo permiso para
   "acceder a la red local" al hacer clic en Simular, y aceptalo.
2. Si no apareció ningún cartel (o ya lo rechazaste sin querer antes),
   hacé clic en el candado 🔒 junto a la dirección del sitio →
   "Configuración de sitios" (o "Permisos del sitio") → buscá "Red
   local" (Local network access) → ponelo en "Permitir" → recargá la
   página.
3. Si tu navegador no tiene esta función todavía (versiones viejas de
   Chrome) o usás Firefox, probablemente conecta directo sin pedir
   nada — Firefox todavía no implementa este bloqueo.

El simulador ahora detecta este caso (primera conexión fallida desde
un origen que no es localhost) y muestra este mismo aviso solo, en la
terminal del panel REPL.

## Uso (desde el código fuente, para desarrollo)

```powershell
cd desktop
$env:ALLOWED_ORIGINS = "tuusuario.github.io"
python bridge_only.py
```

Requiere lo mismo que la app de escritorio para el bridge en sí
(QEMU/GDB — vendorizados en `desktop/vendor/`, o `bridge_config.py`, o
las variables de entorno `QEMU_BIN`/`GDB_BIN` del sistema — ver
`desktop/vendor/README.md`) pero **no** requiere `pywebview` (no abre
ninguna ventana).

## Por qué es seguro

El puente sigue escuchando SOLO en `127.0.0.1` (nunca expuesto a la
red) y sigue validando el header `Origin` de cada conexión contra una
lista blanca — por default `localhost`/`127.0.0.1`, y con
`ALLOWED_ORIGINS` se **suma** tu propio host a esa lista, nunca la
reemplaza ni la abre a cualquiera. Una pestaña maliciosa en otro sitio
no puede conectarse al puente aunque sepa que existe, porque su Origin
no va a estar en la lista. Por eso importa setear `ALLOWED_ORIGINS` a
tu dominio real y no a algo más amplio.

## Empaquetado (para quien arma la distribución)

Mismo criterio que la app de escritorio completa (ver comentario al
inicio de `desktop/build/prepare_dist.py`), apuntando a
`bridge_only.py` en vez de `main.py`, y sin `--windowed` (es una
consola, no una ventana):

```powershell
pyinstaller --onedir --console --icon=desktop/build/icon.ico `
    --name PitSimulator-Puente --distpath dist desktop/bridge_only.py
```

Después copiar `server/` y `desktop/vendor/` al lado del `.exe`
resultante (mismo paso que `prepare_dist.py` hace para la app
completa — no hace falta copiar el frontend, ese vive en GitHub
Pages).
