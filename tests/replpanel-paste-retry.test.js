// ==========================================================
// PitSimulator - tests/replpanel-paste-retry.test.js
//
// Regresión para ReplPanel._pasteUserCodeWithRetry() +
// _wrapUserCodeForIntegrity() (ver js/ui/ReplPanel.js) -- reintento
// automático de "Ejecutar" cuando el código del usuario se corrompe en
// tránsito (la UART emulada de QEMU puede perder bytes bajo carga
// real). Historia completa, 2026-10-01, con un script real de
// NeoMatrix (arrays de píxeles largos):
//
// 1. Primera versión: detectaba corrupción recién DESPUÉS de que el
//    envío completo terminara -- para código largo (varios segundos
//    de pacing) la corrupción podía pasar A MITAD del envío, mucho
//    antes de que el watcher arrancara, perdiéndose por completo. El
//    test "a mitad de un envío largo" de acá abajo es el que reveló
//    ese bug -- no sacarlo aunque parezca redundante con el de arriba.
//
// 2. Segunda versión: escuchaba durante todo el envío, pero buscaba
//    SyntaxError/IndentationError en la salida -- confirmado con el
//    .exe REAL (no un mock) que la UART puede perder caracteres de una
//    forma que deja el código IGUAL de sintácticamente válido
//    ("NeoMatrix(12,8,8,layout=0,rotation=0)" llegó como
//    "NeoMatrix(12,8,8,laytation=0)" -- perdió "out=0,ro" del medio,
//    nada que un parser note). Esa corrupción pasaba sin dejar ningún
//    rastro reconocible.
//
// 3. Versión actual: el código del usuario se verifica con el MISMO
//    mecanismo de checksum que ya protege al HAL por componente
//    (_wrapHalForIsolation) -- ANTES de ejecutar nada. Cualquier
//    pérdida, sea cual sea la forma que tome, se detecta con certeza
//    (el checksum no cuadra) en vez de inferirse de un patrón de
//    error. Costo asumido a propósito: se pierde la vista en vivo del
//    código tipeándose en el panel REPL.
// ==========================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReplPanel() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'ReplPanel.js'), 'utf8');
    const context = {
        console, setTimeout, clearTimeout,
        // _wrapUserCodeForIntegrity() usa estas globals del navegador
        // (codificación binaria + base64) -- Node no las tiene por
        // default en un vm.Context nuevo.
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        unescape, encodeURIComponent, decodeURIComponent,
    };
    context.global = context;
    vm.createContext(context);
    vm.runInContext(code + '\nthis.ReplPanel = ReplPanel;', context);
    return context.ReplPanel;
}

function makeEventBus() {
    const listeners = {};
    return {
        on: (e, cb) => { (listeners[e] = listeners[e] || []).push(cb); },
        off: (e, cb) => { listeners[e] = (listeners[e] || []).filter((x) => x !== cb); },
        emit: (e, d) => { (listeners[e] || []).slice().forEach((cb) => cb(d)); },
    };
}

function makeCtx(ReplPanel, pasteBlockImpl) {
    const ctx = Object.create(ReplPanel.prototype);
    ReplPanel.USER_CODE_PASTE_SETTLE_MS = 20; // acelerado para el test
    ctx.simulator = { eventBus: makeEventBus() };
    ctx.appendOutput = () => {};
    ctx._sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20)));
    ctx._pasteBlock = pasteBlockImpl;
    return ctx;
}

// Mensaje tal cual lo imprimiría MicroPython si el checksum no diera
// -- no hace falta que los números sean reales para probar la lógica
// de reintento, solo que contengan el marcador exacto.
function fakeCorruptMessage(ReplPanel) {
    return ReplPanel.USER_CODE_CORRUPT_MARKER + 'len=10 sum=20 esperado_len=12 esperado_sum=30\n';
}

test('_pasteUserCodeWithRetry no reintenta si no hay señales de corrupción', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
    });

    await ctx._pasteUserCodeWithRetry('codigo limpio', 0);

    assert.equal(calls, 1);

});

