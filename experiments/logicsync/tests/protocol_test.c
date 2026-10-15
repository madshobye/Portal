#include "facade.h"
#include "protocol.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static int send(const char*t,const char*b){return facade_message(t,b,strlen(b),0,1000);}
int main(void){
 facade_init(0);
 assert(send("/set/effect","\"Solid Color\""));assert(send("/set/brightness","255"));assert(send("/set/color","{\"h\":120,\"s\":100,\"v\":100}"));assert(facade_config.color[1]==255);
 assert(send("/pixels/set","{\"index\":0,\"r\":255,\"g\":100,\"b\":0}"));
 assert(send("/pixels/range","{\"start\":10,\"colors\":[[255,0,0],[0,255,0],[0,0,255]]}"));
 assert(!send("/pixels/set","{\"index\":0,\"index\":1,\"r\":255,\"g\":100,\"b\":0}"));
 assert(!send("/set/color","{\"r\":256,\"g\":0,\"b\":0}"));assert(!send("/set/speed","0"));assert(!send("/set/brightness","255x"));assert(!send("/set/brightness","0255"));
 assert(!send("/pixels/range","{\"start\":27,\"colors\":[[1,2,3],[4,5,6]]}"));assert(!send("/pixels/frame","{\"rgb\":[1,2,3]}"));
 FacadeConfig cfg=facade_config;for(unsigned p=0;p<4;p++)cfg.fixtures[p]=4;assert(facade_configure(&cfg,0));
 char frame[6144];unsigned n=0;n+=snprintf(frame+n,sizeof frame-n,"{\"rgb\":[");for(unsigned i=0;i<448;i++)n+=snprintf(frame+n,sizeof frame-n,"%s255,128,0",i?",":"");n+=snprintf(frame+n,sizeof frame-n,"]}");assert(n<6144&&send("/pixels/frame",frame));
 assert(facade_claim(4,1001));assert(!send("/pixels/frame",frame));assert(facade_message("/pixels/frame",frame,n,4,1002));
 /* Reject every truncated version of an otherwise valid full frame. */
 facade_disconnect(4,1003);for(unsigned i=0;i<n;i++)assert(!facade_message("/pixels/frame",frame,i,0,1004));
 assert(send("/pixels/release","{}"));assert(facade_mode()==MODE_EFFECT);
 /* Explicit release is a new interaction; automatic expiry must not be. */
 uint8_t dmx[4][512];facade_init(0);assert(facade_effect(FX_SOLID,0));
 facade_render(604000,dmx);assert(!dmx[0][0]);
 assert(!facade_message("/pixels/release","{}",2,3,604001));assert(facade_inactive(604001)==604001);
 assert(facade_message("/pixels/release","{}",2,0,604001));assert(facade_inactive(604001)==0);
 facade_render(605000,dmx);assert(dmx[0][0]>0);
 assert(facade_claim(1,605001));facade_render(615002,dmx);assert(!facade_owner());assert(facade_inactive(615002)==10001);
 puts("JSON bounds, HSV, full 448-pixel frames, partial ranges, ownership, truncation: PASS");
}
