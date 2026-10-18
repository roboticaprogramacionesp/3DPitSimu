/*
==========================================================
 PitSimulator — tests/blockly-imports.test.js

 Por qué existe: un bloque de Blockly (ver js/blockly/generators.js)
 generaba "from oledsh1106 import OLED as OLED_SH1106", pero el
 archivo real en components_wasm/libs/ se llamaba "oledsd1106.py"
 (typo: "sd" en vez de "sh") -- el bloque nunca pudo haber funcionado,
 pero nadie lo notó hasta que un alumno lo usó en un proyecto real y
 tiró "ImportError: no module named 'oledsh1106'" en pleno ▶ Ejecutar.

 Este test barre TODOS los "import X" / "from X import Y" que
 generators.js puede llegar a producir y confirma que cada módulo X
 existe de verdad para el modo navegador (WASM, el default -- ver el
 comentario grande en js/app.js sobre por qué ya no se arranca QEMU
 por default): o bien como archivo en components_wasm/libs/
 (bundle.json), o como uno de los módulos que wasmWorker.js inyecta
 directo en sys.modules (machine, neopixel, network, espnow,
 bluetooth, requests...), o un builtin confirmado del propio binario
 WASM. Si un bloque nuevo importa algo que no está en ninguna de esas
 tres listas, este test lo frena ACÁ -- antes de que un alumno con un
 proyecto grande (muchos bloques, muchos componentes) se encuentre
 con el mismo ImportError a mitad de clase.

 Alcance real (léase antes de "arreglar" un fallo agregando el nombre
 a una lista sin pensar): esto NO corre Python, NO sabe si el módulo
 define lo que el bloque necesita (ej. la clase/función exacta que se
 importa) -- solo confirma que el ARCHIVO/MÓDULO existe y se podría
 importar. Tampoco cubre el firmware real (QEMU/hardware físico, que
 vive en un checkout de MicroPython aparte, fuera de este repo) -- un
 import que pasa acá podría seguir fallando ahí si ese modo llega a
 usarse. Para el flujo por default (navegador) sí es una garantía
 real.
==========================================================
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GENERATORS_FILE = path.join(ROOT, 'js', 'blockly', 'generators.js');
const BUNDLE_FILE = path.join(ROOT, 'components_wasm', 'libs', 'bundle.json');

// Módulos que js/simulator/wasmWorker.js inyecta DIRECTO en
// sys.modules antes de correr cualquier código del alumno (ver
// BASE_WASM_URL/NEOPIXEL_WASM_URL/etc. y los sys.modules[...] = ...
// dentro de cada components_wasm/_*_wasm.py) -- "import X" para
// estos funciona aunque NO exista ningún X.py en components_wasm/libs/.
// Si se agrega un shim nuevo ahí, sumar su nombre acá.
const WASM_SHIMMED_MODULES = new Set([
    'machine', 'neopixel', 'network', 'espnow',
    'bluetooth', 'ubluetooth', 'requests', 'urequests',
]);

// Módulos realmente compilados en el binario de MicroPython WASM --
// no vienen de ningún .py de components_wasm/libs/ ni de un shim de
// arriba. Lista corta a propósito: según el comentario de
// _requests_wasm.py ("confirmado que este build no tiene socket
// compilado"), NO hay que asumir que un módulo estándar está --
// confirmarlo corriendo de verdad antes de agregarlo acá. Esta
// lista entera está confirmada así: probada en vivo contra
// assets/wasm/micropython.wasm con loadMicroPython() + "import X"
// real (no supuesta) -- "os" y "ujson" sí están; "dht", "onewire",
// "socket" y "uasyncio" NO (ver WASM_KNOWN_GAPS más abajo).
const KNOWN_BUILTIN_MODULES = new Set([
    'sys', 'time', 'utime', 'gc', 'math', 'random', 'json', 'ujson', 'os',
    'struct', 'array', 'micropython', 'framebuf', 'io', 'binascii',
]);

// Imports que generators.js SÍ produce pero que HOY no funcionan en
// modo navegador -- confirmado probando cada uno de verdad contra
// assets/wasm/micropython.wasm (loadMicroPython() + "import X" real,
// instancia nueva por candidato, nunca reusada -- un ImportError dentro
// de una instancia WASM compartida deja corrompido cualquier resultado
// posterior, confirmado en la práctica mientras se armaba este test).
// Viven en una lista aparte (no mezclados con KNOWN_BUILTIN_MODULES)
// a propósito: son huecos reales, documentados, no builtins
// confirmados -- que este test los deje pasar es SOLO para no repetir
// un hallazgo ya conocido en cada corrida, no una garantía de que
// esos bloques andan.
//   - 'dht'/'onewire': el bloque "DHT" y el de sensores OneWire
//     (ds18x20) de Blockly generan estos imports, pero no existe
//     ningún _dht_wasm.py/_onewire_wasm.py (comparar con los shims de
//     WASM_SHIMMED_MODULES de arriba) -- nunca se portó este driver al
//     modo navegador. El tutorial "dht11" (ver TutorialManager.js)
//     enseña el CABLEADO nada más, no fuerza a usar este bloque
//     puntual, pero si un alumno sí lo usa, revienta en ▶ Ejecutar.
//   - 'socket'/'uasyncio': confirmado también en _requests_wasm.py
//     ("este build no tiene socket compilado") -- bloques de servidor
//     web/sockets crudos no andan en navegador, por diseño (WiFi real
//     no existe acá, ver _espnow_wasm.py).
//   - 'bts', 'st7789', 'camera', 'cam_config': funciones de HARDWARE
//     REAL sin equivalente simulado -- Bluetooth Clásico (SPP),
//     driver C nativo de la TFT ST7789 (ver worker/... no, ver el
//     comentario de "Requiere firmware Carpeta 3 Firmware ESP32 Cam"
//     en generators.js) y la cámara ESP32-CAM. Estos bloques están
//     pensados para cuando el código se flashea a una placa real, no
//     para correr en el simulador -- no es un bug, es simplemente algo
//     que el navegador no puede simular.
const WASM_KNOWN_GAPS = new Set([
    'dht', 'onewire', 'socket', 'uasyncio', 'bts', 'btm', 'st7789', 'camera', 'cam_config',
]);

function loadBundleModuleNames() {
    const bundle = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8'));
    return new Set(Object.keys(bundle));
}

// Barre generators.js línea por línea buscando "from X import ..." y
// "import X" DENTRO de los template strings de Python que arma cada
// bloque -- no ejecuta nada, es un grep estructurado. No resuelve
// nombres de módulo armados dinámicamente (ej. `from ${var} import`,
// no hay ningún caso así hoy) -- eso queda fuera de este chequeo.
function findImportedModules(sourceFile) {

    const lines = fs.readFileSync(sourceFile, 'utf8').split('\n');
    const found = [];

    const fromImportRe = /\bfrom\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+import\b/g;
    const plainImportRe = /(?:^|[`"'\s])import\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

    lines.forEach((rawLine, idx) => {

        // generators.js arma Python multilínea como texto JS con "\n"
        // LITERAL (backslash + n, dos caracteres, no un salto de
        // línea real) -- ej. "from machine import Pin\nfrom neopixel
        // import NeoPixel". Sin este reemplazo, \bfrom\b nunca
        // matchea el SEGUNDO "from" (no hay borde de palabra real
        // entre la "n" de "\n" y la "f" de "from", las dos son letras)
        // -- bug real encontrado en la primera corrida de este mismo
        // test: silenciaba el chequeo del segundo import de la línea
        // Y además dejaba que el nombre importado (ej. "NeoPixel")
        // se colara como si fuera un módulo aparte vía el regex de
        // "import X" suelto, de abajo. Pasar \n/\t/\r literales a
        // espacio real restaura los bordes de palabra sin tocar nada
        // de la detección en sí.
        const line = rawLine.replace(/\\[nrt]/g, ' ');

        // "from X import Y" captura el MÓDULO (X) -- Y es un nombre
        // importado DESDE X, no un módulo en sí, nunca cuenta como
        // import propio. Se enmascara el tramo "from X import" (sin
        // tocar el resto de la línea) para que el regex de "import Y"
        // de abajo no vuelva a capturar esa misma "import" como si
        // fuera standalone -- sin esto, "from machine import Pin"
        // contaba "Pin" como si fuera un módulo aparte (falso
        // positivo real, visto en la primera corrida de este test).
        let masked = line;
        let m;

        fromImportRe.lastIndex = 0;
        while ((m = fromImportRe.exec(line))) {
            found.push({ module: m[1], line: idx + 1, snippet: line.trim() });
            const start = m.index;
            const end = start + m[0].length;
            masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end);
        }

        plainImportRe.lastIndex = 0;
        while ((m = plainImportRe.exec(masked))) {
            found.push({ module: m[1], line: idx + 1, snippet: line.trim() });
        }

    });

    return found;

}

test('todo "import X" que genera Blockly existe para el modo navegador (WASM)', () => {

    const bundleModules = loadBundleModuleNames();
    const imports = findImportedModules(GENERATORS_FILE);

    assert.ok(imports.length > 10, `se esperaban varias decenas de imports en generators.js, se encontraron ${imports.length} -- ¿se movió/renombró el archivo, o cambió tanto el formato que el regex ya no matchea nada?`);

    const missing = imports.filter(({ module }) =>
        !bundleModules.has(module) &&
        !WASM_SHIMMED_MODULES.has(module) &&
        !KNOWN_BUILTIN_MODULES.has(module) &&
        !WASM_KNOWN_GAPS.has(module),
    );

    if (missing.length > 0) {

        const detail = missing
            .map(({ module, line, snippet }) => `  generators.js:${line} -- import "${module}" (${snippet})`)
            .join('\n');

        assert.fail(
            `${missing.length} import(s) de Blockly no tienen módulo disponible en modo navegador:\n${detail}\n\n` +
            `Revisar: ¿falta el archivo en components_wasm/libs/ (y su entrada en bundle.json)? ` +
            `¿es un typo contra el nombre real del archivo (como pasó con "oledsh1106" vs "oledsd1106")? ` +
            `¿es un módulo nuevo que sí está compilado en el WASM y solo falta sumarlo a KNOWN_BUILTIN_MODULES en este test? ` +
            `Antes de sumarlo a ninguna lista: confirmarlo corriendo "import X" de verdad contra assets/wasm/micropython.wasm, no asumir.`
        );

    }

});

test('bundle.json no tiene entradas vacías o corruptas', () => {

    const bundle = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8'));
    const empty = Object.entries(bundle).filter(([, content]) => !content || !content.trim());

    assert.equal(empty.length, 0, `módulos con contenido vacío en bundle.json: ${empty.map(([name]) => name).join(', ')}`);

});
