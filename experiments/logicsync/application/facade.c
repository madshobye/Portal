/* Portable fixed-memory facade engine. No network, heap, or peripheral access. */
#include "facade.h"
#include "string.h"
const char *const facade_effect_names[FX_COUNT]={"Fire","Water Waves","Chase","Rainbow","Pulse","Sparkle","Color Wash","Lightning","Moving Gradient","Solid Color"};
FacadeConfig facade_config;
static RGB custom[FACADE_PIXELS],previous[FACADE_PIXELS],current[FACADE_PIXELS];
static uint8_t raw[4][512];
static unsigned mode,owner;
static unsigned scheduled,schedule_on,manual,automatic;
static RGB schedule_color;
static uint32_t activity,artist_activity,transition,animation,last_render;
static int blending;
static unsigned animation_fraction,brightness_from,brightness_current;
static uint32_t brightness_at;
static int brightness_blending;
static unsigned triangle(unsigned v){v&=511;return v<256?v:511-v;}
static uint32_t hash(uint32_t n){n^=n>>16;n*=0x7feb352d;n^=n>>15;n*=0x846ca68b;return n^(n>>16);}
static RGB scale(RGB c,unsigned v){return (RGB){c.r*v/255,c.g*v/255,c.b*v/255};}
static RGB blend(RGB a,RGB b,unsigned v){return (RGB){(a.r*(255-v)+b.r*v)/255,(a.g*(255-v)+b.g*v)/255,(a.b*(255-v)+b.b*v)/255};}
static RGB wheel(unsigned h){h%=768;if(h<256)return (RGB){255-h,h,0};if(h<512)return (RGB){0,511-h,h-256};return (RGB){h-512,0,767-h};}
static void start_transition(uint32_t now){memcpy(previous,current,sizeof current);transition=now;blending=1;}
static void touch(uint32_t now){manual=1;if((uint32_t)(now-activity)>=FACADE_IDLE_MS){start_transition(now);uint32_t dt=now-activity-FACADE_IDLE_MS;unsigned fade=dt>=FACADE_FADE_MS?0:255-dt*255/FACADE_FADE_MS;for(unsigned i=0;i<FACADE_PIXELS;i++)previous[i]=scale(previous[i],fade);}activity=now;}
static void brightness_target(unsigned value,uint32_t now){
 if(value==facade_config.brightness)return;
 brightness_from=brightness_current;brightness_at=now;brightness_blending=value!=0;
 if(!value)brightness_current=0; /* Explicit blackout remains immediate. */
}
unsigned facade_count(void){unsigned n=0;for(unsigned p=0;p<4;p++)n+=facade_config.fixtures[p]*28;return n;}
int facade_map(unsigned pixel,unsigned *port,unsigned *channel){
 for(unsigned p=0;p<4;p++){unsigned n=facade_config.fixtures[p]*28;if(pixel<n){*port=p;*channel=1+pixel*4;return 1;}pixel-=n;}return 0;
}
void facade_init(uint32_t now){
 FacadeConfig c={{1,0,0,0},FX_FIRE,128,128,{255,100,20},100};facade_config=c;
 memset(custom,0,sizeof custom);memset(previous,0,sizeof previous);memset(current,0,sizeof current);memset(raw,0,sizeof raw);
 brightness_from=brightness_current=c.brightness;brightness_blending=0;brightness_at=now;
 scheduled=schedule_on=manual=automatic=0;
 mode=MODE_EFFECT;owner=0;activity=artist_activity=last_render=now;animation=0;animation_fraction=0;start_transition(now);
}
int facade_configure(const FacadeConfig *c,uint32_t now){
 unsigned n=0;for(unsigned p=0;p<4;p++){if(c->fixtures[p]>4)return 0;n+=c->fixtures[p];}
 if(!n||n>16||c->effect>=FX_COUNT||!c->speed||c->speed>400)return 0;
 start_transition(now);brightness_target(c->brightness,now);facade_config=*c;touch(now);return 1;
}
void facade_schedule(unsigned on,RGB color,uint32_t now){
 if(!scheduled||schedule_on!=on){manual=0;if(automatic)start_transition(now);}
 scheduled=1;schedule_on=on;schedule_color=color;
}
unsigned facade_auto(void){return automatic;}
unsigned facade_auto_on(void){return schedule_on;}
RGB facade_auto_color(void){return schedule_color;}
unsigned facade_mode(void){return automatic?4:mode;}
unsigned facade_owner(void){return owner;}
uint32_t facade_inactive(uint32_t now){return now-activity;}
/* Public effect controls never displace an exclusive artist or MQTT pixels. */
int facade_effect(unsigned effect,uint32_t now){if(owner||effect>=FX_COUNT)return 0;start_transition(now);facade_config.effect=effect;touch(now);return 1;}
int facade_color(RGB c,uint32_t now){if(owner)return 0;start_transition(now);facade_config.color[0]=c.r;facade_config.color[1]=c.g;facade_config.color[2]=c.b;touch(now);return 1;}
int facade_brightness(unsigned v,uint32_t now){if(owner||v>255)return 0;brightness_target(v,now);facade_config.brightness=v;touch(now);return 1;}
int facade_speed(unsigned v,uint32_t now){if(owner||!v||v>400)return 0;facade_config.speed=v;touch(now);return 1;}
int facade_claim(unsigned who,uint32_t now){
 if(!who||(owner&&owner!=who))return 0;
 if(!owner){start_transition(now);memcpy(custom,current,sizeof custom);memset(raw,0,sizeof raw);mode=MODE_ARTIST;}
 owner=who;artist_activity=now;touch(now);return 1;
}
int facade_keepalive(unsigned who,uint32_t now){if(!who||who!=owner)return 0;artist_activity=now;touch(now);return 1;}
int facade_release(unsigned who,uint32_t now){
 if(owner!=who)return 0;
 start_transition(now);owner=0;mode=MODE_EFFECT;if(scheduled)manual=0;return 1;
}
int facade_release_request(unsigned who,uint32_t now){if(!facade_release(who,now))return 0;touch(now);if(scheduled)manual=0;return 1;}
void facade_disconnect(unsigned who,uint32_t now){if(who&&who==owner)facade_release(who,now);}
static int access(unsigned who){return who?who==owner:!owner;}
int facade_pixels(unsigned who,unsigned start,const RGB *pixels,unsigned n,uint32_t now){
 unsigned total=facade_count();if(!access(who)||!n||start>=total||n>total-start)return 0;
 if(mode==MODE_EFFECT||mode==MODE_RAW){start_transition(now);memcpy(custom,current,sizeof custom);}
 memcpy(custom+start,pixels,n*sizeof(RGB));mode=who?MODE_ARTIST:MODE_MQTT;if(who)artist_activity=now;touch(now);return 1;
}
int facade_clear(unsigned who,uint32_t now){if(!access(who))return 0;start_transition(now);memset(custom,0,sizeof custom);mode=who?MODE_ARTIST:MODE_MQTT;if(who)artist_activity=now;touch(now);return 1;}
int facade_raw(unsigned who,unsigned p,unsigned ch,const uint8_t *data,unsigned n,uint32_t now){
 if(!who||who!=owner||p>=4||ch<1||ch>512||!n||n>513-ch)return 0;
 if(mode!=MODE_RAW){memset(raw,0,sizeof raw);mode=MODE_RAW;}
 memcpy(raw[p]+ch-1,data,n);artist_activity=now;touch(now);return 1;
}
static RGB effect_pixel(unsigned i,unsigned n,uint32_t t){
 RGB color={facade_config.color[0],facade_config.color[1],facade_config.color[2]};unsigned v;
 switch(facade_config.effect){
 case FX_FIRE:{
  /* Broad moving flames plus quicker flicker, with genuinely dark pockets. */
  unsigned x=i*64+t/9,cell=x/256,fraction=x%256;
  unsigned broad=((hash(cell*71)&255)*(256-fraction)+(hash((cell+1)*71)&255)*fraction)/256;
  unsigned step=t/120,phase=t%120;
  unsigned flicker=((hash(i*97+step)&255)*(120-phase)+(hash(i*97+step+1)&255)*phase)/120;
  unsigned heat=(broad*3+flicker)/4;
  RGB flame;
  if(heat<45)return (RGB){0,0,0};
  if(heat<100)flame=scale((RGB){255,0,0},(heat-45)*255/55);
  else if(heat<180)flame=blend((RGB){255,0,0},(RGB){255,210,0},(heat-100)*255/80);
  else if(heat<215)flame=blend((RGB){255,210,0},(RGB){255,255,0},(heat-180)*255/35);
  else flame=blend((RGB){255,255,0},(RGB){255,255,255},(heat-215)*255/40);
  /* A subtle selected-color tint preserves the characteristic fire palette. */
  return blend(flame,scale(color,heat),16);
 }
 case FX_WATER:v=(triangle(i*27+t/9)+triangle(i*13-t/15))/2;return scale(blend((RGB){0,10,80},color,v),60+v*195/255);
 case FX_CHASE:{unsigned head=(t/35)%n,d=(i+n-head)%n;return scale(color,d<12?(12-d)*255/12:0);}
 case FX_RAINBOW:return blend(wheel(i*768/n+t/8),color,48);
 case FX_PULSE:return scale(color,triangle(t/5));
 case FX_SPARKLE:v=hash(i+97*(t/150))%32;return scale(color,v==0?255:8);
 case FX_WASH:return blend(color,wheel(t/20),triangle(t/12)/2);
 case FX_LIGHTNING:v=((t%4000<70)||(t%4000>150&&t%4000<190))?255:0;return scale(blend(color,(RGB){255,255,255},90),v);
 case FX_GRADIENT:return blend(color,wheel(t/20+256),triangle(i*512/n+t/10));
 default:return color;
 }
}
void facade_render(uint32_t now,uint8_t dmx[4][512]){
 /* Advance with deltas so speed changes do not cause an animation phase jump. */
 uint32_t elapsed=now-last_render;last_render=now;animation+=elapsed/100*facade_config.speed;animation_fraction+=(elapsed%100)*facade_config.speed;animation+=animation_fraction/100;animation_fraction%=100;
 if(owner&&(uint32_t)(now-artist_activity)>=FACADE_ARTIST_MS)facade_release(owner,now);
 uint32_t idle=now-activity;
 unsigned use_auto=scheduled&&!owner&&(!manual||idle>=FACADE_IDLE_MS);
 if(use_auto!=automatic){start_transition(now);automatic=use_auto;if(use_auto)mode=MODE_EFFECT;}
 if(idle>=FACADE_IDLE_MS&&mode==MODE_MQTT){start_transition(now);mode=MODE_EFFECT;}
 unsigned fade=255;if(!automatic&&idle>=FACADE_IDLE_MS){uint32_t dt=idle-FACADE_IDLE_MS;fade=dt>=FACADE_FADE_MS?0:255-dt*255/FACADE_FADE_MS;}
 if(brightness_blending){uint32_t dt=now-brightness_at;if(dt>=FACADE_TRANSITION_MS){brightness_current=facade_config.brightness;brightness_blending=0;}else brightness_current=(brightness_from*(FACADE_TRANSITION_MS-dt)+facade_config.brightness*dt)/FACADE_TRANSITION_MS;}
 unsigned gain=automatic?facade_config.limit:brightness_current*facade_config.limit/255;gain=gain*fade/255;
 memset(dmx,0,4*512);
 if(mode==MODE_RAW){
  for(unsigned p=0;p<4;p++)for(unsigned c=0;c<512;c++)dmx[p][c]=raw[p][c]*gain/255;
  /* Preserve the RGB actually being streamed as the next transition source. */
  for(unsigned i=0;i<facade_count();i++){unsigned p,ch;facade_map(i,&p,&ch);current[i]=(RGB){raw[p][ch-1],raw[p][ch],raw[p][ch+1]};}
  return;
 }
 unsigned n=facade_count(),mix=255;uint32_t dt=now-transition;
 if(blending){if(dt>=FACADE_TRANSITION_MS)blending=0;else mix=dt*255/FACADE_TRANSITION_MS;}
 for(unsigned i=0;i<n;i++){
  RGB next=automatic?(schedule_on?schedule_color:(RGB){0,0,0}):mode==MODE_EFFECT?effect_pixel(i,n,animation):custom[i];current[i]=blending?blend(previous[i],next,mix):next;
  RGB output=scale(current[i],gain);unsigned p,ch;facade_map(i,&p,&ch);
  dmx[p][ch-1]=output.r;dmx[p][ch]=output.g;dmx[p][ch+1]=output.b;
  /* White is intentionally zero: virtual pixels are RGB, physical slots RGBW. */
 }
}
