#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include "agent.h"
#include "config.h"
#include "dtls_srtp.h"
#include "peer_connection.h"
#include "ports.h"
#include "sctp.h"
#include "sdp.h"

#define STATE_CHANGED(pc, curr_state)                                 \
  if (pc->oniceconnectionstatechange && pc->state != curr_state) {    \
    pc->oniceconnectionstatechange(curr_state, pc->config.user_data); \
    pc->state = curr_state;                                           \
  }

struct PeerConnection {
  PeerConfiguration config;
  PeerConnectionState state;
  Agent agent;
  DtlsSrtp* dtls_srtp;
  Sctp sctp;

  char* sdp;

  void (*onicecandidate)(char* sdp, void* user_data);
  void (*oniceconnectionstatechange)(PeerConnectionState state, void* user_data);
  void (*on_connected)(void* userdata);

  uint8_t* temp_buf;
  uint8_t* agent_buf;
  int agent_ret;
  int b_local_description_created;

};

#if CONFIG_STATIC_PEER_CONNECTION
static PeerConnection g_static_peer_connection;
static DtlsSrtp g_static_dtls_srtp;
static int g_static_peer_connection_in_use = 0;
#endif
static char g_peer_connection_last_error[160];

static void peer_connection_set_last_error(const char* fmt, ...) {
  va_list args;
  va_start(args, fmt);
  vsnprintf(g_peer_connection_last_error, sizeof(g_peer_connection_last_error), fmt, args);
  va_end(args);
}

const char* peer_connection_last_error(void) {
  return g_peer_connection_last_error[0] ? g_peer_connection_last_error : "";
}

static int peer_connection_dtls_srtp_recv(void* ctx, unsigned char* buf, size_t len) {
  int recv_max = 0;
  int ret = -1;
  DtlsSrtp* dtls_srtp = (DtlsSrtp*)ctx;
  PeerConnection* pc = (PeerConnection*)dtls_srtp->user_data;

  if (pc->agent_ret > 0 && pc->agent_ret <= len) {
    memcpy(buf, pc->agent_buf, pc->agent_ret);
    return pc->agent_ret;
  }

  while (recv_max < CONFIG_TLS_READ_TIMEOUT && pc->state == PEER_CONNECTION_CONNECTED) {
    ret = agent_recv(&pc->agent, buf, len);

    if (ret > 0) {
      break;
    }

    recv_max++;
  }
  return ret;
}

static int peer_connection_dtls_srtp_send(void* ctx, const uint8_t* buf, size_t len) {
  DtlsSrtp* dtls_srtp = (DtlsSrtp*)ctx;
  PeerConnection* pc = (PeerConnection*)dtls_srtp->user_data;

  // LOGD("send %.4x %.4x, %ld", *(uint16_t*)buf, *(uint16_t*)(buf + 2), len);
  return agent_send(&pc->agent, buf, len);
}

const char* peer_connection_state_to_string(PeerConnectionState state) {
  switch (state) {
    case PEER_CONNECTION_NEW:
      return "new";
    case PEER_CONNECTION_CHECKING:
      return "checking";
    case PEER_CONNECTION_CONNECTED:
      return "connected";
    case PEER_CONNECTION_COMPLETED:
      return "completed";
    case PEER_CONNECTION_FAILED:
      return "failed";
    case PEER_CONNECTION_CLOSED:
      return "closed";
    case PEER_CONNECTION_DISCONNECTED:
      return "disconnected";
    default:
      return "unknown";
  }
}

PeerConnectionState peer_connection_get_state(PeerConnection* pc) {
  return pc->state;
}

void* peer_connection_get_sctp(PeerConnection* pc) {
  return &pc->sctp;
}

