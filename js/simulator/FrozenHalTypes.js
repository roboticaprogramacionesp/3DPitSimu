// =============================================================
// PitSimulator — lista de tipos de componente con HAL congelado.
//
// Generado por firmware/frozen_hal/build_components.js -- NO
// EDITAR A MANO. Correr "node firmware/frozen_hal/build_components.js"
// de nuevo después de cambiar un .hal.py y volver a congelar/
// recompilar el firmware (ver README.md de esa carpeta).
//
// ReplPanel.js usa esto para decidir, ESTÁTICAMENTE (sin sondear
// el firmware conectado en tiempo real), si intentar
// "import _pit_hal_<tipo>" (rápido) en vez de pastear el .hal.py
// completo (lento). Si el firmware conectado resulta ser más
// viejo y en realidad NO tiene ese tipo congelado, el import
// falla con un HAL_ERROR normal y ReplPanel.js cae solo al paste
// completo para ESE tipo -- ver el listener de "qemu:hal-error"
// en ReplPanel.bindBusEvents(). Reemplaza a la sonda en vivo que
// había antes (_probeFrozenTypes()/FROZEN_PROBE_MARK, quitada por
// tener una carrera real con su propio timeout -- ver
// project_frozen_probe_timeout_fix.md en la memoria del proyecto).
// =============================================================

const PIT_FROZEN_HAL_TYPES = new Set([
    "adkey",
    "adkey_real",
    "bh1750",
    "bmp180",
    "bmp280",
    "buzzer",
    "dht11",
    "ds3231",
    "hcsr04",
    "ky-009",
    "ky-011",
    "ky-016",
    "ky_001",
    "lcd16x2",
    "lcd_16x2_i2c",
    "max7219",
    "mpu6050",
    "neopixel_matrix",
    "neopixel_ring",
    "oled",
    "qmc5883l",
    "rc522",
    "rc522_real",
    "sg90",
    "tcs34725",
    "tft_st7789",
    "tm1637",
]);
