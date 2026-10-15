#ifndef FACADE_RUNTIME_H
#define FACADE_RUNTIME_H
#include "settings.h"
extern Settings runtime_settings;
typedef struct {
 uint8_t dhcp,ip[4],mask[4],gateway[4];
 char broker[64],username[32],password[32];
 uint16_t port;
} NetworkSettings;
extern NetworkSettings runtime_network;
int runtime_network_pending(void);
void runtime_init(void);
void runtime_poll(void);
void runtime_changed(void);
int runtime_save(void);
int runtime_admin(const char *key,unsigned length);
int runtime_artist(const char *key,unsigned length);
void runtime_event(const char *event);
const char *runtime_last_event(void);
unsigned runtime_event_count(void);
const char*runtime_event_get(unsigned,uint32_t*);
unsigned runtime_save_ok(void);
void network_address(char *out,unsigned size);
int network_ready(void);
#endif
