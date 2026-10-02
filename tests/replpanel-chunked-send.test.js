// ==========================================================
// PitSimulator - tests/replpanel-chunked-send.test.js
//
// Regresión para el envío CONFIABLE del código del usuario por pedazos
// chicos confirmados uno por uno (ver _sendUserCodeChunked() y el
// comentario grande junto a USER_CODE_CHUNK_B64_SIZE en js/ui/ReplPanel.js).
//
// Reemplaza al viejo mecanismo de "un bloque gigante, verificado recién
// al final, reintentado completo hasta 6 veces" (tests/replpanel-paste-retry.test.js,
// retirado) -- reportado con un script real de NeoMatrix: las 6
// corridas completas fallaron, siempre con el mismo problema ("de nada
// sirve intentarlo 6 veces si en todas falla"). Acá cada pedazo chico
// se confirma antes de mandar el siguiente, así que un pedazo
// corrompido se reintenta SOLO (barato), no el payload entero.
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

function makeCtx(ReplPanel) {
    const ctx = Object.create(ReplPanel.prototype);
    ReplPanel.USER_CODE_STEP_SETTLE_MS = 20; // acelerado para los tests
    ctx.simulator = { eventBus: makeEventBus() };
    ctx.appendOutput = () => {};
    ctx._sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
    return ctx;
}

// Decide si un bloque generado es el del PASO FINAL (join + checksum
// completo + exec) o el de UN PEDAZO (_uc_c_raw) -- para que el mock de
// _pasteBlock sepa qué par de marcadores (chunk vs final) le toca emitir.
function isFinalBlock(block) {
    return block.includes('_uc_joined = ');
}

function emitOutcome(ctx, ReplPanel, block, outcome) {
    if (outcome === 'silence') return;
    const final = isFinalBlock(block);
    const okMarker  = final ? ReplPanel.USER_CODE_OK_MARKER        : ReplPanel.USER_CODE_CHUNK_OK_MARKER;
    const badMarker = final ? ReplPanel.USER_CODE_CORRUPT_MARKER   : ReplPanel.USER_CODE_CHUNK_BAD_MARKER;
    const marker = outcome === 'ok' ? okMarker : badMarker;
    ctx.simulator.eventBus.emit('qemu:output', marker + (final ? '' : '0') + '\n');
}

// script: array de 'ok' | 'bad' | 'silence', uno por cada llamada a
// _pasteBlock, EN ORDEN -- si se agota, asume 'ok' (para no tener que
// escribir una entrada por cada pedazo en los tests que no les importa).
function makeScriptedPasteBlock(ctx, ReplPanel, script) {
    const calls = [];
    let i = 0;
    const fn = async (block) => {
        calls.push(block);
        const outcome = i < script.length ? script[i] : 'ok';
        i++;
        emitOutcome(ctx, ReplPanel, block, outcome);
    };
    fn.calls = calls;
    return fn;
}

test('_splitMarker nunca deja que ninguna mitad reconstruya el marcador completo por sí sola, y las dos juntas sí', () => {

    const ReplPanel = loadReplPanel();

    for (const marker of [ReplPanel.USER_CODE_CORRUPT_MARKER, ReplPanel.USER_CODE_OK_MARKER, ReplPanel.USER_CODE_CHUNK_OK_MARKER, ReplPanel.USER_CODE_CHUNK_BAD_MARKER]) {
        const [p1, p2] = ReplPanel._splitMarker(marker);
        assert.equal(p1 + p2, marker, `las dos mitades concatenadas deben reconstruir "${marker}"`);
        assert.ok(p1.length > 0 && p2.length > 0, 'ninguna mitad debería quedar vacía');
    }

});

test('_buildUserCodeChunkBlock no contiene ninguno de los dos marcadores de pedazo completos, de corrido, en su propio fuente', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const block = ctx._buildUserCodeChunkBlock('QUJDREVGR0hJSktMTU5PUA==', 0, true);

    assert.ok(!block.includes(ReplPanel.USER_CODE_CHUNK_OK_MARKER), 'no debería contener el marcador de éxito del pedazo completo');
    assert.ok(!block.includes(ReplPanel.USER_CODE_CHUNK_BAD_MARKER), 'no debería contener el marcador de pedazo malo completo');

});

