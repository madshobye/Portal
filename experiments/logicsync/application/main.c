#include "app.h"
#include "runtime.h"
int main(void){board_init();runtime_init();dmx_init();network_init();services_init();for(;;){network_poll();services_poll();runtime_poll();update_poll();}}