test('_pasteUserCodeWithRetry NO reintenta ante un error real del usuario (sin el marcador de corrupción)', async () => {

    // Un SyntaxError/NameError/lo que sea que el usuario haya escrito
    // de verdad -- sin el marcador exacto, no es corrupción, es un bug
    // genuino, y tiene que mostrarse tal cual sin reintentos de más.
    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', 'Traceback...\nSyntaxError: invalid syntax\n'), 5);
    });

    await ctx._pasteUserCodeWithRetry('codigo con un bug real del usuario', 0);

    assert.equal(calls, 1, 'un error SIN el marcador de corrupción no debería disparar ningún reintento');

});

test('_pasteUserCodeWithRetry reintenta si el marcador llega por "qemu:history" (reconexión a mitad del paste), no solo por "qemu:output"', async () => {

    // BUG REAL (reportado y confirmado: el checksum detectaba bien la
    // corrupción -- el marcador se imprimía -- pero el reintento
    // automático nunca se disparaba): si la conexión WS se corta y
    // reconecta DURANTE el paste, el contenido que se perdió en el
    // corte le llega al cliente reconectado por el canal de historial
    // ("qemu:history", ver QemuBridge.onMessage()/"\x00HISTORY:"), NO
    // como "qemu:output" en vivo. Escuchar solo "qemu:output" se
    // perdía el marcador entero en ese escenario.
    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            // El marcador llega por el canal de HISTORIAL, no por
            // "qemu:output" -- simula la reconexión a mitad de paste.
            setTimeout(() => ctx.simulator.eventBus.emit('qemu:history', fakeCorruptMessage(ReplPanel)), 5);
        }
    });

    await ctx._pasteUserCodeWithRetry('codigo corto', 0);

    assert.equal(calls, 2, 'debería haber detectado la corrupción llegada por "qemu:history" y reintentado');

});

test('_pasteUserCodeWithRetry reintenta si el marcador de corrupción llega DESPUÉS de que _pasteBlock ya resolvió', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', fakeCorruptMessage(ReplPanel)), 5);
        }
    });

    await ctx._pasteUserCodeWithRetry('codigo corto', 0);

    assert.equal(calls, 2, 'debería haber reintentado una vez');

});

test('_pasteUserCodeWithRetry reintenta si el marcador llega A MITAD de un envío largo (el bug real)', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            // El marcador aparece MIENTRAS _pasteBlock() todavía está
            // "enviando" (el await de abajo todavía no resolvió) --
            // simula un script largo donde la corrupción se detecta a
            // mitad del envío, no al final.
            setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', fakeCorruptMessage(ReplPanel)), 5);
            await new Promise((r) => setTimeout(r, 30));
        }
    });

    await ctx._pasteUserCodeWithRetry('codigo largo', 0);

    assert.equal(calls, 2, 'debería haber detectado la corrupción aunque se avisara a mitad del envío, y reintentado');

});

test('_pasteUserCodeWithRetry reintenta si paste mode se corta antes de tiempo (el checksum nunca llega a evaluarse)', async () => {

    // BUG REAL encontrado probando el checksum contra el .exe real: el
    // checksum protege el CONTENIDO, pero si se pierde un byte de
    // CONTROL que corta "paste mode" antes de tiempo, el resto del
    // código se tipea suelto como comandos individuales -- ni siquiera
    // llega a ejecutarse el chequeo de checksum. Señal: un ">>> " de
    // verdad apareciendo MIENTRAS todavía se están mandando líneas,
    // DESPUÉS de haber confirmado que paste mode arrancó.
    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            ctx.simulator.eventBus.emit('qemu:output', 'paste mode; Ctrl-C to cancel, Ctrl-D to finish\r\n=== \n');
            // Paste mode se corta antes de tiempo -- aparece un ">>> "
            // real MIENTRAS _pasteBlock() todavía sigue en su loop de
            // envío (el await de abajo no resolvió todavía).
            setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', '>>> algo_suelto\r\n'), 5);
            await new Promise((r) => setTimeout(r, 30));
        }
    });

    await ctx._pasteUserCodeWithRetry('codigo largo', 0);

    assert.equal(calls, 2, 'debería haber detectado la salida prematura de paste mode y reintentado');

});

