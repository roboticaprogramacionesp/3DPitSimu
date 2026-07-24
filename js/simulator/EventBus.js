/*
==========================================================
 PitSimulator
 Archivo: EventBus.js
 Sistema simple de eventos (publicador/suscriptor)
 para comunicar módulos sin acoplarlos directamente
 (ej: SelectionManager -> PropertyPanel)
==========================================================
*/

class EventBus {

    constructor() {

        this.listeners = {};

    }

    //------------------------------------------------------
    // Suscribirse a un evento
    //------------------------------------------------------

    on(event, callback) {

        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }

        this.listeners[event].push(callback);

    }

    //------------------------------------------------------
    // Cancelar suscripción
    //------------------------------------------------------

    off(event, callback) {

        if (!this.listeners[event]) return;

        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);

    }

    //------------------------------------------------------
    // Emitir un evento
    //------------------------------------------------------

    emit(event, data) {

        if (!this.listeners[event]) return;

        this.listeners[event].forEach(callback => {

            try {
                callback(data);
            } catch (err) {
                console.error(`Error en listener de "${event}":`, err);
            }

        });

    }

}