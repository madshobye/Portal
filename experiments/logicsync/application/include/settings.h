#ifndef SETTINGS_H
#define SETTINGS_H
#include "facade.h"
#define SETTINGS_PAGE0 0x0803b000u
#define SETTINGS_PAGE1 0x0803b800u
#define SETTINGS_PAGE_SIZE 2048u
typedef struct {
 FacadeConfig facade;
 uint8_t dhcp,ip[4],mask[4],gateway[4];
 char broker[64],username[32],password[32];
 uint16_t port;
 char artist_key[33],admin_key[33];
} Settings;
/* Storage callbacks allow power-loss and corruption tests without hardware. */
typedef struct {
 void (*read)(uint32_t address,void *out,unsigned length);
 int (*erase)(uint32_t address);
 int (*write)(uint32_t address,uint32_t word);
} SettingsStorage;
int settings_valid(const Settings *settings);
int settings_load(const SettingsStorage *storage,Settings *settings);
int settings_save(const SettingsStorage *storage,const Settings *settings);
#endif