test('_buildUserCodeChunkBlock agrega el preámbulo (import + lista vacía) solo si isFirst', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const first = ctx._buildUserCodeChunkBlock('QUJDRA==', 0, true);
    const rest  = ctx._buildUserCodeChunkBlock('RUZHSA==', 1, false);

    assert.ok(first.includes('_uc_parts = []'), 'el primer pedazo debería inicializar _uc_parts');
    assert.ok(first.includes('import ubinascii'), 'el primer pedazo debería importar ubinascii');
    assert.ok(!rest.includes('_uc_parts = []'), 'un pedazo que no es el primero NO debería reinicializar _uc_parts (perdería los anteriores)');
    assert.ok(!rest.includes('import ubinascii'), 'un pedazo que no es el primero no necesita volver a importar');

});

test('_buildUserCodeChunkBlock recupera el pedazo original byte a byte (round-trip del base64, igual que _wrapHalForIsolation)', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const chunkB64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
    const block = ctx._buildUserCodeChunkBlock(chunkB64, 2, false);

    const match = block.match(/_uc_c_raw = """([\s\S]*?)"""/);
    assert.ok(match, 'debería tener un bloque _uc_c_raw');
    const joined = match[1].split(/\s+/).join('');
    assert.equal(joined, chunkB64, 'el base64 reconstruido debe ser EXACTO al pedazo original');

});

test('_buildUserCodeFinalBlock no contiene ninguno de los dos marcadores finales completos, de corrido, en su propio fuente', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const { block } = ctx._buildUserCodeFinalBlock(100, 500);

    assert.ok(!block.includes(ReplPanel.USER_CODE_CORRUPT_MARKER), 'no debería contener el marcador de corrupción completo');
    assert.ok(!block.includes(ReplPanel.USER_CODE_OK_MARKER), 'no debería contener el marcador de éxito completo');

});

test('_buildUserCodeFinalBlock nunca envuelve el exec() real en un try/except (un bug genuino del usuario debe mostrarse tal cual)', () => {

    const ReplPanel = loadReplPanel();
    const ctx = Object.create(ReplPanel.prototype);

    const { block, execLineIndex } = ctx._buildUserCodeFinalBlock(10, 20);
    const lines = block.split('\n');

    assert.ok(lines[execLineIndex].includes('exec('), 'execLineIndex debería apuntar a la línea real del exec()');
    assert.ok(!/^\s*(try|except)/.test(lines[execLineIndex]), 'la línea de exec() no debería estar envuelta en try/except');

});

test('_sendStepAndConfirm resuelve true apenas ve el marcador de éxito (sin esperar el tope completo)', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_STEP_SETTLE_MS = 2000; // tope alto a propósito
    const ctx = makeCtx(ReplPanel);
    ctx._pasteBlock = async () => {
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', 'UC_CHUNK_OK:0\n'), 5);
    };

    const startedAt = Date.now();
    const ok = await ctx._sendStepAndConfirm('codigo', {
        silent: true, halLineCount: 0,
        okMarker: ReplPanel.USER_CODE_CHUNK_OK_MARKER,
        badMarker: ReplPanel.USER_CODE_CHUNK_BAD_MARKER,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(ok, true);
    assert.ok(elapsedMs < 500, `no debería haber esperado cerca del tope de 2000ms -- tardó ${elapsedMs}ms`);

});

test('_sendStepAndConfirm resuelve false si ve el marcador de "mal"', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel);
    ctx._pasteBlock = async () => {
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', 'UC_CHUNK_BAD:0\n'), 5);
    };

    const ok = await ctx._sendStepAndConfirm('codigo', {
        silent: true, halLineCount: 0,
        okMarker: ReplPanel.USER_CODE_CHUNK_OK_MARKER,
        badMarker: ReplPanel.USER_CODE_CHUNK_BAD_MARKER,
    });

    assert.equal(ok, false);

});