PeerConnection* peer_connection_create(PeerConfiguration* config) {
  g_peer_connection_last_error[0] = '\0';
#if CONFIG_STATIC_PEER_CONNECTION
  if (g_static_peer_connection_in_use) {
    peer_connection_set_last_error("static peer connection slot is already in use");
    LOGE("static PeerConnection is already in use");
    return NULL;
  }
  PeerConnection* pc = &g_static_peer_connection;
  memset(pc, 0, sizeof(PeerConnection));
  memset(&g_static_dtls_srtp, 0, sizeof(DtlsSrtp));
  g_static_peer_connection_in_use = 1;
#else
  PeerConnection* pc = calloc(1, sizeof(PeerConnection));
  if (!pc) {
    peer_connection_set_last_error("PeerConnection calloc failed bytes=%u", (unsigned int)sizeof(PeerConnection));
    return NULL;
  }
#endif

#if CONFIG_STATIC_PEER_CONNECTION
  pc->dtls_srtp = &g_static_dtls_srtp;
#else
  pc->dtls_srtp = calloc(1, sizeof(DtlsSrtp));
#endif
  pc->sdp = calloc(1, CONFIG_SDP_BUFFER_SIZE);
  pc->temp_buf = calloc(1, CONFIG_MTU);
  pc->agent_buf = calloc(1, CONFIG_MTU);
  if (!pc->dtls_srtp || !pc->sdp || !pc->temp_buf || !pc->agent_buf) {
    peer_connection_set_last_error("alloc failed dtls=%d sdp=%d temp=%d agent=%d sdpBytes=%u mtu=%u",
                                   pc->dtls_srtp ? 1 : 0,
                                   pc->sdp ? 1 : 0,
                                   pc->temp_buf ? 1 : 0,
                                   pc->agent_buf ? 1 : 0,
                                   (unsigned int)CONFIG_SDP_BUFFER_SIZE,
                                   (unsigned int)CONFIG_MTU);
#if !CONFIG_STATIC_PEER_CONNECTION
    free(pc->dtls_srtp);
#endif
    free(pc->sdp);
    free(pc->temp_buf);
    free(pc->agent_buf);
#if CONFIG_STATIC_PEER_CONNECTION
    g_static_peer_connection_in_use = 0;
#else
    free(pc);
#endif
    return NULL;
  }

  memcpy(&pc->config, config, sizeof(PeerConfiguration));

  agent_create(&pc->agent);

  memset(&pc->sctp, 0, sizeof(pc->sctp));

  return pc;
}

void peer_connection_destroy(PeerConnection* pc) {
  if (pc) {
    sctp_destroy_association(&pc->sctp);
    if (pc->dtls_srtp) dtls_srtp_deinit(pc->dtls_srtp);
    agent_destroy(&pc->agent);
#if !CONFIG_STATIC_PEER_CONNECTION
    free(pc->dtls_srtp);
#endif
    free(pc->sdp);
    free(pc->temp_buf);
    free(pc->agent_buf);
#if CONFIG_STATIC_PEER_CONNECTION
    if (pc == &g_static_peer_connection) {
      memset(&g_static_peer_connection, 0, sizeof(g_static_peer_connection));
      memset(&g_static_dtls_srtp, 0, sizeof(g_static_dtls_srtp));
      g_static_peer_connection_in_use = 0;
      return;
    }
#endif
    free(pc);
    pc = NULL;
  }
}

void peer_connection_close(PeerConnection* pc) {
  pc->state = PEER_CONNECTION_CLOSED;
}

