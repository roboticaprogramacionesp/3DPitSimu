// ==========================================================
// PitSimulator - tests/replpanel-paste-retry.test.js
//
// Regresión para ReplPanel._pasteUserCodeWithRetry() (ver
// js/ui/ReplPanel.js) -- reintento automático de "Ejecutar" cuando el
// código del usuario se corrompe en tránsito (la UART emulada de QEMU
// puede perder bytes bajo carga real). BUG REAL que esto cubre
// (2026-10-01, reportado con un script real de NeoMatrix -- arrays de
// píxeles largos, mucho más propensos a la corrupción que un script
// corto): la primera versión de este fix solo escuchaba la señal de
// corrupción DESPUÉS de que el envío completo terminara -- para
// código largo (varios segundos de pacing en server.js) la corrupción
// podía pasar A MITAD del envío, mucho antes de que el watcher
// arrancara, así que se perdía por completo. El caso "corrupción a
// mitad de un envío largo" de acá abajo es justo el que reveló ese
// bug -- no sacarlo aunque parezca redundante con el de abajo.
// ==========================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReplPanel() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'ReplPanel.js'), 'utf8');
    const context = { console, setTimeout, clearTimeout };
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

test('_pasteUserCodeWithRetry reintenta si el error llega DESPUÉS de que _pasteBlock ya resolvió', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', 'SyntaxError: invalid syntax\n'), 5);
        }
    });

    await ctx._pasteUserCodeWithRetry('codigo corto', 0);

    assert.equal(calls, 2, 'debería haber reintentado una vez');

});

test('_pasteUserCodeWithRetry reintenta si el error llega A MITAD de un envío largo (el bug real)', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        if (calls === 1) {
            // El error aparece MIENTRAS _pasteBlock() todavía está
            // "enviando" (el await de abajo todavía no resolvió) --
            // simula un script largo donde la corrupción pasa a mitad
            // del envío, no al final.
            setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', 'SyntaxError: invalid syntax\n'), 5);
            await new Promise((r) => setTimeout(r, 30));
        }
    });

    await ctx._pasteUserCodeWithRetry('codigo largo', 0);

    assert.equal(calls, 2, 'debería haber detectado la corrupción aunque pasara a mitad del envío, y reintentado');

});

test('_pasteUserCodeWithRetry se rinde tras agotar los intentos si el error es persistente (bug real del usuario)', async () => {

    const ReplPanel = loadReplPanel();
    let calls = 0;
    const ctx = makeCtx(ReplPanel, async () => {
        calls++;
        setTimeout(() => ctx.simulator.eventBus.emit('qemu:output', 'SyntaxError: invalid syntax\n'), 5);
    });

    await ctx._pasteUserCodeWithRetry('codigo con un bug real', 0);

    assert.equal(calls, ReplPanel.USER_CODE_PASTE_ATTEMPTS, 'no debería reintentar más allá del tope, ni menos');

});
