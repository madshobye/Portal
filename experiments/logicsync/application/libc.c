#include "string.h"
#include "stdlib.h"
void *memcpy(void*d,const void*s,size_t n){char*a=d;const char*b=s;while(n--)*a++=*b++;return d;}
void *memmove(void*d,const void*s,size_t n){char*a=d;const char*b=s;if(a<b)return memcpy(d,s,n);while(n){--n;a[n]=b[n];}return d;}
void *memset(void*d,int v,size_t n){unsigned char*p=d;while(n--)*p++=(unsigned char)v;return d;}
int memcmp(const void*a,const void*b,size_t n){const unsigned char*x=a,*y=b;while(n--){if(*x!=*y)return *x-*y;++x;++y;}return 0;}
size_t strlen(const char*s){size_t n=0;while(s[n])++n;return n;}
int strcmp(const char*a,const char*b){while(*a&&*a==*b){++a;++b;}return (unsigned char)*a-(unsigned char)*b;}
int strncmp(const char*a,const char*b,size_t n){while(n--){if(*a!=*b||!*a)return (unsigned char)*a-(unsigned char)*b;++a;++b;}return 0;}
char *strchr(const char*s,int c){do{if(*s==(char)c)return (char*)s;}while(*s++);return 0;}
char *strstr(const char*s,const char*t){size_t n=strlen(t);do{if(!strncmp(s,t,n))return (char*)s;}while(*s++);return 0;}
char *strncpy(char*d,const char*s,size_t n){char*r=d;while(n&&*s){*d++=*s++;--n;}while(n--)*d++=0;return r;}
int atoi(const char*s){int v=0,sign=1;while(*s==' '||*s=='\t')++s;if(*s=='-'){sign=-1;++s;}while(*s>='0'&&*s<='9')v=v*10+*s++-'0';return v*sign;}
void abort(void){while(1){}}
void platform_assert(const char*s){(void)s;abort();}
void *memchr(const void*s,int c,size_t n){const unsigned char*p=s;while(n--){if(*p==(unsigned char)c)return (void*)p;++p;}return 0;}

char *strcpy(char*d,const char*s){char*r=d;while((*d++=*s++));return r;}