void peer_connection_reset(PeerConnection* pc) {
  if (!pc) return;
  void (*sctp_onmessage)(char* msg, size_t len, void* userdata, uint16_t sid) = pc->sctp.onmessage;
  void (*sctp_onopen)(void* userdata) = pc->sctp.onopen;
  void (*sctp_onclose)(void* userdata) = pc->sctp.onclose;
  void* sctp_userdata = pc->sctp.userdata;

  sctp_destroy_association(&pc->sctp);
  memset(&pc->sctp, 0, sizeof(pc->sctp));
  pc->sctp.onmessage = sctp_onmessage;
  pc->sctp.onopen = sctp_onopen;
  pc->sctp.onclose = sctp_onclose;
  pc->sctp.userdata = sctp_userdata;

  agent_clear_candidates(&pc->agent);
  memset(pc->agent.remote_ufrag, 0, sizeof(pc->agent.remote_ufrag));
  memset(pc->agent.remote_upwd, 0, sizeof(pc->agent.remote_upwd));
  memset(pc->agent.local_ufrag, 0, sizeof(pc->agent.local_ufrag));
  memset(pc->agent.local_upwd, 0, sizeof(pc->agent.local_upwd));
  pc->agent.binding_request_time = 0;
  pc->agent.state = AGENT_STATE_GATHERING_ENDED;
  pc->agent.mode = AGENT_MODE_CONTROLLED;

  pc->agent_ret = -1;
  pc->state = PEER_CONNECTION_NEW;
}

int peer_connection_datachannel_send(PeerConnection* pc, char* message, size_t len) {
  return peer_connection_datachannel_send_sid(pc, message, len, 0);
}

int peer_connection_datachannel_send_sid(PeerConnection* pc, char* message, size_t len, uint16_t sid) {
  if (!sctp_is_connected(&pc->sctp)) {
    LOGE("sctp not connected");
    return -1;
  }
  if (pc->config.datachannel == DATA_CHANNEL_STRING)
    return sctp_outgoing_data(&pc->sctp, message, len, PPID_STRING, sid);
  else
    return sctp_outgoing_data(&pc->sctp, message, len, PPID_BINARY, sid);
}

int peer_connection_create_datachannel(PeerConnection* pc, DecpChannelType channel_type, uint16_t priority, uint32_t reliability_parameter, char* label, char* protocol) {
  return peer_connection_create_datachannel_sid(pc, channel_type, priority, reliability_parameter, label, protocol, 0);
}

int peer_connection_create_datachannel_sid(PeerConnection* pc, DecpChannelType channel_type, uint16_t priority, uint32_t reliability_parameter, char* label, char* protocol, uint16_t sid) {
  int rtrn = -1;

  if (!sctp_is_connected(&pc->sctp)) {
    LOGE("sctp not connected");
    return rtrn;
  }

  //  0                   1                   2                   3
  //  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |  Message Type |  Channel Type |            Priority           |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |                    Reliability Parameter                      |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |         Label Length          |       Protocol Length         |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |                                                               |
  // |                             Label                             |
  // |                                                               |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  // |                                                               |
  // |                            Protocol                           |
  // |                                                               |
  // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  int msg_size = 12 + strlen(label) + strlen(protocol);
  uint16_t priority_big_endian = htons(priority);
  uint32_t reliability_big_endian = ntohl(reliability_parameter);
  uint16_t label_length = htons(strlen(label));
  uint16_t protocol_length = htons(strlen(protocol));
  char* msg = calloc(1, msg_size);
  if (!msg) {
    return rtrn;
  }

  msg[0] = DATA_CHANNEL_OPEN;
  memcpy(msg + 2, &priority_big_endian, sizeof(uint16_t));
  memcpy(msg + 4, &reliability_big_endian, sizeof(uint32_t));
  memcpy(msg + 8, &label_length, sizeof(uint16_t));
  memcpy(msg + 10, &protocol_length, sizeof(uint16_t));
  memcpy(msg + 12, label, strlen(label));
  memcpy(msg + 12 + strlen(label), protocol, strlen(protocol));

  rtrn = sctp_outgoing_data(&pc->sctp, msg, msg_size, PPID_CONTROL, sid);
  free(msg);
  return rtrn;
}

static char* peer_connection_dtls_role_setup_value(DtlsSrtpRole d) {
  return d == DTLS_SRTP_ROLE_SERVER ? "a=setup:passive" : "a=setup:active";
}

