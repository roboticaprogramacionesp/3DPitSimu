// ==========================================================
// PitSimulator - tests/replpanel-rawpaste.test.js
//
// Regresión para el envío del código del usuario por "raw-paste" (el
// control de flujo REAL que MicroPython ya trae para links lentos/no
// confiables -- ver el comentario grande junto a
// ReplPanel.USER_CODE_RAWPASTE_ATTEMPTS y server.js/runRawPasteExec()).
//
// Reemplaza al pacing calculado a mano como camino PRINCIPAL -- el
// envío por pedazos chicos (_sendUserCodeChunked, ver
// tests/replpanel-chunked-send.test.js) queda como RESPALDO para
// firmwares que no soporten raw-paste. Acá solo se prueba la lógica
// del lado de ReplPanel.js (armado del bloque, el pedido/respuesta
// contra "qemu:rawpaste-result", y cuándo cae al respaldo) -- la
// negociación byte a byte en sí vive entera en server.js y no es
// testeable desde este archivo (no hay un QEMU real en estos tests).
// ==========================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReplPanel() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'ReplPanel.js'), 'utf8');
    const context = {
        console, setTimeout, clearTimeout, TextEncoder,
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

// qemuBridge mínimo: sendRawPasteRequest encola un envío de
// "qemu:rawpaste-result" (vía microtask, como llegaría de verdad por
// WebSocket) con el resultado que indique el script del test.
function makeCtx(ReplPanel, { rawPasteResults = [] } = {}) {
    const ctx = Object.create(ReplPanel.prototype);
    ReplPanel.USER_CODE_STEP_SETTLE_MS = 20; // acelerado para los tests
    ReplPanel.RAW_PASTE_RESULT_TIMEOUT_MS = 50; // idem
    const eventBus = makeEventBus();
    ctx.simulator = { eventBus };
    ctx.appendOutput = () => {};
    ctx._sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
    ctx._rawPasteUnsupported = false; // el constructor real lo inicializa así -- Object.create() no corre el constructor

    let callIndex = 0;
    const sendRawPasteRequest = (code) => {
        const outcome = rawPasteResults[callIndex] !== undefined ? rawPasteResults[callIndex] : { ok: true };
        callIndex++;
        setTimeout(() => {
            eventBus.emit('qemu:rawpaste-result', outcome.result || outcome);
            if (outcome.okMarker !== false && (outcome.result || outcome).ok) {
                eventBus.emit('qemu:output', ReplPanel.USER_CODE_OK_MARKER + '\n');
            }
            if (outcome.corruptMarker) {
                eventBus.emit('qemu:output', ReplPanel.USER_CODE_CORRUPT_MARKER + 'len=1 sum=1 esperado_len=2 esperado_sum=2\n');
            }
        }, 2);
        return true;
    };
    sendRawPasteRequest.callCount = () => callIndex;

    ctx.simulator.qemuBridge = {
        beginPasteLock() {},
        endPasteLock() {},
        sendRawPasteRequest,
    };

    return ctx;
}

test('_buildRawPasteUserBlock no contiene ninguno de los dos marcadores completos, de corrido, en su propio fuente', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const block = ctx._buildRawPasteUserBlock('print("hola")');

    assert.ok(!block.includes(ReplPanel.USER_CODE_OK_MARKER), 'no debería contener el marcador de éxito completo');
    assert.ok(!block.includes(ReplPanel.USER_CODE_CORRUPT_MARKER), 'no debería contener el marcador de corrupción completo');

});

test('_buildRawPasteUserBlock recupera el código original byte a byte (round-trip del base64)', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const userCode = 'for i in range(3):\n    print(i)\n';
    const block = ctx._buildRawPasteUserBlock(userCode);

    const match = block.match(/_uc_raw = """([\s\S]*?)"""/);
    assert.ok(match, 'debería tener un bloque _uc_raw');
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    assert.equal(decoded, userCode, 'decodificar el base64 del bloque debe reproducir el código original exacto');

});

