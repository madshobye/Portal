#include "app.h"
#include "runtime.h"
#include "protocol.h"
#include "string.h"
#include "lwip/apps/mqtt.h"
#include "lwip/dns.h"
#define PREFIX "illutron-facade-dmx112-gd32f307-4universe-7c92e6b4a8134f60a9d2"
static mqtt_client_t*client;
static ip_addr_t broker;
static unsigned connecting,resolving,resolved,dirty=1;
static uint32_t retry_at,published_at;
static unsigned observed_owner,observed_mode;
static char incoming[FACADE_MESSAGE_MAX],suffix[32];
static unsigned incoming_used,incoming_valid;
static struct mqtt_connect_client_info_t info;
static char client_id[40];
/* A bounded JSON writer shared by MQTT state and HTTP status. */
typedef struct {char*p;unsigned left;int ok;} Writer;
static void text(Writer*w,const char*s){while(*s){if(w->left<2){w->ok=0;return;}*w->p++=*s++;w->left--;}*w->p=0;}
static void num(Writer*w,unsigned value){char b[12];unsigned n=0;do{b[n++]=(char)('0'+value%10);value/=10;}while(value);while(n){char c[2]={b[--n],0};text(w,c);}}
unsigned control_state(char*out,unsigned capacity){
 if(!capacity)return 0;
 Writer w={out,capacity,1};char ip[16];network_address(ip,sizeof ip);
 text(&w,"{\"firmware\":\"facade-0.10\",\"ip\":\"");text(&w,ip);text(&w,"\",\"uptime_ms\":");num(&w,sys_now());
 text(&w,",\"effect\":");num(&w,facade_config.effect);text(&w,",\"color\":[");for(unsigned i=0;i<3;i++){if(i)text(&w,",");num(&w,facade_config.color[i]);}
 text(&w,"],\"brightness\":");num(&w,facade_config.brightness);text(&w,",\"limit\":");num(&w,facade_config.limit);text(&w,",\"speed\":");num(&w,facade_config.speed);
 text(&w,",\"fixtures\":[");for(unsigned i=0;i<4;i++){if(i)text(&w,",");num(&w,facade_config.fixtures[i]);}text(&w,"],\"pixels\":");num(&w,facade_count());
 text(&w,",\"mode\":");num(&w,facade_mode());text(&w,",\"artist\":");text(&w,facade_owner()?"true":"false");text(&w,",\"inactive_ms\":");num(&w,facade_inactive(sys_now()));
 text(&w,",\"mqtt_connected\":");text(&w,control_mqtt_connected()?"true":"false");text(&w,",\"dmx_enabled_mask\":");num(&w,dmx_enabled());
 text(&w,",\"rx\":");num(&w,ethernet_rx);text(&w,",\"tx\":");num(&w,ethernet_tx);text(&w,",\"save_ok\":");text(&w,runtime_save_ok()?"true":"false");
 text(&w,",\"dhcp\":");num(&w,runtime_network.dhcp);text(&w,",\"network_restart_pending\":");text(&w,runtime_network_pending()?"true":"false");text(&w,",\"idle_remaining_ms\":");unsigned idle=facade_inactive(sys_now());num(&w,idle>=FACADE_IDLE_MS?0:FACADE_IDLE_MS-idle);
 text(&w,",\"dmx_frames\":[");for(unsigned i=0;i<4;i++){if(i)text(&w,",");num(&w,dmx_frames(i));}text(&w,"]");
 extern char _ebss,_estack;text(&w,",\"ram_unallocated_bytes\":");num(&w,(unsigned)((uintptr_t)&_estack-(uintptr_t)&_ebss));
 text(&w,",\"stack_untouched_bytes\":");num(&w,memory_stack_untouched());
 text(&w,",\"events\":[");for(unsigned i=0;i<runtime_event_count();i++){uint32_t time;const char*event=runtime_event_get(i,&time);if(i)text(&w,",");text(&w,"{\"ms\":");num(&w,time);text(&w,",\"text\":\"");text(&w,event);text(&w,"\"}");}text(&w,"]}");return w.ok?(unsigned)(w.p-out):0;
}
/* Admin-only readback excludes passwords and both access keys. */
unsigned control_configuration(char*out,unsigned capacity){
 if(!capacity)return 0;
 Writer w={out,capacity,1};text(&w,"{\"dhcp\":");num(&w,runtime_settings.dhcp);
 const uint8_t*addresses[]={runtime_settings.ip,runtime_settings.mask,runtime_settings.gateway};
 const char*names[]={"ip","mask","gateway"};
 for(unsigned i=0;i<3;i++){text(&w,",\"");text(&w,names[i]);text(&w,"\":\"");for(unsigned j=0;j<4;j++){if(j)text(&w,".");num(&w,addresses[i][j]);}text(&w,"\"");}
 text(&w,",\"broker\":\"");
 for(const unsigned char*p=(const unsigned char*)runtime_settings.broker;*p;p++){
  if(*p=='"'||*p=='\\')text(&w,"\\");
  if(*p<32){const char*hex="0123456789abcdef";char escaped[]={ '\\','u','0','0',hex[*p>>4],hex[*p&15],0};text(&w,escaped);}
  else{char c[]={*p,0};text(&w,c);}
 }
 text(&w,"\",\"port\":");num(&w,runtime_settings.port);text(&w,"}");return w.ok?(unsigned)(w.p-out):0;
}
int control_apply(const char*topic,const char*body,unsigned n,unsigned owner){
 int ok=facade_message(topic,body,n,owner,sys_now());if(ok){dirty=1;if(!strncmp(topic,"/set/",5))runtime_changed();runtime_event("Control command accepted");}else runtime_event("Control command rejected");return ok;
}
int control_command(const char*data,unsigned length){
 const char*space=memchr(data,' ',length);if(!space||space-data>=32)return 0;
 char topic[32];unsigned n=space-data;memcpy(topic,data,n);topic[n]=0;return control_apply(topic,space+1,length-n-1,0);
}
static void publication(void*arg,const char*topic,u32_t size){
 (void)arg;incoming_used=0;incoming_valid=0;unsigned prefix=sizeof(PREFIX)-1;
 if(strncmp(topic,PREFIX,prefix)||size>sizeof incoming)return;
 topic+=prefix;unsigned n=strlen(topic);if(n>=sizeof suffix)return;memcpy(suffix,topic,n+1);incoming_valid=1;
}
static void data_received(void*arg,const u8_t*data,u16_t length,u8_t flags){
 (void)arg;
 /* Retained commands can replay old animation data or wake an idle facade. */
 if(flags&0x80)incoming_valid=0;
 if(!incoming_valid||incoming_used+length>sizeof incoming){incoming_valid=0;return;}
 memcpy(incoming+incoming_used,data,length);incoming_used+=length;
 if(flags&MQTT_DATA_FLAG_LAST)control_apply(suffix,incoming,incoming_used,0);
}
static void connection_changed(mqtt_client_t*c,void*arg,mqtt_connection_status_t status){
 (void)arg;connecting=0;retry_at=sys_now()+5000;
 if(status==MQTT_CONNECT_ACCEPTED){mqtt_set_inpub_callback(c,publication,data_received,0);mqtt_subscribe(c,PREFIX "/set/+",0,0,0);mqtt_subscribe(c,PREFIX "/pixels/+",0,0,0);dirty=1;runtime_event("MQTT connected");}
 else{resolved=0;runtime_event("MQTT disconnected; retry scheduled");}
}
static void found(const char*name,const ip_addr_t*address,void*arg){(void)arg;resolving=0;if(address&&!strcmp(name,runtime_network.broker)){broker=*address;resolved=1;}else retry_at=sys_now()+5000;}
unsigned control_mqtt_connected(void){return client&&mqtt_client_is_connected(client);}
void control_poll(void){
 /* Artist commands and automatic expiry bypass control_apply. Observe them
  * centrally so every ownership/mode change reaches visitors promptly, while
  * unchanged artist frames do not generate redundant state publications. */
 unsigned owner=facade_owner(),mode=facade_mode();
 if(owner!=observed_owner||mode!=observed_mode){dirty=1;observed_owner=owner;observed_mode=mode;}
 uint32_t now=sys_now();if(!network_ready())return;
 if(control_mqtt_connected()){
  if(dirty||(uint32_t)(now-published_at)>=10000){
   char state[1400];unsigned n=control_state(state,sizeof state);
   if(n&&mqtt_publish(client,PREFIX "/state",state,n,0,1,0,0)==ERR_OK){dirty=0;published_at=now;mqtt_publish(client,PREFIX "/status","{\"online\":true}",15,0,1,0,0);}
  }return;
 }
 if(connecting||resolving||(int32_t)(now-retry_at)<0)return;
 if(!resolved){resolving=1;err_t e=dns_gethostbyname(runtime_network.broker,&broker,found,0);if(e==ERR_OK){resolving=0;resolved=1;}else if(e!=ERR_INPROGRESS){resolving=0;retry_at=now+5000;}return;}
 if(!client)client=mqtt_client_new();
 if(!client){retry_at=now+5000;return;}
 memset(&info,0,sizeof info);strcpy(client_id,"facade-");char ip[16];network_address(ip,sizeof ip);strcpy(client_id+7,ip);
 info.client_id=client_id;info.client_user=runtime_network.username;info.client_pass=runtime_network.password;info.keep_alive=20;info.will_topic=PREFIX "/status";info.will_msg="{\"online\":false}";info.will_qos=0;info.will_retain=1;
 connecting=1;if(mqtt_client_connect(client,&broker,runtime_network.port,connection_changed,0,&info)!=ERR_OK){connecting=0;retry_at=now+5000;}
}

int control_configure(const char*body,unsigned n){Settings next=runtime_settings;next.facade=facade_config;if(!protocol_config(body,n,&next))return 0;runtime_settings=next;if(!facade_configure(&next.facade,sys_now()))return 0;dirty=1;return runtime_save();}
