/* Copenhagen (55.6761 N, 12.5683 E); NOAA fractional-year solar equations.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Europe/Copenhagen: EU last-Sunday DST rules, switching at 01:00 UTC.
 * No heap, RTC dependency or libm; solar calculation runs once per local day.
 */
#include "astro.h"
#define PI 3.14159265358979323846
static uint32_t epoch,last_tick,remainder,cached_day;
static unsigned valid,cached_sunset;
static int leap(unsigned y){return y%4==0&&(y%100!=0||y%400==0);}
static uint32_t year_start(unsigned y){uint32_t d=0;for(unsigned a=1970;a<y;a++)d+=365+leap(a);return d;}
static unsigned year_at(uint32_t days,unsigned *doy){unsigned y=1970;while(days>=365u+leap(y)){days-=365+leap(y);y++;}*doy=days;return y;}
static double sine(double x){while(x>PI)x-=2*PI;while(x< -PI)x+=2*PI;double sum=x,term=x;for(unsigned i=1;i<10;i++){term*=-x*x/((2*i)*(2*i+1));sum+=term;}return sum;}
static double cosine(double x){return sine(x+PI/2);}
unsigned astro_offset(uint32_t utc){
 unsigned doy,y=year_at(utc/86400,&doy);(void)doy;
 uint32_t start=year_start(y),march=start+89+leap(y),october=start+303+leap(y);
 march-=(march+4)%7;october-=(october+4)%7;
 return utc>=march*86400+3600&&utc<october*86400+3600?120:60;
}
unsigned astro_sunset(uint32_t day){
 unsigned doy,y=year_at(day,&doy);
 double g=2*PI*doy/(365+leap(y));
 double eq=229.18*(0.000075+0.001868*cosine(g)-0.032077*sine(g)-0.014615*cosine(2*g)-0.040849*sine(2*g));
 double dec=0.006918-0.399912*cosine(g)+0.070257*sine(g)-0.006758*cosine(2*g)+0.000907*sine(2*g)-0.002697*cosine(3*g)+0.00148*sine(3*g);
 double lat=55.6761*PI/180;
 double c=(cosine(90.833*PI/180)-sine(lat)*sine(dec))/(cosine(lat)*cosine(dec));
 /* Copenhagen always has a sunrise/sunset; clamp defensive numerical limits. */
 if(c>1)c=1;
 if(c< -1)c=-1;
 double lo=0,hi=PI;for(unsigned i=0;i<32;i++){double mid=(lo+hi)/2;if(cosine(mid)>c)lo=mid;else hi=mid;}
 double utc_minutes=720-4*12.5683-eq+4*(lo+hi)/2*180/PI;
 return (unsigned)(utc_minutes+0.5)+astro_offset(day*86400+43200);
}
void astro_init(uint32_t now){epoch=0;last_tick=now;remainder=0;valid=0;cached_day=0xffffffffu;}
void astro_tick(uint32_t now){uint32_t dt=now-last_tick;last_tick=now;if(valid){epoch+=dt/1000;remainder+=dt%1000;epoch+=remainder/1000;remainder%=1000;}}
int astro_sync(uint32_t utc,uint32_t now){if(utc<1704067200u||utc>4102444799u)return 0;epoch=utc;last_tick=now;remainder=0;valid=1;return 1;}
uint32_t astro_utc(void){return valid?epoch:0;}
AstroState astro_state(void){
 AstroState s={0};s.valid=valid;if(!valid)return s;s.utc=epoch;
 uint32_t local=epoch+astro_offset(epoch)*60,day=local/86400;
 if(day!=cached_day){cached_sunset=astro_sunset(day);cached_day=day;}
 s.local_minute=local%86400/60;s.sunset_minute=cached_sunset;
 s.on=s.local_minute<120||s.local_minute>=s.sunset_minute;
 /* One two-hour hue revolution, identical at every pixel; independent of
  * effect speed. Smooth cosine easing avoids abrupt changes at color corners. */
 unsigned phase=epoch%7200,sector=phase/1200;
 unsigned v=(unsigned)((1-cosine((phase%1200)*PI/1200))*127.5+0.5);
 switch(sector){case 0:s.color=(RGB){255,v,0};break;case 1:s.color=(RGB){255-v,255,0};break;case 2:s.color=(RGB){0,255,v};break;case 3:s.color=(RGB){0,255-v,255};break;case 4:s.color=(RGB){v,0,255};break;default:s.color=(RGB){255,0,255-v};}
 return s;
}