test('_pasteUserCodeWithRetry NO confunde el ">>> " legítimo del Ctrl+C inicial (antes de que arranque paste mode) con una salida prematura', async () => {

    // _pasteBlock() manda un Ctrl+C + espera un prompt limpio ANTES de
    // mandar el Ctrl+E que arranca paste mode -- ese ">>> " inicial es
    // normal y no debería disparar ningún reintento.
    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        // ">>> " ANTES de que "paste mode" se haya confirmado -- es el
        // asentamiento normal del Ctrl+C inicial, no una salida
        // prematura.
        ctx.simulator.eventBus.emit('qemu:output', '>>> \r\n');
        await new Promise((r) => setTimeout(r, 10));
    });

    await ctx._pasteUserCodeWithRetry('codigo normal', 0);

    assert.equal(calls, 1, 'el ">>> " previo a paste mode no debería disparar ningún reintento');

});

test('_pasteUserCodeWithRetry se rinde tras agotar los intentos si la corrupción es persistente', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', fakeCorruptMessage(ReplPanel)), 5);
    });

    await ctx._pasteUserCodeWithRetry('codigo que siempre se corrompe', 0);

    assert.equal(calls, ReplPanel.USER_CODE_PASTE_ATTEMPTS, 'no debería reintentar más allá del tope, ni menos');

});

test('_pasteUserCodeWithRetry corta entre intentos si el usuario pide "Detener" (no agota los 6 intentos)', async () => {

    // BUG REAL (reportado, 2026-10-01): "⏹ Detener" solo cerraba el
    // WebSocket -- el reintento de "Ejecutar" (este bucle) no se
    // enteraba y seguía mandando/reintentando hasta agotar sus 6
    // intentos, varios minutos después de que el usuario ya había
    // pedido parar ("sigue corriendo por detrás").

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            // Simula el click en "Detener" llegando a mitad del primer intento.
            ctx._stopRequested = true;
        }
        ctx.simulator.eventBus.emit('qemu:output', fakeCorruptMessage(ReplPanel));
    });

    await ctx._pasteUserCodeWithRetry('codigo que se corrompe', 0);

    assert.equal(calls, 1, 'no debería arrancar un segundo intento una vez pedido "Detener"');

});

test('_pasteBlock (real) corta el envío línea a línea y manda Ctrl+C en vez de Ctrl+D si "Detener" llega a mitad del pegado', async () => {

    // Mismo bug que el test anterior, pero probando _pasteBlock() de
    // verdad (no el mock de makeCtx) -- confirma que el corte real
    // manda Ctrl+C (cancela paste mode) y NUNCA llega a mandar las
    // líneas restantes ni el Ctrl+D final.

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);
    const sent = [];
    ctx.simulator = {
        eventBus: makeEventBus(),
        qemuBridge: { beginPasteLock() {}, endPasteLock() {}, interrupt() {} },
    };
    ctx.simulator.eventBus.on('qemu:send', (text) => sent.push(text));
    ctx._sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));

    const lines = ['linea1', 'linea2', 'linea3', 'linea4', 'linea5'];
    // Pedimos "Detener" apenas se manda Ctrl+E (la primera línea del
    // envío real, antes que cualquier línea de código).
    ctx.simulator.eventBus.on('qemu:send', (text) => {
        if (text === '\x05') ctx._stopRequested = true;
    });

    await ctx._pasteBlock(lines.join('\n'), 0, { silent: false });

    assert.ok(sent.includes('\x05'), 'debería haber entrado a paste mode');
    assert.ok(sent.includes('\x03'), 'debería cancelar paste mode con Ctrl+C al cortar');
    assert.ok(!sent.includes('\x04'), 'no debería llegar a mandar Ctrl+D (ejecutar) si se canceló');
    assert.ok(
        !lines.some((l) => sent.includes(l + '\n')),
        'no debería haber mandado ninguna línea del bloque después de pedir "Detener"'
    );

});

