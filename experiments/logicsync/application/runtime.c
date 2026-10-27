#include "gd32f30x.h"
#include "app.h"
#include "runtime.h"
#include "astro.h"
#include "access_keys.h"
#include "string.h"
Settings runtime_settings;
NetworkSettings runtime_network;
static void network_snapshot(NetworkSettings*n){
 memset(n,0,sizeof *n);n->dhcp=runtime_settings.dhcp;n->port=runtime_settings.port;
 memcpy(n->ip,runtime_settings.ip,4);memcpy(n->mask,runtime_settings.mask,4);memcpy(n->gateway,runtime_settings.gateway,4);
 memcpy(n->broker,runtime_settings.broker,sizeof n->broker);memcpy(n->username,runtime_settings.username,sizeof n->username);memcpy(n->password,runtime_settings.password,sizeof n->password);
}
int runtime_network_pending(void){NetworkSettings saved;network_snapshot(&saved);return memcmp(&saved,&runtime_network,sizeof saved)!=0;}
static uint8_t frame[4][512];
static uint32_t last_frame,save_at;
static unsigned dirty,save_ok=1;
static char events[6][64];static uint32_t event_times[6];static unsigned event_count;
static void read_flash(uint32_t address,void*out,unsigned n){memcpy(out,(const void*)address,n);}
static int erase_flash(uint32_t address){return (address==SETTINGS_PAGE0||address==SETTINGS_PAGE1)&&fmc_page_erase(address)==FMC_READY;}
static int write_flash(uint32_t address,uint32_t word){return address>=SETTINGS_PAGE0&&address<SETTINGS_PAGE1+SETTINGS_PAGE_SIZE&&!(address&3)&&fmc_word_program(address,word)==FMC_READY;}
static const SettingsStorage storage={read_flash,erase_flash,write_flash};
void runtime_event(const char*s){unsigned index=event_count%6,n=strlen(s);if(n>=64)n=63;memcpy(events[index],s,n);events[index][n]=0;event_times[index]=sys_now();event_count++;}
const char *runtime_last_event(void){return event_count?events[(event_count-1)%6]:"Starting";}
unsigned runtime_event_count(void){return event_count<6?event_count:6;}
const char*runtime_event_get(unsigned i,uint32_t*time){unsigned index=(event_count-1-i)%6;*time=event_times[index];return events[index];}
unsigned runtime_save_ok(void){return save_ok;}
void runtime_init(void){
 facade_init(sys_now());memset(&runtime_settings,0,sizeof runtime_settings);
 if(!settings_load(&storage,&runtime_settings)){
  runtime_settings.facade=facade_config;runtime_settings.dhcp=1;
  uint8_t ip[]={2,0,0,100},mask[]={255,255,255,0},gw[]={2,0,0,1};
  memcpy(runtime_settings.ip,ip,4);memcpy(runtime_settings.mask,mask,4);memcpy(runtime_settings.gateway,gw,4);
  strcpy(runtime_settings.broker,"public.cloud.shiftr.io");strcpy(runtime_settings.username,"public");strcpy(runtime_settings.password,"public");runtime_settings.port=1883;
  strcpy(runtime_settings.artist_key,ARTIST_KEY);strcpy(runtime_settings.admin_key,ADMIN_KEY);runtime_event("Defaults loaded");
 }else{facade_configure(&runtime_settings.facade,sys_now());runtime_event("Saved configuration loaded");}
 network_snapshot(&runtime_network);astro_init(sys_now());facade_schedule(0,(RGB){0,0,0},sys_now());
}
void runtime_changed(void){dirty=1;save_at=sys_now()+5000;}
int runtime_save(void){
 runtime_settings.facade=facade_config;
 uint32_t mask=__get_PRIMASK();__disable_irq();fmc_unlock();FMC_STAT0=FMC_STAT0_ENDF|FMC_STAT0_PGERR|FMC_STAT0_WPERR;
 save_ok=settings_save(&storage,&runtime_settings);fmc_lock();if(!mask)__enable_irq();dirty=0;runtime_event(save_ok?"Configuration saved":"Configuration save failed");return save_ok;
}
static int key_equal(const char*a,unsigned n,const char*b){if(n!=32)return 0;unsigned difference=0;for(unsigned i=0;i<32;i++)difference|=(unsigned char)a[i]^(unsigned char)b[i];return !difference;}
int runtime_admin(const char*key,unsigned n){return key&&key_equal(key,n,runtime_settings.admin_key);}
int runtime_artist(const char*key,unsigned n){return key&&key_equal(key,n,runtime_settings.artist_key);}
void runtime_poll(void){clock_poll();uint32_t now=sys_now();if((uint32_t)(now-last_frame)>=30){last_frame=now;facade_render(now,frame);dmx_frame(frame);}if(dirty&&(int32_t)(now-save_at)>=0)runtime_save();}
