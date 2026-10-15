#include "app.h"
#include "runtime.h"
#include "protocol.h"
#include "lwip/tcp.h"
#include "string.h"
#include "stdlib.h"
#include "webpage.h"
struct connection {struct tcp_pcb*pcb;uint32_t started;unsigned used,outlen,outoff,inflight;int responding,websocket,wsclosing;unsigned message_used,message_opcode;uint8_t message[1400];char input[1600],output[2048];const char*body;unsigned bodylen,bodyoff;};
static struct connection connections[3];
static void append(char **p,const char*s){while(*s)*(*p)++=*s++;}
static void number(char **p,unsigned n){char tmp[12];unsigned i=0;do{tmp[i++]=(char)('0'+n%10);n/=10;}while(n);while(i)*(*p)++=tmp[--i];}
static err_t received(void*,struct tcp_pcb*,struct pbuf*,err_t);
static err_t sent(void*,struct tcp_pcb*,u16_t);
static err_t poll(void*,struct tcp_pcb*);
static unsigned identity(struct connection*c){return (unsigned)(c-connections)+1;}
static void release(struct connection*c){facade_disconnect(identity(c),sys_now());c->pcb=0;c->used=0;}
static void failed(void*arg,err_t err){(void)err;release(arg);}
static err_t flush(struct connection*c){
 struct tcp_pcb*p=c->pcb;
 if(c->outoff<c->outlen){unsigned n=c->outlen-c->outoff;if(n>tcp_sndbuf(p))n=tcp_sndbuf(p);
  if(n&&tcp_write(p,c->output+c->outoff,n,TCP_WRITE_FLAG_COPY)==ERR_OK){c->outoff+=n;c->inflight+=n;tcp_output(p);}}
 if(c->body&&c->outoff==c->outlen&&c->bodyoff<c->bodylen){unsigned n=c->bodylen-c->bodyoff;if(n>tcp_sndbuf(p))n=tcp_sndbuf(p);if(n&&tcp_write(p,c->body+c->bodyoff,n,0)==ERR_OK){c->bodyoff+=n;c->inflight+=n;tcp_output(p);}}
 if(c->websocket&&c->outoff==c->outlen){c->outoff=0;c->outlen=0;}
 if(c->responding&&(!c->websocket||c->wsclosing)&&c->outoff==c->outlen&&c->bodyoff==c->bodylen&&!c->inflight){
  /* Detach only when close succeeds; ERR_MEM is retried on the poll callback. */
  tcp_arg(p,0);tcp_recv(p,0);tcp_sent(p,0);tcp_err(p,0);tcp_poll(p,0,0);
  if(tcp_close(p)==ERR_OK){release(c);return ERR_OK;}
  tcp_arg(p,c);tcp_recv(p,received);tcp_sent(p,sent);tcp_err(p,failed);tcp_poll(p,poll,2);
 }
 return ERR_OK;
}
static void reply(struct connection*c,const char*status,const char*type,const char*body){
 char*p=c->output;unsigned n=strlen(body);
 if(n>sizeof(c->output)-160){status="500 Internal Server Error";type="text/plain";body="Response too large";n=strlen(body);}
 append(&p,"HTTP/1.1 ");append(&p,status);append(&p,"\r\nContent-Type: ");append(&p,type);append(&p,"\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: ");number(&p,n);append(&p,"\r\n\r\n");append(&p,body);c->outlen=p-c->output;c->responding=1;flush(c);
}
static void page_reply(struct connection*c){char*p=c->output;append(&p,"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: ");number(&p,sizeof(page)-1);append(&p,"\r\n\r\n");c->outlen=p-c->output;c->body=page;c->bodylen=sizeof(page)-1;c->responding=1;flush(c);}
static void status_reply(struct connection*c){char b[1400];if(control_state(b,sizeof b))reply(c,"200 OK","application/json",b);else reply(c,"500 Internal Server Error","text/plain","Status overflow");}
static int header_number(const char*request,const char*end,const char*name,unsigned *value){
 size_t n=strlen(name);const char*line=strstr(request,"\r\n");
 while(line&&line<end){
  line+=2;const char*next=strstr(line,"\r\n");if(!next||next>end)break;
  unsigned i=0;while(i<n&&line+i<next){char a=line[i],b=name[i];if(a>='A'&&a<='Z')a+=32;if(b>='A'&&b<='Z')b+=32;if(a!=b)break;++i;}
  if(i==n&&line+i<next&&line[i]==':'){
   const char*p=line+i+1;while(p<next&&(*p==' '||*p=='\t'))++p;
   unsigned v=0,digits=0;while(p<next&&*p>='0'&&*p<='9'){if(++digits>5)return 0;v=v*10+*p++-'0';}
   while(p<next&&(*p==' '||*p=='\t'))++p;
   if(!digits||p!=next)return 0;
   *value=v;return 1;
  }
  line=next;
 }
 return 0;
}
static const char* header_text(const char*request,const char*end,const char*name,unsigned*length){
 size_t n=strlen(name);const char*line=strstr(request,"\r\n");
 while(line&&line<end){line+=2;const char*next=strstr(line,"\r\n");if(!next||next>end)break;
  unsigned i=0;while(i<n&&line+i<next){char a=line[i],b=name[i];if(a>='A'&&a<='Z')a+=32;if(b>='A'&&b<='Z')b+=32;if(a!=b)break;++i;}
  if(i==n&&line+i<next&&line[i]==':'){const char*v=line+i+1;while(v<next&&(*v==' '||*v=='\t'))++v;while(next>v&&(next[-1]==' '||next[-1]=='\t'))--next;*length=next-v;return v;}
  line=next;
 }return 0;
}
static int header_token(const char*request,const char*end,const char*name,const char*token){
 unsigned length=0;const char*value=header_text(request,end,name,&length);if(!value)return 0;
 const char*limit=value+length;unsigned wanted=strlen(token);
 while(value<limit){while(value<limit&&(*value==' '||*value=='\t'||*value==','))value++;const char*last=value;while(last<limit&&*last!=',')last++;const char*trim=last;while(trim>value&&(trim[-1]==' '||trim[-1]=='\t'))trim--;
  if((unsigned)(trim-value)==wanted){unsigned i;for(i=0;i<wanted;i++){char c=value[i];if(c>='A'&&c<='Z')c+=32;if(c!=token[i])break;}if(i==wanted)return 1;}
  value=last<limit?last+1:limit;
 }return 0;
}
static void ws_send(struct connection*c,unsigned opcode,const void*data,unsigned length){
 if(length>900||c->outlen+length+4>sizeof c->output)return;
 c->output[c->outlen++]=(char)(0x80|opcode);if(length<126)c->output[c->outlen++]=(char)length;else{c->output[c->outlen++]=126;c->output[c->outlen++]=(char)(length>>8);c->output[c->outlen++]=(char)length;}
 memcpy(c->output+c->outlen,data,length);c->outlen+=length;flush(c);
}
static void ws_close(struct connection*c,unsigned code){uint8_t b[2]={code>>8,code};c->wsclosing=1;ws_send(c,8,b,2);}
static int artist_command(struct connection*c,const uint8_t*b,unsigned n,unsigned opcode){
 unsigned who=identity(c);
 if(opcode==1){
  if(n==38&&!memcmp(b,"claim ",6))return runtime_artist((const char*)b+6,32)&&facade_claim(who,sys_now());
  if(n==9&&!memcmp(b,"keepalive",9))return facade_keepalive(who,sys_now());
  if(n==7&&!memcmp(b,"release",7))return facade_owner()==who&&facade_release_request(who,sys_now());
  if(facade_owner()!=who)return 0;
  const uint8_t*space=memchr(b,' ',n);if(!space||space-b>=32)return 0;char topic[32];unsigned len=space-b;memcpy(topic,b,len);topic[len]=0;return control_apply(topic,(const char*)space+1,n-len-1,who);
 }
 if(facade_owner()!=who||!n)return 0;
 if(b[0]==1){if(n!=1+facade_count()*3)return 0;return facade_pixels(who,0,(const RGB*)(b+1),(n-1)/3,sys_now());}
 if(b[0]==2){if(n<6||(n-3)%3)return 0;return facade_pixels(who,((unsigned)b[1]<<8)|b[2],(const RGB*)(b+3),(n-3)/3,sys_now());}
 if(b[0]==3){if(n<5)return 0;return facade_raw(who,b[1],((unsigned)b[2]<<8)|b[3],b+4,n-4,sys_now());}
 return 0;
}
static void ws_process(struct connection*c){
 while(c->used>=2&&!c->wsclosing){
  uint8_t*b=(uint8_t*)c->input;unsigned opcode=b[0]&15,fin=b[0]&128,length=b[1]&127,offset=2;
  if((b[0]&0x70)||!(b[1]&128)){ws_close(c,1002);return;}
  if(length==127){ws_close(c,1009);return;}
  if(length==126){if(c->used<4)return;length=((unsigned)b[2]<<8)|b[3];offset=4;if(length<126){ws_close(c,1002);return;}}
  if(length>sizeof c->message){ws_close(c,1009);return;}
  if(c->used<offset+4+length)return;
  uint8_t*mask=b+offset,*payload=mask+4;for(unsigned i=0;i<length;i++)payload[i]^=mask[i%4];
  if(opcode>=8){
   if(!fin||length>125){ws_close(c,1002);return;}
   if(opcode==8){ws_close(c,length==1?1002:1000);return;}
   if(opcode==9)ws_send(c,10,payload,length);else if(opcode!=10){ws_close(c,1002);return;}
  }else{
   if(opcode==1||opcode==2){if(c->message_opcode){ws_close(c,1002);return;}c->message_opcode=opcode;c->message_used=0;}
   else if(opcode!=0||!c->message_opcode){ws_close(c,1002);return;}
   if(c->message_used+length>sizeof c->message){ws_close(c,1009);return;}
   memcpy(c->message+c->message_used,payload,length);c->message_used+=length;
   if(fin){unsigned n=c->message_used;int ok=artist_command(c,c->message,n,c->message_opcode);c->message_opcode=0;c->message_used=0;const char*r=ok?"{\"ok\":true}":"{\"ok\":false}";ws_send(c,1,r,strlen(r));}
  }
  unsigned consumed=offset+4+length;c->used-=consumed;memmove(c->input,c->input+consumed,c->used);
 }
}
static void process(struct connection*c){
 c->input[c->used]=0;char*end=strstr(c->input,"\r\n\r\n");if(!end)return;
 unsigned header=end+4-c->input;
 if(!strncmp(c->input,"GET /ws HTTP/1.",15)){
  unsigned length=0,version=0;const char*key=header_text(c->input,end,"Sec-WebSocket-Key",&length);char accept[29];
  if(strncmp(c->input,"GET /ws HTTP/1.1\r\n",18)||!header_token(c->input,end,"Upgrade","websocket")||!header_token(c->input,end,"Connection","upgrade")||!key||!header_number(c->input,end,"Sec-WebSocket-Version",&version)||version!=13||!websocket_accept(key,length,accept)){reply(c,"400 Bad Request","text/plain","Invalid WebSocket handshake");return;}
  char*p=c->output;append(&p,"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ");append(&p,accept);append(&p,"\r\n\r\n");c->outlen=p-c->output;c->websocket=1;c->responding=1;c->used-=header;memmove(c->input,c->input+header,c->used);flush(c);ws_process(c);return;
 }

 if(!strncmp(c->input,"GET / HTTP/1.",13)){page_reply(c);return;}
 if(!strncmp(c->input,"GET /api/status HTTP/1.",23)){status_reply(c);return;}
 if(!strncmp(c->input,"GET /api/dmx/",13)&&c->input[13]>='0'&&c->input[13]<='3'&&!strncmp(c->input+14," HTTP/1.",8)){char hex[1025];unsigned port=c->input[13]-'0';const char*digits="0123456789abcdef";for(unsigned i=0;i<512;i++){unsigned v=dmx_value(port,i+1);hex[2*i]=digits[v>>4];hex[2*i+1]=digits[v&15];}hex[1024]=0;reply(c,"200 OK","text/plain",hex);return;}

 if(!strncmp(c->input,"POST /api/command HTTP/1.",25)){
  unsigned length;if(!header_number(c->input,end,"Content-Length",&length)||!length||length>1000){reply(c,"400 Bad Request","text/plain","Invalid command length");return;}
  if(c->used<header+length)return;
  int ok=control_command(c->input+header,length);reply(c,ok?"200 OK":"400 Bad Request","application/json",ok?"{\"ok\":true}":"{\"ok\":false}");return;
 }
 if(!strncmp(c->input,"GET /api/config HTTP/1.",23)){
  unsigned keylen=0;const char*key=header_text(c->input,end,"X-Facade-Key",&keylen);
  if(!runtime_admin(key,keylen)){reply(c,"403 Forbidden","text/plain","Admin key required");return;}
  char config[640];if(control_configuration(config,sizeof config))reply(c,"200 OK","application/json",config);else reply(c,"500 Internal Server Error","text/plain","Configuration overflow");return;
 }
 if(!strncmp(c->input,"POST /api/config HTTP/1.",24)){
  unsigned length,keylen=0;const char*key=header_text(c->input,end,"X-Facade-Key",&keylen);
  if(!runtime_admin(key,keylen)){reply(c,"403 Forbidden","text/plain","Admin key required");return;}
  if(!header_number(c->input,end,"Content-Length",&length)||!length||length>1000){reply(c,"400 Bad Request","text/plain","Invalid configuration length");return;}
  if(c->used<header+length)return;
  int ok=control_configure(c->input+header,length);reply(c,ok?"200 OK":"400 Bad Request","application/json",ok?"{\"ok\":true,\"restart_for_network\":true}":"{\"ok\":false}");return;
 }
 if(!strncmp(c->input,"POST /api/update HTTP/1.",24)){
  unsigned keylen=0;const char*admin=header_text(c->input,end,"X-Facade-Key",&keylen);
  if(!runtime_admin(admin,keylen)){reply(c,"403 Forbidden","text/plain","Admin key required");return;}
  unsigned length,key;
  if(!header_number(c->input,end,"Content-Length",&length)||length!=16||!header_number(c->input,end,"X-LogicSync-Update",&key)||key!=1){reply(c,"400 Bad Request","text/plain","Invalid update request");return;}
  if(c->used<header+16)return;
  if(memcmp(c->input+header,"enter-usb-update",16)){reply(c,"400 Bad Request","text/plain","Invalid update request");return;}
  reply(c,"200 OK","application/json","{\"update\":\"usb\"}");update_schedule();return;
 }
 reply(c,"404 Not Found","text/plain","Not found");
}
static err_t received(void*arg,struct tcp_pcb*pcb,struct pbuf*p,err_t err){
 struct connection*c=arg;(void)err;
 if(!p){tcp_abort(pcb);release(c);return ERR_ABRT;}
 tcp_recved(pcb,p->tot_len);
 c->started=sys_now();
 if(c->websocket){if(c->used+p->tot_len>sizeof c->input)ws_close(c,1009);else{pbuf_copy_partial(p,c->input+c->used,p->tot_len,0);c->used+=p->tot_len;ws_process(c);}}
 else if(!c->responding){
  if(c->used+p->tot_len>=sizeof c->input)reply(c,"413 Content Too Large","text/plain","Request too large");
  else{pbuf_copy_partial(p,c->input+c->used,p->tot_len,0);c->used+=p->tot_len;process(c);}
 }
 pbuf_free(p);return ERR_OK;
}
static err_t sent(void*arg,struct tcp_pcb*pcb,u16_t len){(void)pcb;struct connection*c=arg;c->inflight=len>c->inflight?0:c->inflight-len;return flush(c);}
static err_t poll(void*arg,struct tcp_pcb*pcb){struct connection*c=arg;if((uint32_t)(sys_now()-c->started)>(c->websocket?120000u:10000u)){tcp_abort(pcb);release(c);return ERR_ABRT;}return flush(c);}
static err_t accepted(void*arg,struct tcp_pcb*pcb,err_t err){
 (void)arg;(void)err;for(unsigned i=0;i<3;i++)if(!connections[i].pcb){struct connection*c=&connections[i];memset(c,0,sizeof*c);c->pcb=pcb;c->started=sys_now();tcp_arg(pcb,c);tcp_recv(pcb,received);tcp_sent(pcb,sent);tcp_err(pcb,failed);tcp_poll(pcb,poll,2);return ERR_OK;}
 tcp_abort(pcb);return ERR_ABRT;
}
void services_init(void){struct tcp_pcb*p=tcp_new();if(p&&tcp_bind(p,IP_ADDR_ANY,80)==ERR_OK){p=tcp_listen(p);if(p)tcp_accept(p,accepted);}}
void services_poll(void){control_poll();}