test('_pasteUserCodeWithRetry corta por tope de tiempo si los reintentos se combinan con el reintento del HAL y tardan demasiado', async () => {

    // BUG REAL (reportado, 2026-10-01): con el .exe real, un log de
    // varios MINUTOS mostró que el reintento de "Ejecutar" (este) y el
    // reintento YA EXISTENTE del HAL por componente (HAL_RETRY_MAX=8,
    // que se resetea en cada reset real de QEMU -- ver
    // _resyncHalAfterBoot) pueden combinarse sin ningún tope conjunto.
    // Acá se simula ese peor caso con cada intento tardando más que el
    // presupuesto total -- debe abortar ANTES de agotar
    // USER_CODE_PASTE_ATTEMPTS, avisando con un mensaje claro, en vez
    // de seguir reintentando en silencio por minutos.

    const ReplPanel = loadReplPanel();
    const originalBudget = ReplPanel.USER_CODE_PASTE_TIME_BUDGET_MS;
    ReplPanel.USER_CODE_PASTE_TIME_BUDGET_MS = 15; // acelerado para el test

    let calls = 0;
    const messages = [];
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20)); // más lento que el presupuesto
        ctx.simulator.eventBus.emit('qemu:output', fakeCorruptMessage(ReplPanel));
    });
    ctx.appendOutput = (text) => messages.push(text);

    try {
        await ctx._pasteUserCodeWithRetry('codigo que siempre se corrompe y tarda', 0);
    } finally {
        ReplPanel.USER_CODE_PASTE_TIME_BUDGET_MS = originalBudget;
    }

    assert.ok(calls < ReplPanel.USER_CODE_PASTE_ATTEMPTS, 'debería cortar antes de agotar todos los intentos configurados');
    assert.ok(
        messages.some((m) => /más de .*s reintentando/.test(m)),
        'debería avisar con un mensaje claro de que cortó por tiempo, no por intentos'
    );

});

test('_pasteUserCodeWithRetry le da más margen (pacing más lento) a cada reintento sucesivo', async () => {

    // BUG REAL (reportado, 2026-10-01): con líneas MUY largas (arrays
    // de píxeles de un NeoMatrix), 3 intentos AL MISMO RITMO que ya
    // había fallado no alcanzaron -- se corrompió las 3 veces seguidas
    // en una máquina real. Reintentar exactamente igual que el intento
    // que ya falló no le da ninguna ventaja extra a la UART emulada.

    const ReplPanel = loadReplPanel();
    const margins = [];
    const ctx = makeCtx(ReplPanel, async (fullCode, halLineCount, opts) => {
        margins.push(opts.marginMultiplier);
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', fakeCorruptMessage(ReplPanel)), 5);
    });

    await ctx._pasteUserCodeWithRetry('codigo con lineas largas', 0);

    const expected = [];
    for (let i = 0; i < ReplPanel.USER_CODE_PASTE_ATTEMPTS; i++) {
        expected.push(Math.min(
            ReplPanel.USER_CODE_PASTE_MARGIN_MAX,
            1 + i * ReplPanel.USER_CODE_PASTE_MARGIN_STEP
        ));
    }

    assert.deepEqual(margins, expected);
    assert.ok(margins[0] === 1, 'el primer intento no debería tener margen extra (no hay corrupción todavía)');
    assert.ok(margins[margins.length - 1] <= ReplPanel.USER_CODE_PASTE_MARGIN_MAX, 'el margen nunca debería superar el tope');

});

test('_wrapUserCodeForIntegrity codifica el código entero en base64 recuperable (ningún byte se pierde ANTES de viajar)', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const userCode = 'while True:\n    print("hola")\n    sleep(0.1)\n';
    const wrapped = ctx._wrapUserCodeForIntegrity(userCode);

    // El wrapper tiene que declarar el bloque base64 adentro de un
    // string triple-comillado -- extraerlo y decodificarlo debe dar
    // EXACTAMENTE el código original, byte a byte.
    const match = wrapped.match(/_uc_raw = """([\s\S]*?)"""/);
    assert.ok(match, 'el wrapper debería tener un bloque _uc_raw');

    const b64Joined = match[1].split(/\s+/).join('');
    const decoded = Buffer.from(b64Joined, 'base64').toString('utf8');

    assert.equal(decoded, userCode, 'decodificar el base64 del wrapper debe reproducir el código original exacto');

});

