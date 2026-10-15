/* Bounded JSON reader. Parses byte arrays directly, without per-number tokens. */
#include "protocol.h"
#include "facade.h"
#include "string.h"
typedef struct {const char *p,*end;} Reader;
typedef struct {const char *key;unsigned length;Reader value;} Field;
static void ws(Reader*r){while(r->p<r->end&&(*r->p==' '||*r->p=='\r'||*r->p=='\n'||*r->p=='\t'))r->p++;}
static int take(Reader*r,char c){ws(r);if(r->p==r->end||*r->p!=c)return 0;r->p++;return 1;}
static int integer(Reader*r,unsigned*out){
 ws(r);unsigned n=0,k=0;const char*start=r->p;
 while(r->p<r->end&&*r->p>='0'&&*r->p<='9'){if(++k>6)return 0;n=n*10+*r->p++-'0';}
 if(!k||(k>1&&*start=='0'))return 0;
 *out=n;return 1;
}
static int string(Reader*r,const char**start,unsigned*n){
 if(!take(r,'"'))return 0;
 *start=r->p;
 while(r->p<r->end&&*r->p!='"'){unsigned c=(unsigned char)*r->p++;if(c<32||c>=127||c=='\\')return 0;}
 if(r->p==r->end)return 0;
 *n=r->p-*start;r->p++;return 1;
}
static int value(Reader*r,unsigned depth){
 if(depth>4)return 0;
 ws(r);if(r->p==r->end)return 0;
 if(*r->p=='"'){const char*s;unsigned n;return string(r,&s,&n);}
 if(*r->p=='['||*r->p=='{'){
  int object=*r->p=='{';char close=object?'}':']';r->p++;if(take(r,close))return 1;
  do{if(object){const char*s;unsigned n;if(!string(r,&s,&n)||!take(r,':'))return 0;}if(!value(r,depth+1))return 0;}while(take(r,','));return take(r,close);
 }
 unsigned n;return integer(r,&n);
}
static int fields(Reader r,Field*f,unsigned*n){
 *n=0;if(!take(&r,'{'))return 0;
 if(!take(&r,'}')){do{
  if(*n>=8)return 0;
  Field*next=f+*n;
  if(!string(&r,&next->key,&next->length)||!take(&r,':'))return 0;
  for(unsigned i=0;i<*n;i++)if(f[i].length==next->length&&!memcmp(f[i].key,next->key,next->length))return 0;
  next->value.p=r.p;if(!value(&r,0))return 0;next->value.end=r.p;(*n)++;
 }while(take(&r,','));if(!take(&r,'}'))return 0;}
 ws(&r);return r.p==r.end;
}
static int find(Field*f,unsigned n,const char*key,Reader*out){for(unsigned i=0;i<n;i++)if(f[i].length==strlen(key)&&!memcmp(f[i].key,key,f[i].length)){*out=f[i].value;return 1;}return 0;}
static int fieldnum(Field*f,unsigned n,const char*key,unsigned*out){Reader r;if(!find(f,n,key,&r)||!integer(&r,out))return 0;ws(&r);return r.p==r.end;}
static int triplet(Reader*r,RGB*c){unsigned a,b,d;if(!take(r,'[')||!integer(r,&a)||!take(r,',')||!integer(r,&b)||!take(r,',')||!integer(r,&d)||!take(r,']')||a>255||b>255||d>255)return 0;*c=(RGB){a,b,d};return 1;}
static int scalar(Reader r,unsigned*v){if(!integer(&r,v))return 0;ws(&r);return r.p==r.end;}
static int empty(Reader r){ws(&r);return r.p==r.end||(take(&r,'{')&&take(&r,'}')&&(ws(&r),r.p==r.end));}
int facade_message(const char*topic,const char*body,unsigned length,unsigned owner,uint32_t now){
 if(length>FACADE_MESSAGE_MAX||memchr(body,0,length))return 0;
 Reader r={body,body+length};Field f[8];unsigned n,a,b,c;
 if(!strcmp(topic,"/set/effect")){
  if(owner)return 0;
  if(scalar(r,&a))return facade_effect(a,now);
  const char*s;unsigned size;Reader q=r;
  if(string(&q,&s,&size)){ws(&q);if(q.p!=q.end)return 0;}
  else{s=body;size=length;}
  for(a=0;a<FX_COUNT;a++)if(strlen(facade_effect_names[a])==size&&!memcmp(s,facade_effect_names[a],size))return facade_effect(a,now);
  return 0;
 }
 if(!strcmp(topic,"/set/brightness"))return !owner&&scalar(r,&a)&&facade_brightness(a,now);
 if(!strcmp(topic,"/set/speed"))return !owner&&scalar(r,&a)&&facade_speed(a,now);
 if(!strcmp(topic,"/pixels/clear"))return empty(r)&&facade_clear(owner,now);
 if(!strcmp(topic,"/pixels/release"))return empty(r)&&facade_release_request(owner,now);
 if(!fields(r,f,&n))return 0;
 if(!strcmp(topic,"/set/color")){
  if(owner)return 0;
  if(n==3&&fieldnum(f,n,"r",&a)&&fieldnum(f,n,"g",&b)&&fieldnum(f,n,"b",&c)&&a<256&&b<256&&c<256)return facade_color((RGB){a,b,c},now);
  /* HSV units are hue degrees [0,360], saturation/value percentages [0,100]. */
  if(n!=3||!fieldnum(f,n,"h",&a)||!fieldnum(f,n,"s",&b)||!fieldnum(f,n,"v",&c)||a>360||b>100||c>100)return 0;
  unsigned h=a%360,v=c*255/100,low=v*(100-b)/100,up=low+(v-low)*(h%60)/60,down=v-(v-low)*(h%60)/60;RGB color;
  switch(h/60){case 0:color=(RGB){v,up,low};break;case 1:color=(RGB){down,v,low};break;case 2:color=(RGB){low,v,up};break;case 3:color=(RGB){low,down,v};break;case 4:color=(RGB){up,low,v};break;default:color=(RGB){v,low,down};}
  return facade_color(color,now);
 }
 if(!strcmp(topic,"/pixels/set")){
  unsigned index;if(n!=4||!fieldnum(f,n,"index",&index)||!fieldnum(f,n,"r",&a)||!fieldnum(f,n,"g",&b)||!fieldnum(f,n,"b",&c)||a>255||b>255||c>255)return 0;
  RGB pixel={a,b,c};return facade_pixels(owner,index,&pixel,1,now);
 }
 RGB pixels[FACADE_PIXELS];unsigned count=0,start=0;
 if(!strcmp(topic,"/pixels/range")){
  if(n!=2||!fieldnum(f,n,"start",&start)||!find(f,n,"colors",&r)||!take(&r,'['))return 0;
  do{if(count>=FACADE_PIXELS||!triplet(&r,pixels+count))return 0;count++;}while(take(&r,','));
  if(!take(&r,']'))return 0;
 }else if(!strcmp(topic,"/pixels/frame")){
  if(n!=1||!find(f,n,"rgb",&r)||!take(&r,'['))return 0;
  do{if(count>=FACADE_PIXELS||!integer(&r,&a)||!take(&r,',')||!integer(&r,&b)||!take(&r,',')||!integer(&r,&c)||a>255||b>255||c>255)return 0;pixels[count++]=(RGB){a,b,c};}while(take(&r,','));
  if(!take(&r,']')||count!=facade_count())return 0;
 }else return 0;
 ws(&r);return r.p==r.end&&facade_pixels(owner,start,pixels,count,now);
}

