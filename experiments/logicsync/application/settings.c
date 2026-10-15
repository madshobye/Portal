#include "settings.h"
#include "string.h"
#include <stddef.h>
#define MAGIC 0x46414331u
#define COMMIT 0x53415645u
typedef struct {uint32_t magic,sequence;Settings settings;uint32_t crc,commit;} Record;
_Static_assert(sizeof(Record)<SETTINGS_PAGE_SIZE,"settings exceed page");
_Static_assert(sizeof(Record)%4==0,"record must be word aligned");
static uint32_t crc32(const void *data,unsigned n){const uint8_t*b=data;uint32_t c=~0u;while(n--){c^=*b++;for(unsigned j=0;j<8;j++)c=(c>>1)^(0xedb88320u&-(c&1));}return ~c;}
static int text(const char*s,unsigned cap){for(unsigned i=0;i<cap;i++){if(!s[i])return i>0;if((unsigned char)s[i]<32||(unsigned char)s[i]>126)return 0;}return 0;}
int settings_valid(const Settings*s){
 unsigned n=0;for(unsigned p=0;p<4;p++){if(s->facade.fixtures[p]>4)return 0;n+=s->facade.fixtures[p];}
 if(!n||n>16||s->facade.effect>=FX_COUNT||!s->facade.speed||s->facade.speed>400||s->dhcp>1||!s->port)return 0;
 uint32_t mask=((uint32_t)s->mask[0]<<24)|((uint32_t)s->mask[1]<<16)|((uint32_t)s->mask[2]<<8)|s->mask[3],inverse=~mask;
 if(!mask||(inverse&(inverse+1))||!s->ip[0]||s->ip[0]>=224||s->ip[0]==127)return 0;
 if(!text(s->broker,sizeof s->broker)||!memchr(s->username,0,sizeof s->username)||!memchr(s->password,0,sizeof s->password))return 0;
 for(unsigned i=0;i<32;i++){char a=s->artist_key[i],b=s->admin_key[i];if(!((a>='0'&&a<='9')||(a>='a'&&a<='f'))||!((b>='0'&&b<='9')||(b>='a'&&b<='f')))return 0;}
 return !s->artist_key[32]&&!s->admin_key[32];
}
static int valid(const Record*r){return r->magic==MAGIC&&r->commit==COMMIT&&r->crc==crc32(r,offsetof(Record,crc))&&settings_valid(&r->settings);}
static int latest(const Record*r){int a=valid(r),b=valid(r+1);if(!a)return b?1:-1;if(!b)return 0;return (int32_t)(r[1].sequence-r[0].sequence)>0?1:0;}
int settings_load(const SettingsStorage*io,Settings*s){Record r[2];io->read(SETTINGS_PAGE0,r,sizeof *r);io->read(SETTINGS_PAGE1,r+1,sizeof *r);int i=latest(r);if(i<0)return 0;*s=r[i].settings;return 1;}
int settings_save(const SettingsStorage*io,const Settings*s){
 if(!settings_valid(s))return 0;
 Record old[2],next,check;io->read(SETTINGS_PAGE0,old,sizeof *old);io->read(SETTINGS_PAGE1,old+1,sizeof *old);
 int i=latest(old);if(i>=0&&!memcmp(&old[i].settings,s,sizeof *s))return 1;
 memset(&next,0,sizeof next);next.magic=MAGIC;next.sequence=i<0?1:old[i].sequence+1;next.settings=*s;next.crc=crc32(&next,offsetof(Record,crc));next.commit=COMMIT;
 uint32_t address=i==0?SETTINGS_PAGE1:SETTINGS_PAGE0;
 if(!io->erase(address))return 0;
 for(unsigned offset=0;offset<offsetof(Record,commit);offset+=4){uint32_t word;memcpy(&word,(const uint8_t*)&next+offset,4);if(!io->write(address+offset,word))return 0;}
 io->read(address,&check,sizeof check);
 if(memcmp(&check,&next,offsetof(Record,commit)))return 0;
 if(!io->write(address+offsetof(Record,commit),COMMIT))return 0;
 io->read(address,&check,sizeof check);return valid(&check);
}
