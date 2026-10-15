/* WebSocket handshake SHA-1 + Base64 (RFC 6455, fixed 24-byte nonce). */
#include <stdint.h>
#include "string.h"
static uint32_t rol(uint32_t x,unsigned n){return(x<<n)|(x>>(32-n));}
int websocket_accept(const char*key,unsigned length,char*out){
 static const char base64[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 if(length!=24||key[22]!='='||key[23]!='=')return 0;
 for(unsigned i=0;i<22;i++)if(!strchr(base64,key[i])||!key[i])return 0;
 uint8_t input[128]={0};memcpy(input,key,24);memcpy(input+24,"258EAFA5-E914-47DA-95CA-C5AB0DC85B11",36);input[60]=0x80;input[126]=1;input[127]=0xe0;
 uint32_t h[5]={0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0};
 for(unsigned block=0;block<2;block++){
  uint32_t w[80];for(unsigned i=0;i<16;i++){const uint8_t*p=input+block*64+i*4;w[i]=(uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
  for(unsigned i=16;i<80;i++)w[i]=rol(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
  uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4];
  for(unsigned i=0;i<80;i++){uint32_t f,k;if(i<20){f=(b&c)|(~b&d);k=0x5a827999;}else if(i<40){f=b^c^d;k=0x6ed9eba1;}else if(i<60){f=(b&c)|(b&d)|(c&d);k=0x8f1bbcdc;}else{f=b^c^d;k=0xca62c1d6;}uint32_t t=rol(a,5)+f+e+k+w[i];e=d;d=c;c=rol(b,30);b=a;a=t;}
  h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;
 }
 uint8_t digest[20];for(unsigned i=0;i<20;i++)digest[i]=h[i/4]>>(24-8*(i%4));
 unsigned n=0;for(unsigned i=0;i<20;i+=3){uint32_t v=(uint32_t)digest[i]<<16;if(i+1<20)v|=(uint32_t)digest[i+1]<<8;if(i+2<20)v|=digest[i+2];out[n++]=base64[v>>18];out[n++]=base64[(v>>12)&63];out[n++]=i+1<20?base64[(v>>6)&63]:'=';out[n++]=i+2<20?base64[v&63]:'=';}out[n]=0;return 1;
}