int peer_connection_loop(PeerConnection* pc) {
  memset(pc->agent_buf, 0, CONFIG_MTU);
  pc->agent_ret = -1;

  switch (pc->state) {
    case PEER_CONNECTION_NEW:
      break;

    case PEER_CONNECTION_CHECKING:
      if (agent_select_candidate_pair(&pc->agent) < 0) {
        break;
      } else if (agent_connectivity_check(&pc->agent) == 0) {
        STATE_CHANGED(pc, PEER_CONNECTION_CONNECTED);
      }
      break;

    case PEER_CONNECTION_CONNECTED:

      if (dtls_srtp_handshake(pc->dtls_srtp, NULL) == 0) {
        LOGD("DTLS-SRTP handshake done");

        if (pc->config.datachannel) {
          LOGI("SCTP create socket");
          sctp_create_association(&pc->sctp, pc->dtls_srtp);
          pc->sctp.userdata = pc->config.user_data;
        }

        STATE_CHANGED(pc, PEER_CONNECTION_COMPLETED);
      } else {
        STATE_CHANGED(pc, PEER_CONNECTION_FAILED);
      }
      break;
    case PEER_CONNECTION_COMPLETED:
      if ((pc->agent_ret = agent_recv(&pc->agent, pc->agent_buf, CONFIG_MTU)) > 0) {
        LOGD("agent_recv %d", pc->agent_ret);

        if (dtls_srtp_probe(pc->agent_buf)) {
          int ret = dtls_srtp_read(pc->dtls_srtp, pc->temp_buf, CONFIG_MTU);
          LOGD("Got DTLS data %d", ret);

          if (ret > 0) {
            sctp_incoming_data(&pc->sctp, (char*)pc->temp_buf, ret);
          }

        } else {
          LOGW("Unknown data");
        }
      }

      if (CONFIG_KEEPALIVE_TIMEOUT > 0 && (ports_get_epoch_time() - pc->agent.binding_request_time) > CONFIG_KEEPALIVE_TIMEOUT) {
        LOGI("binding request timeout");
        STATE_CHANGED(pc, PEER_CONNECTION_CLOSED);
      }

      break;
    case PEER_CONNECTION_FAILED:
      break;
    case PEER_CONNECTION_DISCONNECTED:
      break;
    case PEER_CONNECTION_CLOSED:
      break;
    default:
      break;
  }

  return 0;
}

void peer_connection_set_remote_description(PeerConnection* pc, const char* sdp, SdpType type) {
  char* start = (char*)sdp;
  char* line = NULL;
  char buf[256];
  DtlsSrtpRole role = DTLS_SRTP_ROLE_SERVER;
  int is_update = 0;
  Agent* agent = &pc->agent;

  while ((line = strstr(start, "\r\n"))) {
    line = strstr(start, "\r\n");
    strncpy(buf, start, line - start);
    buf[line - start] = '\0';

    if (strstr(buf, "a=setup:passive")) {
      role = DTLS_SRTP_ROLE_CLIENT;
    }

    if (strncmp(buf, "a=fingerprint:", strlen("a=fingerprint:")) == 0) {
      char* fingerprint = strchr(buf, ' ');
      if (fingerprint) {
        fingerprint++;
        memset(pc->dtls_srtp->remote_fingerprint, 0, sizeof(pc->dtls_srtp->remote_fingerprint));
        strncpy(pc->dtls_srtp->remote_fingerprint, fingerprint, DTLS_SRTP_FINGERPRINT_LENGTH - 1);
        LOGI("remote fingerprint: %s", pc->dtls_srtp->remote_fingerprint);
      }
    }

    if (strstr(buf, "a=ice-ufrag") &&
        strlen(agent->remote_ufrag) != 0 &&
        (strncmp(buf + strlen("a=ice-ufrag:"), agent->remote_ufrag, strlen(agent->remote_ufrag)) == 0)) {
      is_update = 1;
    }

    start = line + 2;
  }

  if (is_update) {
    return;
  }

  if (type == SDP_TYPE_OFFER) {
    agent_clear_candidates(&pc->agent);
    memset(pc->agent.remote_ufrag, 0, sizeof(pc->agent.remote_ufrag));
    memset(pc->agent.remote_upwd, 0, sizeof(pc->agent.remote_upwd));
  }

  agent_set_remote_description(&pc->agent, (char*)sdp);
  if (type == SDP_TYPE_ANSWER) {
    agent_update_candidate_pairs(&pc->agent);
    STATE_CHANGED(pc, PEER_CONNECTION_CHECKING);
  }
}

