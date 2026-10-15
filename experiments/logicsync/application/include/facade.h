#ifndef FACADE_H
#define FACADE_H
#include <stdint.h>
#define FACADE_PIXELS 448u
#define FACADE_IDLE_MS 600000u
#define FACADE_FADE_MS 3000u
#define FACADE_ARTIST_MS 10000u
#define FACADE_TRANSITION_MS 700u
typedef struct { uint8_t r,g,b; } RGB;
typedef struct {
 uint8_t fixtures[4],effect,brightness,limit,color[3];
 uint16_t speed;
} FacadeConfig;
enum { FX_FIRE,FX_WATER,FX_CHASE,FX_RAINBOW,FX_PULSE,FX_SPARKLE,FX_WASH,FX_LIGHTNING,FX_GRADIENT,FX_SOLID,FX_COUNT };
enum { MODE_EFFECT,MODE_MQTT,MODE_ARTIST,MODE_RAW };
extern const char *const facade_effect_names[FX_COUNT];
extern FacadeConfig facade_config;
void facade_init(uint32_t now);
int facade_configure(const FacadeConfig *config,uint32_t now);
unsigned facade_count(void);
int facade_map(unsigned pixel,unsigned *port,unsigned *channel);
int facade_effect(unsigned effect,uint32_t now);
int facade_color(RGB color,uint32_t now);
int facade_brightness(unsigned value,uint32_t now);
int facade_speed(unsigned value,uint32_t now);
int facade_pixels(unsigned owner,unsigned start,const RGB *pixels,unsigned count,uint32_t now);
int facade_clear(unsigned owner,uint32_t now);
int facade_release(unsigned owner,uint32_t now);
int facade_release_request(unsigned owner,uint32_t now);
int facade_claim(unsigned owner,uint32_t now);
int facade_keepalive(unsigned owner,uint32_t now);
void facade_disconnect(unsigned owner,uint32_t now);
int facade_raw(unsigned owner,unsigned port,unsigned channel,const uint8_t *data,unsigned count,uint32_t now);
void facade_render(uint32_t now,uint8_t dmx[4][512]);
unsigned facade_mode(void);
unsigned facade_owner(void);
uint32_t facade_inactive(uint32_t now);
#endif