#include "settings.h"
static int field_string(Reader r,char*out,unsigned capacity){const char*s;unsigned n;if(!string(&r,&s,&n)||n>=capacity)return 0;ws(&r);if(r.p!=r.end)return 0;memcpy(out,s,n);out[n]=0;return 1;}
static int address(Reader r,uint8_t out[4]){const char*s;unsigned n;if(!string(&r,&s,&n))return 0;ws(&r);if(r.p!=r.end)return 0;Reader q={s,s+n};for(unsigned i=0;i<4;i++){unsigned v;if(!integer(&q,&v)||v>255)return 0;out[i]=v;if(i<3&&!take(&q,'.'))return 0;}return q.p==q.end;}
int protocol_config(const char*body,unsigned length,Settings*out){
 if(length>1000||memchr(body,0,length))return 0;
 Reader r={body,body+length};Field f[8];unsigned n;if(!fields(r,f,&n)||!n)return 0;
 Settings next=*out;
 for(unsigned i=0;i<n;i++){
  char key[24];if(f[i].length>=sizeof key)return 0;memcpy(key,f[i].key,f[i].length);key[f[i].length]=0;r=f[i].value;unsigned v;
  if(!strcmp(key,"fixtures")){if(!take(&r,'['))return 0;for(unsigned p=0;p<4;p++){if(!integer(&r,&v)||v>4)return 0;next.facade.fixtures[p]=v;if(p<3&&!take(&r,','))return 0;}if(!take(&r,']'))return 0;ws(&r);if(r.p!=r.end)return 0;}
  else if(!strcmp(key,"limit")){if(!scalar(r,&v)||v>255)return 0;next.facade.limit=v;}
  else if(!strcmp(key,"dhcp")){if(!scalar(r,&v)||v>1)return 0;next.dhcp=v;}
  else if(!strcmp(key,"port")){if(!scalar(r,&v)||!v||v>65535)return 0;next.port=v;}
  else if(!strcmp(key,"ip")){if(!address(r,next.ip))return 0;}
  else if(!strcmp(key,"mask")){if(!address(r,next.mask))return 0;}
  else if(!strcmp(key,"gateway")){if(!address(r,next.gateway))return 0;}
  else if(!strcmp(key,"broker")){if(!field_string(r,next.broker,sizeof next.broker))return 0;}
  else if(!strcmp(key,"username")){if(!field_string(r,next.username,sizeof next.username))return 0;}
  else if(!strcmp(key,"password")){if(!field_string(r,next.password,sizeof next.password))return 0;}
  else return 0;
 }
 if(!settings_valid(&next))return 0;
 *out=next;return 1;
}