static const char* peer_connection_create_sdp(PeerConnection* pc, SdpType sdp_type) {
  char* description = (char*)pc->temp_buf;
  char remote_fingerprint[DTLS_SRTP_FINGERPRINT_LENGTH];
  void (*sctp_onmessage)(char* msg, size_t len, void* userdata, uint16_t sid) = pc->sctp.onmessage;
  void (*sctp_onopen)(void* userdata) = pc->sctp.onopen;
  void (*sctp_onclose)(void* userdata) = pc->sctp.onclose;
  void* sctp_userdata = pc->sctp.userdata;

  memset(pc->temp_buf, 0, CONFIG_MTU);
  memset(remote_fingerprint, 0, sizeof(remote_fingerprint));
  strncpy(remote_fingerprint, pc->dtls_srtp->remote_fingerprint, sizeof(remote_fingerprint) - 1);

  DtlsSrtpRole role = DTLS_SRTP_ROLE_SERVER;

  sctp_destroy_association(&pc->sctp);
  memset(&pc->sctp, 0, sizeof(pc->sctp));
  pc->sctp.onmessage = sctp_onmessage;
  pc->sctp.onopen = sctp_onopen;
  pc->sctp.onclose = sctp_onclose;
  pc->sctp.userdata = sctp_userdata;

  switch (sdp_type) {
    case SDP_TYPE_OFFER:
      role = DTLS_SRTP_ROLE_SERVER;
      agent_clear_candidates(&pc->agent);
      pc->agent.mode = AGENT_MODE_CONTROLLING;
      break;
    case SDP_TYPE_ANSWER:
      role = DTLS_SRTP_ROLE_CLIENT;
      pc->agent.mode = AGENT_MODE_CONTROLLED;
      break;
    default:
      break;
  }

  int dtls_ready = 0;
  if (pc->b_local_description_created) {
    if (pc->dtls_srtp->role == role) {
      dtls_srtp_reset_session(pc->dtls_srtp);
      pc->dtls_srtp->state = DTLS_SRTP_STATE_INIT;
      pc->dtls_srtp->user_data = pc;
      dtls_ready = 1;
      LOGI("reusing DTLS context");
    } else {
      dtls_srtp_deinit(pc->dtls_srtp);
      memset(pc->dtls_srtp, 0, sizeof(DtlsSrtp));
    }
  }

  if (!dtls_ready) {
    int dtls_ret = dtls_srtp_init(pc->dtls_srtp, role, pc);
    if (dtls_ret < 0) {
      peer_connection_set_last_error("dtls_srtp_init failed ret=-0x%04x", (unsigned int)-dtls_ret);
      return NULL;
    }
  }
  strncpy(pc->dtls_srtp->remote_fingerprint, remote_fingerprint, DTLS_SRTP_FINGERPRINT_LENGTH - 1);
  pc->dtls_srtp->udp_recv = peer_connection_dtls_srtp_recv;
  pc->dtls_srtp->udp_send = peer_connection_dtls_srtp_send;

  memset(pc->sdp, 0, CONFIG_SDP_BUFFER_SIZE);
  sdp_create(pc->sdp, 0, 0, pc->config.datachannel);

  agent_create_ice_credential(&pc->agent);
  sdp_append(pc->sdp, "a=ice-ufrag:%s", pc->agent.local_ufrag);
  sdp_append(pc->sdp, "a=ice-pwd:%s", pc->agent.local_upwd);
  sdp_append(pc->sdp, "a=fingerprint:sha-256 %s", pc->dtls_srtp->local_fingerprint);
  sdp_append(pc->sdp, peer_connection_dtls_role_setup_value(role));

  if (pc->config.datachannel) {
    sdp_append_datachannel(pc->sdp);
  }

  pc->b_local_description_created = 1;

  agent_gather_candidate(&pc->agent, NULL, NULL, NULL);  // host address
  for (int i = 0; i < sizeof(pc->config.ice_servers) / sizeof(pc->config.ice_servers[0]); ++i) {
    if (pc->config.ice_servers[i].urls) {
      LOGI("ice server: %s", pc->config.ice_servers[i].urls);
      agent_gather_candidate(&pc->agent, pc->config.ice_servers[i].urls, pc->config.ice_servers[i].username, pc->config.ice_servers[i].credential);
    }
  }

  agent_get_local_description(&pc->agent, description, CONFIG_MTU);
  sdp_append(pc->sdp, description);

  if (pc->onicecandidate) {
    pc->onicecandidate(pc->sdp, pc->config.user_data);
  }

  return pc->sdp;
}

