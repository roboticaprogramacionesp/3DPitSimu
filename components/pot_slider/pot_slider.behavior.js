/*
==========================================================
 PitSimulator — pot_slider.behavior.js
 No tenía behavior.js propio -- Renderer.bindSlider() maneja el
 arrastre directo en el canvas (sin panel de propiedades custom), y
 SignalEngine.setSliderPosition() ya sabía todo lo que hacía falta.
 Este archivo existe solo para el gancho "resync" (ver la nota grande
 en ComponentBehaviorRegistry.js): sin resorte de centrado, el valor
 se queda donde lo dejaste, pero antes nunca se reenviaba al firmware
 después de una reconexión de QEMU -- volvía al default del hal.py
 hasta el próximo arrastre.
==========================================================
*/

ComponentBehaviorRegistry.register("pot_slider", {

    signal: {
        // Mismo criterio que pot_rotary.behavior.js -- component.sliderState
        // recién existe después del primer arrastre (no vive en
        // component.properties a propósito, no es un dato que tenga
        // sentido guardar en el archivo del proyecto).
        resync(component, engine) {
            if (component.sliderState) {
                engine.setSliderPosition(component, component.sliderState.n01);
            }
        },
    },

});