test('_wrapUserCodeForIntegrity nunca ejecuta el código dentro de un try/except (un bug real del usuario debe mostrarse tal cual)', () => {

    // A diferencia de _wrapHalForIsolation() (que SÍ atrapa cualquier
    // excepción y la reporta como HAL_ERROR), acá el exec() real tiene
    // que quedar FUERA de cualquier try/except -- si el código del
    // usuario tiene un bug genuino, su traceback real tiene que
    // mostrarse normal, no camuflarse como "corrupción".
    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const wrapped = ctx._wrapUserCodeForIntegrity('1/0  # ZeroDivisionError a propósito');

    const execLine = wrapped.split('\n').find((l) => l.includes('exec('));
    assert.ok(execLine, 'el wrapper debería tener una línea con exec(...)');
    assert.ok(!/^\s*(try|except)/.test(execLine), 'la línea de exec() no debería estar envuelta en try/except');

});

test('_wrapUserCodeForIntegrity NUNCA incluye el marcador de corrupción completo, de corrido, en su propio código fuente', () => {

    // BUG REAL, el más grave de todos (encontrado recién al simular
    // _pasteUserCodeWithRetry de punta a punta con un _pasteBlock que
    // hace eco de cada línea del wrapper, como hace QEMU de verdad):
    // paste mode ecoa el CÓDIGO tal cual se pega, ANTES de ejecutar una
    // sola línea -- y el listener de "qemu:output" de
    // _pasteUserCodeWithRetry no depende de _suppressEcho, escucha
    // TODO. Antes de este fix, el wrapper armaba
    // `print("USER_CODE_CORRUPT:...")` como un ÚNICO string literal de
    // Python -- ese texto FUENTE, ecoado durante el pegado, YA
    // contenía el marcador completo, así que el detector se disparaba
    // SOLO en TODAS las corridas, exitosas o no (confirmado:
    // una tanda perfecta, sin ninguna corrupción real, agotaba los 6
    // intentos igual). Ahora el marcador se arma con DOS strings de
    // Python concatenados en tiempo de ejecución -- el texto PEGADO
    // (fuente) nunca debe contener el marcador completo de corrido.
    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const wrapped = ctx._wrapUserCodeForIntegrity('print("hola")');

    assert.ok(
        !wrapped.includes(ReplPanel.USER_CODE_CORRUPT_MARKER),
        'el código fuente del wrapper (lo que se pega/ecoa) no debería contener el marcador completo -- solo el RESULTADO de ejecutarlo debería armarlo'
    );

});

test('_pasteUserCodeWithRetry NO reintenta en un pegado perfecto (sin corrupción real) -- el eco de su propio wrapper no debe confundirse con el marcador', async () => {

    // Reproduce el bug de arriba contra _pasteUserCodeWithRetry
    // completo: un _pasteBlock realista que ecoa cada línea del
    // fullCode (como paste mode de verdad) y después imprime el
    // resultado normal de ejecutar -- sin ninguna corrupción -- no
    // debería disparar NINGÚN reintento.
    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);
    ReplPanel.USER_CODE_PASTE_SETTLE_MS = 20;
    const appended = [];
    ctx.simulator = { eventBus: makeEventBus() };
    ctx.appendOutput = (t) => appended.push(t);
    ctx._sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));

    const wrapped = ctx._wrapUserCodeForIntegrity('print("hola")');
    const halLineCount = wrapped.split('\n').length;

    let calls = 0;
    ctx._pasteBlock = async (code) => {
        calls++;
        for (const line of code.split('\n')) {
            ctx.simulator.eventBus.emit('qemu:output', line + '\n');
        }
        ctx.simulator.eventBus.emit('qemu:output', 'hola\n'); // salida real, sin corrupción
    };

    await ctx._pasteUserCodeWithRetry(wrapped, halLineCount);

    assert.equal(calls, 1, 'un pegado perfecto no debería disparar ningún reintento');
    assert.equal(appended.length, 0, 'no debería mostrarse ningún mensaje de "reintentando" en un pegado perfecto');

});