test('_sendStepAndConfirm resuelve false si NO llega ningún marcador (silencio total -- no asume éxito)', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel);
    ctx._pasteBlock = async () => {}; // no emite nada

    const ok = await ctx._sendStepAndConfirm('codigo', {
        silent: true, halLineCount: 0,
        okMarker: ReplPanel.USER_CODE_CHUNK_OK_MARKER,
        badMarker: ReplPanel.USER_CODE_CHUNK_BAD_MARKER,
    });

    assert.equal(ok, false, 'el silencio total debería tratarse como fallo, no como éxito');

});

test('_sendStepAndConfirm también ve el marcador si llega por "qemu:history" (reconexión a mitad de un pedazo)', async () => {

    const ReplPanel = loadReplPanel();
    const ctx = makeCtx(ReplPanel);
    ctx._pasteBlock = async () => {
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:history', 'UC_CHUNK_OK:0\n'), 5);
    };

    const ok = await ctx._sendStepAndConfirm('codigo', {
        silent: true, halLineCount: 0,
        okMarker: ReplPanel.USER_CODE_CHUNK_OK_MARKER,
        badMarker: ReplPanel.USER_CODE_CHUNK_BAD_MARKER,
    });

    assert.equal(ok, true);

});

test('_sendUserCodeChunked manda el código en varios pedazos chicos (no un bloque gigante) y confirma cada uno', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_CHUNK_B64_SIZE = 20; // chico a propósito para forzar varios pedazos en el test
    const ctx = makeCtx(ReplPanel);

    // ~17 líneas de "print(i)" -- bastante más de 20 caracteres de
    // base64 una vez codificado, para forzar varios pedazos.
    const userCode = Array.from({ length: 10 }, (_, i) => `print(${i})`).join('\n');

    const pasteBlock = makeScriptedPasteBlock(ctx, ReplPanel, []); // todo 'ok' por default
    ctx._pasteBlock = pasteBlock;

    await ctx._sendUserCodeChunked(userCode);

    // Último call tiene que ser el bloque FINAL -- todos los anteriores, pedazos.
    assert.ok(pasteBlock.calls.length >= 2, 'debería haber mandado más de un bloque (pedazos + el final)');
    const chunkCalls = pasteBlock.calls.slice(0, -1);
    const finalCall = pasteBlock.calls[pasteBlock.calls.length - 1];
    assert.ok(chunkCalls.every((b) => b.includes('_uc_c_raw')), 'todos los bloques salvo el último deberían ser pedazos');
    assert.ok(isFinalBlock(finalCall), 'el último bloque mandado debería ser el de armado final');

});

test('_sendUserCodeChunked reintenta SOLO el pedazo que falló, no los demás (el punto central del nuevo mecanismo)', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_CHUNK_B64_SIZE = 10;
    const ctx = makeCtx(ReplPanel);

    const userCode = Array.from({ length: 8 }, (_, i) => `print(${i})`).join('\n');

    // El pedazo #2 (tercera llamada a _pasteBlock, índice 2) falla una
    // vez y después sale bien -- todo lo demás, 'ok' a la primera.
    const pasteBlock = makeScriptedPasteBlock(ctx, ReplPanel, ['ok', 'ok', 'bad', 'ok']);
    ctx._pasteBlock = pasteBlock;

    const appended = [];
    ctx.appendOutput = (t) => appended.push(t);

    await ctx._sendUserCodeChunked(userCode);

    assert.ok(
        appended.some((m) => /reintentando pedazo/.test(m)),
        'debería avisar que reintentó un pedazo puntual'
    );
    // El bloque final tiene que haber salido bien sin reintentos propios.
    assert.ok(!appended.some((m) => /paso final/.test(m)), 'el paso final no debería haber necesitado reintento en este escenario');

});

