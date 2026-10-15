#ifndef APP_H
#define APP_H
#include <stdint.h>
#include <stddef.h>
uint32_t sys_now(void);
unsigned memory_stack_untouched(void);
void board_init(void);void network_init(void);void network_poll(void);void dmx_init(void);void dmx_tick(void);
int dmx_set(unsigned port,unsigned channel,const uint8_t *data,unsigned count);void dmx_blackout(void);
uint32_t dmx_frames(unsigned);
unsigned dmx_enabled(void);uint8_t dmx_value(unsigned p,unsigned c);
void dmx_frame(const uint8_t data[4][512]);
void services_init(void);void services_poll(void);
extern uint32_t ethernet_rx,ethernet_tx;
int update_mark_boot_success(void);void update_schedule(void);void update_poll(void);void dmx_stop(void);
int control_command(const char*,unsigned);void control_poll(void);unsigned control_mqtt_connected(void);
int control_configure(const char*,unsigned);
unsigned control_state(char*,unsigned);
unsigned control_configuration(char*,unsigned);
int control_apply(const char*,const char*,unsigned,unsigned);
int websocket_accept(const char*,unsigned,char*);
#endif
