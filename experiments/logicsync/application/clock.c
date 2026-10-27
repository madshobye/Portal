#include "app.h"
#include "runtime.h"
#include "astro.h"
#include "lwip/apps/sntp.h"
static unsigned started;
static uint32_t evaluated;
void clock_set_utc(uint32_t utc){unsigned first=!astro_utc();if(astro_sync(utc,sys_now())&&first)runtime_event("Clock synchronized by NTP");}
void clock_poll(void){
 astro_tick(sys_now());
 if(!started&&network_ready()){
  sntp_setoperatingmode(SNTP_OPMODE_POLL);
  sntp_setservername(0,"time.cloudflare.com");sntp_setservername(1,"time.google.com");
  sntp_init();started=1;
 }
 if(evaluated==astro_utc())return;
 evaluated=astro_utc();
 AstroState s=astro_state();facade_schedule(s.valid&&s.on,s.color,sys_now());
}
