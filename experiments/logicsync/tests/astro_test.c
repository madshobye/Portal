#include "astro.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t output[4][512];
static void check_uniform(RGB color){for(unsigned p=0;p<4;p++)for(unsigned c=0;c<512;c++){unsigned expected=c<448?(c%4==0?color.r:c%4==1?color.g:c%4==2?color.b:0):0;assert(output[p][c]==expected);}}
int main(void){
 astro_init(0);assert(!astro_state().valid);assert(!astro_sync(0,0));
 assert(astro_offset(1774745999)==60);assert(astro_offset(1774746000)==120);
 assert(astro_offset(1792889999)==120);assert(astro_offset(1792890000)==60);
 unsigned summer=astro_sunset(1782043200/86400),winter=astro_sunset(1797854400/86400);
 assert(summer>=21*60+50&&summer<=22*60+10);assert(winter>=15*60+25&&winter<=15*60+50);
 /* Today's sunset, immediately before and at its minute boundary. */
 uint32_t day=1792843200/86400;unsigned sunset=astro_sunset(day);
 uint32_t start=day*86400+(sunset-120)*60;
 assert(astro_sync(start-1,0));assert(!astro_state().on);
 assert(astro_sync(start,0));assert(astro_state().on);
 assert(astro_sync(1792886399,0));assert(astro_state().on); /* 01:59:59 CEST */
 assert(astro_sync(1792886400,0));assert(!astro_state().on); /* first 02:00 */
 assert(astro_sync(1792890000,0));assert(!astro_state().on); /* repeated 02:00 */
 assert(astro_sync(1774745999,0));assert(astro_state().on);
 assert(astro_sync(1774746000,0));assert(!astro_state().on); /* spring skips 02 */
 /* millis wraps without losing wall-clock time; resync corrects the date. */
 astro_init(0xfffffff0);assert(astro_sync(start,0xfffffff0));astro_tick(984);assert(astro_utc()==start+1);
 astro_tick(984+86400000);assert(astro_utc()==start+86401);
 /* Colors are continuous at hue-sector and full-cycle boundaries. */
 RGB last={0};for(unsigned sec=0;sec<=7200;sec++){assert(astro_sync(day*86400+sec,0));RGB c=astro_state().color;
  if(sec){assert((int)c.r-last.r<=1&&(int)last.r-c.r<=1);assert((int)c.g-last.g<=1&&(int)last.g-c.g<=1);assert((int)c.b-last.b<=1&&(int)last.b-c.b<=1);}last=c;}
 facade_init(0);FacadeConfig config=facade_config;memset(config.fixtures,4,4);config.limit=255;config.brightness=0;assert(facade_configure(&config,0));
 facade_schedule(1,(RGB){255,0,0},0);facade_render(1,output);facade_render(1000,output);assert(facade_auto());check_uniform((RGB){255,0,0});
 facade_render(700000,output);check_uniform((RGB){255,0,0}); /* no idle blackout */
 /* Manual changes override; ten minutes later uniform full brightness returns. */
 assert(facade_brightness(0,700001));facade_render(700001,output);assert(!facade_auto());check_uniform((RGB){0,0,0});
 facade_render(1300001,output);facade_render(1301001,output);assert(facade_auto());check_uniform((RGB){255,0,0});
 /* Artist remains exclusive, then release resumes the default. */
 assert(facade_claim(1,1301002));facade_render(1301002,output);assert(!facade_auto());
 facade_schedule(0,(RGB){255,0,0},1301003);assert(facade_owner()==1);
 assert(facade_release_request(1,1301004));facade_render(1301004,output);facade_render(1302004,output);assert(facade_auto());check_uniform((RGB){0,0,0});
 /* Sunset begins regardless of recent daytime controls; safety cap is retained. */
 config.limit=64;assert(facade_configure(&config,1302005));facade_schedule(1,(RGB){0,255,0},1302006);facade_render(1302006,output);facade_render(1303006,output);check_uniform((RGB){0,64,0});
 facade_schedule(0,(RGB){0,255,0},1303007);facade_render(1303007,output);facade_render(1304007,output);check_uniform((RGB){0,0,0});
 printf("Copenhagen sunset %02u:%02u; DST, midnight, 02:00 cutoff, clock wrap, uniform drift, overrides and safety cap: PASS\n",sunset/60,sunset%60);
}
