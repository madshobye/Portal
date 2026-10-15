#include "facade.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t output[4][512];
static void full_config(unsigned count){FacadeConfig c=facade_config;memset(c.fixtures,0,4);for(unsigned p=0;p<4;p++){c.fixtures[p]=count>4?4:count;count-=c.fixtures[p];}c.brightness=c.limit=255;c.effect=FX_SOLID;c.color[0]=255;c.color[1]=c.color[2]=0;assert(facade_configure(&c,0));}
int main(void){
 facade_init(0);assert(facade_count()==28);full_config(16);assert(facade_count()==448);
 for(unsigned i=0;i<448;i++){unsigned p,ch;assert(facade_map(i,&p,&ch));assert(p==i/112);assert(ch==1+(i%112)*4);}
 unsigned p,ch;assert(!facade_map(448,&p,&ch));
 facade_render(1000,output);for(p=0;p<4;p++)for(unsigned c=0;c<512;c++)assert(output[p][c]==(c<448&&c%4==0?255:0));
 RGB green={0,255,0},blue={0,0,255};assert(facade_pixels(0,112,&green,1,1001));assert(facade_pixels(0,113,&blue,1,1002));facade_render(2000,output);assert(output[1][1]==255&&output[1][6]==255&&output[0][0]==255);assert(!facade_pixels(0,448,&green,1,2000));
 assert(facade_claim(7,2001));assert(!facade_claim(8,2002));assert(!facade_pixels(0,0,&blue,1,2002));assert(!facade_effect(3,2002));assert(!facade_release(8,2002));
 uint8_t levels[]={255,128,64};assert(facade_raw(7,3,510,levels,3,2003));assert(!facade_raw(7,3,511,levels,3,2003));facade_render(2100,output);assert(output[3][509]==255&&output[3][511]==64);
 facade_disconnect(8,2101);assert(facade_owner()==7);facade_disconnect(7,2102);assert(facade_mode()==MODE_EFFECT);facade_render(3000,output);assert(output[0][0]==255);
 assert(facade_claim(9,3001));facade_render(13001,output);assert(!facade_owner());
 assert(facade_pixels(0,0,&green,1,14000));facade_render(614000,output);assert(facade_mode()==MODE_EFFECT);facade_render(617000,output);for(p=0;p<4;p++)for(unsigned c=0;c<512;c++)assert(!output[p][c]);
 assert(facade_effect(FX_SOLID,617001));facade_render(617001,output);assert(!output[0][0]);facade_render(618000,output);assert(output[0][0]==255);
 FacadeConfig c=facade_config;c.fixtures[0]=5;assert(!facade_configure(&c,0));c=facade_config;memset(c.fixtures,0,4);assert(!facade_configure(&c,0));
 for(unsigned fx=0;fx<FX_COUNT;fx++){facade_init(0);full_config(16);assert(facade_effect(fx,1));for(unsigned t=0;t<20000;t+=33){facade_render(t,output);for(p=0;p<4;p++)for(unsigned ch=0;ch<512;ch++)if(ch>=448||ch%4==3)assert(!output[p][ch]);}}
 /* Brightness transitions interpolate; blackout and the safety cap are immediate. */
 facade_init(0);full_config(1);facade_render(1000,output);assert(facade_brightness(64,1001));
 facade_render(1001,output);assert(output[0][0]==255);facade_render(1351,output);assert(output[0][0]>64&&output[0][0]<255);
 facade_render(1800,output);assert(output[0][0]==64);assert(facade_brightness(0,1801));facade_render(1801,output);assert(output[0][0]==0);
 assert(facade_brightness(255,1802));facade_render(1802,output);assert(!output[0][0]);facade_render(2152,output);assert(output[0][0]>0&&output[0][0]<255);
 c=facade_config;c.limit=16;assert(facade_configure(&c,2153));facade_render(2153,output);assert(output[0][0]<=16);
 /* Leaving raw RGB begins from its displayed color, not the old effect. */
 facade_init(0);full_config(1);facade_render(1000,output);assert(facade_claim(2,1001));
 uint8_t raw_blue[]={0,0,255};assert(facade_raw(2,0,1,raw_blue,3,1002));facade_render(1003,output);assert(output[0][2]==255);
 assert(facade_release_request(2,1004));facade_render(1004,output);assert(output[0][0]==0&&output[0][2]==255);
 facade_render(1354,output);assert(output[0][0]>100&&output[0][2]>100);
 facade_render(1800,output);assert(output[0][0]==255&&output[0][2]==0);
 /* Sparse outputs retain physical wiring boundaries. */
 facade_init(0);c=facade_config;c.fixtures[0]=0;c.fixtures[1]=2;c.fixtures[2]=0;c.fixtures[3]=1;assert(facade_configure(&c,0));assert(facade_count()==84);assert(facade_map(56,&p,&ch)&&p==3&&ch==1);
 facade_init(0xfffffff0u);assert(facade_claim(2,0xfffffff1u));facade_render(10001,output);assert(!facade_owner());
 /* Fire must contain dark pockets, red bodies, yellow and rare white peaks. */
 facade_init(0);full_config(16);assert(facade_effect(FX_FIRE,0));
 unsigned dark=0,red=0,yellow=0,white=0,total=0;
 for(unsigned t=1000;t<61000;t+=90){facade_render(t,output);
  for(unsigned port=0;port<4;port++)for(unsigned ch=0;ch<448;ch+=4){
   unsigned r=output[port][ch],g=output[port][ch+1],b=output[port][ch+2];total++;
   if(r==0&&g==0&&b==0)dark++;
   if(r>100&&g<80&&b<30)red++;
   if(r>200&&g>170&&b<50)yellow++;
   if(r>200&&g>200&&b>100)white++;
   assert(output[port][ch+3]==0);
  }
 }
 assert(dark>total/100&&red>total/10&&yellow>total/100&&white>0);
 assert(white<yellow&&white<total/20);
 puts("mapping, sparse configuration, 10 effects, custom pixels, priority, raw DMX, disconnect, timeout, inactivity, wraparound: PASS");
}
