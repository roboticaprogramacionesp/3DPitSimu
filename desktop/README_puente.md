# Puente local (para usar 3DPitSimu publicado en GitHub Pages)

Cuando el simulador se abre desde una página web normal (GitHub Pages,
por ejemplo `https://tuusuario.github.io/3DPitSimu/`) el navegador
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

## Uso (versión empaquetada) -- un solo archivo, sin instalar nada

1. Descargá `3DPitSimu-Puente.exe` (te lo pasa quien te compartió
   el simulador) -- un solo archivo, se puede dejar en cualquier
   carpeta (Escritorio, Descargas, un USB), no depende de ninguna otra
   carpeta al lado.
2. Doble click. Ya viene con el dominio real de GitHub Pages permitido
   por default -- no hace falta tocar nada más.
3. Se va a abrir una ventana de consola con el log del puente -- dejala
   abierta (minimizada está bien) mientras usás el simulador. Para
   cerrarlo: cerrar esa ventana, o Ctrl+C adentro.
4. Abrí la página del simulador en el navegador y usala normalmente —
   "▶ Simular" va a conectar solo.

Como todo (server/QEMU/GDB/Node) viaja comprimido adentro de ese único
`.exe`, cada apertura tarda un poco más que si fuera una carpeta
(autoextrae a una carpeta temporal) -- normal, no es que se colgó.

Para sumar OTRO host sin recompilar nada (ej. probar contra un fork/otro
usuario de GitHub Pages), se puede crear un archivo `allowed_origins.txt`
(un host por línea) en la MISMA carpeta donde pusiste el `.exe` -- si
existe ahí, se usa ese en vez del que trae embebido por default. También
sirve setear `ALLOWED_ORIGINS` por PowerShell antes de abrir el `.exe`;
las tres fuentes se combinan, ninguna reemplaza a las otras.

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
python bridge_only.py
```

Ya lee `desktop/allowed_origins.txt` (mismo archivo que en la versión
empaquetada). Para un host distinto sin editar el archivo:
`$env:ALLOWED_ORIGINS = "tuusuario.github.io"` antes de arrancar.

Requiere lo mismo que la app de escritorio para el bridge en sí
(QEMU/GDB — vendorizados en `desktop/vendor/`, o `bridge_config.py`, o
las variables de entorno `QEMU_BIN`/`GDB_BIN` del sistema — ver
`desktop/vendor/README.md`) pero **no** requiere `pywebview` (no abre
ninguna ventana).

## Por qué es seguro

El puente sigue escuchando SOLO en `127.0.0.1` (nunca expuesto a la
red) y sigue validando el header `Origin` de cada conexión contra una
lista blanca — por default `localhost`/`127.0.0.1`, y `allowed_origins.txt`/
`ALLOWED_ORIGINS` **suman** hosts a esa lista, nunca la reemplazan ni
la abren a cualquiera. Una pestaña maliciosa en otro sitio no puede
conectarse al puente aunque sepa que existe, porque su Origin no va a
estar en la lista. Por eso importa que `allowed_origins.txt` tenga
solo tu dominio real, no algo más amplio.

## Empaquetado (para quien arma la distribución)

```powershell
python desktop/build/build_bridge_onefile.py
```

Arma `dist/3DPitSimu-Puente.exe` -- un solo archivo, con `server/`,
`desktop/vendor/` y `desktop/allowed_origins.txt` embebidos adentro
(ver ese script para el detalle: arma una copia limpia de `server/`
sin los binarios `_old`/`_prev` de sesiones viejas antes de
compilar). Reemplaza a la versión anterior en carpeta (`--onedir`) --
esa seguía dependiendo de que alguien copiara TODAS las carpetas al
lado del `.exe`, y era fácil copiar solo el `.exe` suelto por error
(pasó en la práctica). Si por algún motivo se prefiere la versión en
carpeta (arranca mas rápido, no autoextrae nada): `pyinstaller
--onedir --console --icon=desktop/build/icon.ico --name
3DPitSimu-Puente --distpath dist desktop/bridge_only.py`, y
después copiar `server/`, `desktop/vendor/` y
`desktop/allowed_origins.txt` a mano al lado del `.exe` resultante.