test('_buildRawPasteUserBlock nunca envuelve el exec() real en un try/except', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const block = ctx._buildRawPasteUserBlock('1/0');
    const execLine = block.split('\n').find((l) => l.includes('exec('));

    assert.ok(execLine, 'debería tener una línea con exec(...)');
    assert.ok(!/^\s*(try|except)/.test(execLine), 'la línea de exec() no debería estar envuelta en try/except');

});

test('_sendRawPasteExec devuelve el resultado que llega por "qemu:rawpaste-result"', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, { rawPasteResults: [{ result: { ok: true }, okMarker: false }] });

    const result = await ctx._sendRawPasteExec('codigo');

    assert.deepEqual(result, { ok: true });

});

test('_sendRawPasteExec devuelve {ok:false, reason:"not_connected"} si no hay conexión para mandar el pedido', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel);
    ctx.simulator.qemuBridge.sendRawPasteRequest = () => false; // sin conexión

    const result = await ctx._sendRawPasteExec('codigo');

    // assert.equal (no deepEqual) a propósito -- este objeto lo crea
    // código corriendo DENTRO del vm.Context de ReplPanel.js, con un
    // Object.prototype de ESE realm, distinto al de este archivo de
    // test -- deepStrictEqual los trata como no-iguales aunque tengan
    // la misma forma. Comparar los campos primitivos alcanza.
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not_connected');

});

test('_sendRawPasteExec devuelve {ok:false, reason:"no_result"} si nunca llega ninguna respuesta (silencio total)', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel);
    ctx.simulator.qemuBridge.sendRawPasteRequest = () => true; // "mandado", pero nunca contesta nada

    const result = await ctx._sendRawPasteExec('codigo');

    assert.equal(result.ok, false); // ver el comentario de assert.equal en el test anterior (realms distintos)
    assert.equal(result.reason, 'no_result');

});

test('_sendUserCodeViaRawPaste cae al respaldo DE UNA ante CUALQUIER fallo de negociación (no solo "raw_paste_unsupported")', async () => {

    // BUG REAL encontrado probando esto contra el firmware real de
    // este proyecto, en una conexión totalmente limpia (sin ninguna
    // corrupción de por medio): Ctrl+A nunca hizo entrar a raw REPL
    // -- "no_raw_repl", no la señal explícita "R\x00". Reintentar el
    // envío completo 3 veces ante esto es plata perdida (~24s) si ya
    // sabemos que este firmware puntual no lo soporta -- se trata
    // igual que la señal explícita.
    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, { rawPasteResults: [{ result: { ok: false, reason: 'no_raw_repl' } }] });
    let chunkedCalls = 0;
    ctx._sendUserCodeChunked = async () => { chunkedCalls++; };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), 1, 'no debería reintentar un fallo de negociación');
    assert.equal(chunkedCalls, 1, 'debería haber caído al respaldo de pedazos');
    assert.equal(ctx._rawPasteUnsupported, true, 'debería recordar que este firmware no soporta raw-paste');

});

test('_sendUserCodeViaRawPaste no cae al respaldo si raw-paste confirma éxito de punta a punta', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, { rawPasteResults: [{ result: { ok: true } }] });
    let chunkedCalled = false;
    ctx._sendUserCodeChunked = async () => { chunkedCalled = true; };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(chunkedCalled, false, 'no debería haber caído al respaldo de pedazos');
    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), 1, 'debería haber mandado un solo pedido de raw-paste');

});

