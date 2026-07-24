/*
==========================================================
 PitSimulator — sg90.behavior.js
 Comportamiento de render del servo SG90, migrado tal cual
 desde Renderer.tagServoElements()/el bloque de ángulo inicial
 de Renderer.renderComponent() hacia ComponentBehaviorRegistry.
==========================================================
*/

ComponentBehaviorRegistry.register("sg90", {

    render: {

        tag(component, graphic, renderer) {

            const shaft = graphic.querySelector("#eje");
            if (!shaft) {
                console.warn("[sg90.behavior] No se encontró #eje en el SVG del servo");
                return;
            }

            shaft.setAttribute("data-servo-role", "shaft");
            shaft.setAttribute("data-servo-original-id", "eje");
            shaft.removeAttribute("id");

        },

        // setServoAngle() sigue viviendo en Renderer.js -- tiene otros
        // llamadores (SignalEngine.js, para el ángulo en vivo mandado
        // por el firmware).
        initialState(component, renderer) {
            renderer.setServoAngle(component, component.properties?.angle ?? 90);
        },

    },

});
