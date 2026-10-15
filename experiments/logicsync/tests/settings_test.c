#include "settings.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static unsigned char flash[4096],saved[4096];static int remaining=-1,writes;
static void read_flash(uint32_t a,void*out,unsigned n){assert(a>=SETTINGS_PAGE0&&a+n<=SETTINGS_PAGE1+2048);memcpy(out,flash+(a-SETTINGS_PAGE0),n);}
static int erase(uint32_t a){assert(a==SETTINGS_PAGE0||a==SETTINGS_PAGE1);if(remaining==0)return 0;if(remaining>0)--remaining;memset(flash+(a-SETTINGS_PAGE0),255,2048);return 1;}
static int write_flash(uint32_t a,uint32_t w){assert(a%4==0&&a>=SETTINGS_PAGE0&&a+4<=SETTINGS_PAGE1+2048);if(remaining==0)return 0;if(remaining>0)--remaining;unsigned char*p=(unsigned char*)&w;for(unsigned i=0;i<4;i++)flash[a-SETTINGS_PAGE0+i]&=p[i];writes++;return 1;}
int main(void){
 SettingsStorage io={read_flash,erase,write_flash};Settings a={0},b,loaded;
 facade_init(0);a.facade=facade_config;a.dhcp=1;a.ip[0]=2;a.ip[3]=100;a.mask[0]=a.mask[1]=a.mask[2]=255;a.port=1883;strcpy(a.broker,"public.cloud.shiftr.io");strcpy(a.username,"public");strcpy(a.password,"public");memset(a.artist_key,'a',32);memset(a.admin_key,'b',32);
 memset(flash,255,sizeof flash);assert(!settings_load(&io,&loaded));assert(settings_save(&io,&a));assert(settings_load(&io,&loaded));assert(!memcmp(&a,&loaded,sizeof a));
 int count=writes;assert(settings_save(&io,&a)&&writes==count);memcpy(saved,flash,sizeof flash);b=a;b.facade.fixtures[1]=4;
 /* Interrupt at every erase/program operation; either old or new record survives. */
 for(int cut=0;cut<100;cut++){
  memcpy(flash,saved,sizeof flash);remaining=cut;int ok=settings_save(&io,&b);assert(settings_load(&io,&loaded));assert(!memcmp(&loaded,ok?&b:&a,sizeof a));
 }
 remaining=-1;memcpy(flash,saved,sizeof flash);assert(settings_save(&io,&b));flash[2048+20]^=1;assert(settings_load(&io,&loaded)&&!memcmp(&loaded,&a,sizeof a));
 b=a;b.artist_key[0]='x';assert(!settings_save(&io,&b));puts("dual-page save, unchanged-write avoidance, every interrupted write, corruption fallback: PASS");
}
