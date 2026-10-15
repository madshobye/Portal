#ifndef FACADE_PROTOCOL_H
#define FACADE_PROTOCOL_H
#include <stdint.h>
#include "settings.h"
int protocol_config(const char*,unsigned,Settings*);
#define FACADE_MESSAGE_MAX 6144u
/* Suffix begins with /set/ or /pixels/. owner=0 denotes public MQTT. */
int facade_message(const char *suffix,const char *body,unsigned length,unsigned owner,uint32_t now);
#endif
