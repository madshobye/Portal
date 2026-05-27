#ifndef CONFIG_H_
#define CONFIG_H_

// Use ECDSA certs for WebRTC DTLS. The ESP32 answers browser offers as
// DTLS client/active, matching the older Printhost/libpeer path.
#define CONFIG_DTLS_USE_ECDSA 1

#define SCTP_MTU (800)
#define CONFIG_MTU (900)

#ifndef CONFIG_USE_LWIP
#define CONFIG_USE_LWIP 1
#endif

#ifndef CONFIG_MBEDTLS_DEBUG
#define CONFIG_MBEDTLS_DEBUG 0
#endif

#ifndef CONFIG_MBEDTLS_2_X
#define CONFIG_MBEDTLS_2_X 0
#endif

#if CONFIG_MBEDTLS_2_X
#define RSA_KEY_LENGTH 512
#else
#define RSA_KEY_LENGTH 1024
#endif

#ifndef CONFIG_DTLS_USE_ECDSA
#define CONFIG_DTLS_USE_ECDSA 0
#endif

#ifndef CONFIG_DTLS_USE_STATIC_CERT
#define CONFIG_DTLS_USE_STATIC_CERT 1
#endif

#ifndef CONFIG_DTLS_MAX_FRAGMENT_LENGTH
#define CONFIG_DTLS_MAX_FRAGMENT_LENGTH 0
#endif

#ifndef CONFIG_STATIC_PEER_CONNECTION
#define CONFIG_STATIC_PEER_CONNECTION 1
#endif

#ifndef CONFIG_USE_USRSCTP
#define CONFIG_USE_USRSCTP 0
#endif

#ifndef CONFIG_SDP_BUFFER_SIZE
#define CONFIG_SDP_BUFFER_SIZE 1536
#endif

#ifndef CONFIG_MQTT_BUFFER_SIZE
#define CONFIG_MQTT_BUFFER_SIZE 4096
#endif

#ifndef CONFIG_HTTP_BUFFER_SIZE
#define CONFIG_HTTP_BUFFER_SIZE 4096
#endif

#ifndef CONFIG_TLS_READ_TIMEOUT
#define CONFIG_TLS_READ_TIMEOUT 3000
#endif

#ifndef CONFIG_KEEPALIVE_TIMEOUT
#define CONFIG_KEEPALIVE_TIMEOUT 10000
#endif

#ifndef CONFIG_AUDIO_DURATION
#define CONFIG_AUDIO_DURATION 20
#endif

#ifndef CONFIG_MAX_NALU_SIZE
#define CONFIG_MAX_NALU_SIZE (10 * 1024)  // 10KB
#endif

#define CONFIG_IPV6 0
// empty will use first active interface
#define CONFIG_IFACE_PREFIX ""

// #define LOG_LEVEL LEVEL_DEBUG
#ifndef LOG_REDIRECT
#define LOG_REDIRECT 1
#endif

// Disable MQTT and HTTP signaling
// #define DISABLE_PEER_SIGNALING 1

#endif  // CONFIG_H_
