# xcc700 Minimal ELF Upload Test

This is an isolated Arduino experiment for running a tiny `xcc700`-compiled Xtensa ELF on an ESP32.

It is not a P1E replacement path yet. The goal is to test the smallest useful chain:

1. Compile a tiny C source with vendored `xcc700`.
2. Upload the resulting ELF over USB serial.
3. Load and relocate the ELF on the ESP32.
4. Resolve a tiny host ABI.
5. Run `main()` once and return to the Arduino sketch.

## Files

- `xcc700_minimal.ino` - Arduino firmware with the serial upload protocol.
- `XccElfLoader.*` - intentionally narrow ELF loader for the current `xcc700` output.
- `guest/blink_led.c` - tiny guest program.
- `tools/xcc700/xcc700.c` - vendored source from `valdanylchuk/xcc700` so we can patch error handling and compiler behavior locally.
- `tools/build_guest.sh` - builds the vendored compiler and compiles the guest C file.
- `tools/upload_elf.py` - uploads a compiled ELF over USB serial.
- `tools/build_and_upload.sh` - builds and uploads the default guest in one step.

## Compile And Flash The Arduino Firmware

Use Arduino IDE or `arduino-cli` with a normal ESP32 classic board target.

Example:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 ArduinoExamples/xcc700_minimal
arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/cu.wchusbserialXXXX ArduinoExamples/xcc700_minimal
```

## Build And Upload A Guest ELF

```sh
cd ArduinoExamples/xcc700_minimal
ESP32_PORT=/dev/cu.wchusbserialXXXX ./tools/build_and_upload.sh
```

Or as two explicit steps:

```sh
./tools/build_guest.sh guest/blink_led.c .build/blink_led.elf
./tools/upload_elf.py --port /dev/cu.wchusbserialXXXX .build/blink_led.elf
```

The board expects:

```text
P1E_XCC700_ELF <byte_count> <crc32_hex>
```

It replies with `READY`, then receives the raw ELF bytes.

## Current Host ABI

The guest C program can declare and call:

```c
void p1_print(char *text);
void p1_print_int(int value);
int p1_millis();
void p1_delay(int ms);
void p1_pin_mode(int pin, int mode);
void p1_digital_write(int pin, int value);
```

## Intentional Limits

The loader only accepts the narrow ELF shape emitted by the current `xcc700` source:

- 32-bit little-endian Xtensa `ET_REL`.
- Sections: `.text`, `.rodata`, `.bss`, `.rela`, `.symtab`, `.strtab`.
- Relocations: `R_XTENSA_RELATIVE` and `R_XTENSA_JMP_SLOT`.

If a new compiler experiment emits another relocation or layout, the loader should fail loudly instead of guessing.

## Safety Notes

This is native code, not a sandbox. A bad guest can corrupt memory or crash the board. For now, keep guest programs small and one-shot.

Good first tests:

- Print from guest code.
- Blink GPIO 2.
- Verify repeated uploads do not leak heap.
- Verify unresolved symbols produce `LOAD_ERROR`.
- Verify intentionally damaged ELF files are rejected.
