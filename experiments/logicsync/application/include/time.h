#ifndef FACADE_TIME_H
#define FACADE_TIME_H
/* lwIP's optional SNTP debug formatter; debug output is disabled on this target. */
#include <stdint.h>
typedef int64_t time_t;
char *ctime(const time_t *time);
#endif
