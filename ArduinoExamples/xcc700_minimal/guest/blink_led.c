void p1_print(char *text);
void p1_print_int(int value);
int p1_millis();
void p1_delay(int ms);
void p1_pin_mode(int pin, int mode);
void p1_digital_write(int pin, int value);

int main() {
    int led = 2;
    int i = 0;
    int started = 0;

    p1_print("xcc700 guest start\n");
    started = p1_millis();
    p1_pin_mode(led, 1);

    while (i < 6) {
        p1_digital_write(led, 1);
        p1_delay(120);
        p1_digital_write(led, 0);
        p1_delay(120);
        i = i + 1;
    }

    p1_print("guest elapsed ms\n");
    p1_print_int(p1_millis() - started);
    return 123;
}
