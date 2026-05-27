#ifndef PEER_H_
#define PEER_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "peer_connection.h"
#include "peer_signaling.h"

int peer_init();

void peer_deinit();

void peer_handle_timers(uint32_t elapsed_milliseconds);

#ifdef __cplusplus
}
#endif

#endif  // PEER_H_
