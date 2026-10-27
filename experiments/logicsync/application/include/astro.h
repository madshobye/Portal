#ifndef FACADE_ASTRO_H
#define FACADE_ASTRO_H
#include <stdint.h>
#include "facade.h"
typedef struct {unsigned valid,on,local_minute,sunset_minute;uint32_t utc;RGB color;} AstroState;
void astro_init(uint32_t now);
void astro_tick(uint32_t now);
int astro_sync(uint32_t utc,uint32_t now);
uint32_t astro_utc(void);
AstroState astro_state(void);
/* Pure functions for date, DST and astronomical boundary verification. */
unsigned astro_offset(uint32_t utc);
unsigned astro_sunset(uint32_t utc_day);
void clock_poll(void);
void clock_set_utc(uint32_t utc);
#endif
