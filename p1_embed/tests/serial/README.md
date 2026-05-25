# p1_embed Serial Tests

Run the full ESP32 Classic hardware smoke suite:

```bash
./scripts/esp32/compile-upload.sh p1embed
python3 p1_embed/tests/serial/run_serial_tests.py --port /dev/cu.wchusbserial58741104521
```

Run one group by module-name substring:

```bash
python3 p1_embed/tests/serial/run_serial_tests.py --only errors
python3 p1_embed/tests/serial/run_serial_tests.py --only pwm
```

The tests use only Python standard-library modules. They talk to the firmware through the JSON serial protocol and stop the running Wrench script between cases.
