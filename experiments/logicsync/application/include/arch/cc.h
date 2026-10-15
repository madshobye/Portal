#ifndef PORT_CC_H
#define PORT_CC_H
#include <stdint.h>
#define LWIP_NO_INTTYPES_H 1
#define LWIP_NO_UNISTD_H 1
#define LWIP_NO_CTYPE_H 1
#define LWIP_PLATFORM_DIAG(x) do {} while(0)
void platform_assert(const char*);
#define LWIP_PLATFORM_ASSERT(x) platform_assert(x)
uint32_t network_random(void);
#define LWIP_RAND() network_random()
#define BYTE_ORDER LITTLE_ENDIAN
#define U16_F "u"
#define S16_F "d"
#define X16_F "x"
#define U32_F "lu"
#define S32_F "ld"
#define X32_F "lx"
#define SZT_F "u"
#endif