const char* peer_connection_create_offer(PeerConnection* pc) {
  return peer_connection_create_sdp(pc, SDP_TYPE_OFFER);
}

const char* peer_connection_create_answer(PeerConnection* pc) {
  const char* sdp = peer_connection_create_sdp(pc, SDP_TYPE_ANSWER);
  agent_update_candidate_pairs(&pc->agent);
  STATE_CHANGED(pc, PEER_CONNECTION_CHECKING);
  return sdp;
}

int peer_connection_send_rtcp_pil(PeerConnection* pc, uint32_t ssrc) {
  (void)pc;
  (void)ssrc;
  return -1;
}

// callbacks
void peer_connection_on_connected(PeerConnection* pc, void (*on_connected)(void* userdata)) {
  pc->on_connected = on_connected;
}

void peer_connection_onicecandidate(PeerConnection* pc, void (*onicecandidate)(char* sdp, void* userdata)) {
  pc->onicecandidate = onicecandidate;
}

void peer_connection_oniceconnectionstatechange(PeerConnection* pc,
                                                void (*oniceconnectionstatechange)(PeerConnectionState state, void* userdata)) {
  pc->oniceconnectionstatechange = oniceconnectionstatechange;
}

void peer_connection_ondatachannel(PeerConnection* pc,
                                   void (*onmessage)(char* msg, size_t len, void* userdata, uint16_t sid),
                                   void (*onopen)(void* userdata),
                                   void (*onclose)(void* userdata)) {
  if (pc) {
    sctp_onopen(&pc->sctp, onopen);
    sctp_onclose(&pc->sctp, onclose);
    sctp_onmessage(&pc->sctp, onmessage);
  }
}

int peer_connection_lookup_sid(PeerConnection* pc, const char* label, uint16_t* sid) {
  for (int i = 0; i < pc->sctp.stream_count; i++) {
    if (strncmp(pc->sctp.stream_table[i].label, label, sizeof(pc->sctp.stream_table[i].label)) == 0) {
      *sid = pc->sctp.stream_table[i].sid;
      return 0;
    }
  }
  return -1;  // Not found
}

char* peer_connection_lookup_sid_label(PeerConnection* pc, uint16_t sid) {
  for (int i = 0; i < pc->sctp.stream_count; i++) {
    if (pc->sctp.stream_table[i].sid == sid) {
      return pc->sctp.stream_table[i].label;
    }
  }
  return NULL;  // Not found
}

int peer_connection_add_ice_candidate(PeerConnection* pc, char* candidate) {
  Agent* agent = &pc->agent;
  int remote_index = agent->remote_candidates_count;

  if (remote_index >= AGENT_MAX_CANDIDATES) {
    LOGW("Ignore ICE candidate: remote candidate list is full");
    return -1;
  }

  if (ice_candidate_from_description(&agent->remote_candidates[remote_index], candidate, candidate + strlen(candidate)) != 0) {
    return -1;
  }

  LOGD("Add candidate: %s", candidate);
  agent->remote_candidates_count++;
  agent_update_candidate_pairs(agent);

  return 0;
}