test('_sendUserCodeViaRawPaste cae al respaldo DE UNA (sin reintentar) si el firmware contesta que no soporta raw-paste, y lo recuerda para esta conexión', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, { rawPasteResults: [{ result: { ok: false, reason: 'raw_paste_unsupported' } }] });
    let chunkedCalls = 0;
    ctx._sendUserCodeChunked = async () => { chunkedCalls++; };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), 1, 'no debería reintentar la negociación si la respuesta fue explícita');
    assert.equal(chunkedCalls, 1, 'debería haber caído al respaldo de pedazos');
    assert.equal(ctx._rawPasteUnsupported, true, 'debería recordar que este firmware no soporta raw-paste');

    // Una segunda corrida en la MISMA conexión ni siquiera debería
    // intentar la negociación de nuevo.
    await ctx._sendUserCodeViaRawPaste('print("de nuevo")');
    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), 1, 'no debería volver a intentar raw-paste una vez que ya se sabe que no lo soporta');
    assert.equal(chunkedCalls, 2, 'la segunda corrida debería ir directo al respaldo');

});

test('_sendUserCodeViaRawPaste reintenta el envío completo ante un fallo puntual (timeout/abort), no un fallback inmediato', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, {
        rawPasteResults: [
            { result: { ok: false, reason: 'device_aborted_or_timeout' } },
            { result: { ok: true } },
        ],
    });
    let chunkedCalled = false;
    ctx._sendUserCodeChunked = async () => { chunkedCalled = true; };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), 2, 'debería haber reintentado el envío completo una vez');
    assert.equal(chunkedCalled, false, 'no debería haber caído al respaldo -- el segundo intento salió bien');
    assert.equal(ctx._rawPasteUnsupported, false, 'un fallo puntual no significa "no soportado"');

});

test('_sendUserCodeViaRawPaste cae al respaldo tras agotar los intentos si cada envío falla por motivos puntuales (no "no soportado")', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, {
        rawPasteResults: new Array(ReplPanel.USER_CODE_RAWPASTE_ATTEMPTS).fill({ result: { ok: false, reason: 'no_eot_ack' } }),
    });
    let chunkedCalls = 0;
    ctx._sendUserCodeChunked = async () => { chunkedCalls++; };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), ReplPanel.USER_CODE_RAWPASTE_ATTEMPTS, 'debería haber agotado todos los intentos');
    assert.equal(chunkedCalls, 1, 'debería haber caído al respaldo tras agotar los intentos');
    assert.equal(ctx._rawPasteUnsupported, false, 'agotar intentos por timeouts puntuales no significa "no soportado"');

});

test('_sendUserCodeViaRawPaste reintenta si los bytes llegaron pero el checksum final detectó corrupción (rarísimo, pero posible)', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, {
        rawPasteResults: [
            { result: { ok: true }, okMarker: false, corruptMarker: true },
            { result: { ok: true } },
        ],
    });
    let chunkedCalled = false;
    ctx._sendUserCodeChunked = async () => { chunkedCalled = true; };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(ctx.simulator.qemuBridge.sendRawPasteRequest.callCount(), 2, 'debería haber reintentado el envío completo ante la corrupción detectada');
    assert.equal(chunkedCalled, false);

});

test('_sendUserCodeViaRawPaste corta de inmediato si el usuario pide "Detener" entre intentos', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel, {
        rawPasteResults: [
            { result: { ok: false, reason: 'device_aborted_or_timeout' } },
            { result: { ok: true } },
        ],
    });
    let chunkedCalled = false;
    ctx._sendUserCodeChunked = async () => { chunkedCalled = true; };

    const originalSend = ctx.simulator.qemuBridge.sendRawPasteRequest;
    ctx.simulator.qemuBridge.sendRawPasteRequest = (code) => {
        const result = originalSend(code);
        if (originalSend.callCount() === 1) ctx._stopRequested = true; // "Detener" llega justo después del 1er intento
        return result;
    };

    await ctx._sendUserCodeViaRawPaste('print("hola")');

    assert.equal(originalSend.callCount(), 1, 'no debería haber mandado un segundo pedido después de "Detener"');
    assert.equal(chunkedCalled, false, 'no debería caer al respaldo tampoco -- "Detener" corta todo de una');

});