test('_sendUserCodeChunked se rinde y NO sigue con los pedazos siguientes si uno falla todos sus intentos', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_CHUNK_B64_SIZE = 10;
    ReplPanel.USER_CODE_CHUNK_ATTEMPTS = 3;
    const ctx = makeCtx(ReplPanel);

    const userCode = Array.from({ length: 8 }, (_, i) => `print(${i})`).join('\n');

    // El primer pedazo falla SIEMPRE -- nunca debería llegar a mandarse
    // el segundo pedazo ni el bloque final.
    const pasteBlock = makeScriptedPasteBlock(ctx, ReplPanel, ['bad', 'bad', 'bad']);
    ctx._pasteBlock = pasteBlock;

    const appended = [];
    ctx.appendOutput = (t) => appended.push(t);

    await ctx._sendUserCodeChunked(userCode);

    assert.equal(pasteBlock.calls.length, ReplPanel.USER_CODE_CHUNK_ATTEMPTS, 'no debería haber mandado nada después de agotar los intentos del primer pedazo');
    assert.ok(pasteBlock.calls.every((b) => b.includes('_uc_c_raw')), 'ninguno de los intentos debería haber llegado al bloque final');
    assert.ok(appended.some((m) => /No se pudo mandar el código de forma confiable/.test(m)), 'debería avisar con un mensaje claro de que se rindió');

});

test('_sendUserCodeChunked reintenta SOLO el paso final si falla, sin volver a mandar ningún pedazo', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_CHUNK_B64_SIZE = 10;
    const ctx = makeCtx(ReplPanel);

    const userCode = Array.from({ length: 8 }, (_, i) => `print(${i})`).join('\n');

    // Todos los pedazos salen bien a la primera -- el PASO FINAL falla
    // una vez (corrupción en el armado) y sale bien en el reintento.
    // No sabemos de antemano cuántos pedazos hacen falta, así que el
    // script solo define la cola para el final: como está al FINAL del
    // array y el array se agota antes, hay que contar los pedazos.
    const chunkCount = Math.ceil(Buffer.from(userCode).toString('base64').length / ReplPanel.USER_CODE_CHUNK_B64_SIZE);
    const script = new Array(chunkCount).fill('ok').concat(['bad', 'ok']);
    const pasteBlock = makeScriptedPasteBlock(ctx, ReplPanel, script);
    ctx._pasteBlock = pasteBlock;

    const appended = [];
    ctx.appendOutput = (t) => appended.push(t);

    await ctx._sendUserCodeChunked(userCode);

    const finalCalls = pasteBlock.calls.filter(isFinalBlock);
    assert.equal(finalCalls.length, 2, 'el paso final debería haberse mandado 2 veces (1 fallo + 1 reintento exitoso)');
    assert.ok(appended.some((m) => /paso final/.test(m)), 'debería avisar que reintentó el paso final');
    assert.ok(!appended.some((m) => /reintentando pedazo/.test(m)), 'no debería haber reintentado ningún pedazo en este escenario');

});

test('_sendUserCodeChunked corta de inmediato si el usuario pide "Detener" a mitad de un pedazo', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_CHUNK_B64_SIZE = 10;
    const ctx = makeCtx(ReplPanel);

    const userCode = Array.from({ length: 8 }, (_, i) => `print(${i})`).join('\n');

    let calls = 0;
    ctx._pasteBlock = async (block) => {
        calls++;
        if (calls === 2) ctx._stopRequested = true; // "Detener" llega a mitad del 2do pedazo
        emitOutcome(ctx, ReplPanel, block, 'ok');
    };

    await ctx._sendUserCodeChunked(userCode);

    assert.equal(calls, 2, 'no debería haber mandado nada más después de "Detener"');

});

test('_sendUserCodeChunked corta con un aviso claro si se excede el tope de tiempo total', async () => {

    const ReplPanel = loadReplPanel();
    ReplPanel.USER_CODE_CHUNK_B64_SIZE = 10;
    ReplPanel.USER_CODE_SEND_TIME_BUDGET_MS = 10; // acelerado para el test
    const ctx = makeCtx(ReplPanel);

    const userCode = Array.from({ length: 8 }, (_, i) => `print(${i})`).join('\n');

    let calls = 0;
    ctx._pasteBlock = async (block) => {
        calls++;
        await new Promise((r) => setTimeout(r, 15)); // más lento que el presupuesto
        emitOutcome(ctx, ReplPanel, block, 'ok');
    };

    const appended = [];
    ctx.appendOutput = (t) => appended.push(t);

    await ctx._sendUserCodeChunked(userCode);

    assert.ok(calls < 5, 'debería haber cortado bastante antes de terminar todos los pedazos');
    assert.ok(appended.some((m) => /más de .*s reintentando/.test(m)), 'debería avisar que cortó por tiempo');

});
