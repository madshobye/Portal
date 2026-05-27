#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "address.h"
#include "config.h"
#include "dtls_srtp.h"
#if CONFIG_MBEDTLS_DEBUG
#include "mbedtls/debug.h"
#endif
#include "mbedtls/sha256.h"
#include "mbedtls/ssl.h"
#include "mbedtls/error.h"
#include "ports.h"
#include "socket.h"
#include "utils.h"

#if CONFIG_DTLS_USE_STATIC_CERT
static const unsigned char p1e_dtls_cert_der[] = {
  0x30, 0x82, 0x01, 0x19, 0x30, 0x81, 0xc0, 0x02, 0x09, 0x00, 0xb3, 0xc4,
  0x77, 0x0c, 0xf5, 0x2a, 0xfd, 0x28, 0x30, 0x0a, 0x06, 0x08, 0x2a, 0x86,
  0x48, 0xce, 0x3d, 0x04, 0x03, 0x02, 0x30, 0x15, 0x31, 0x13, 0x30, 0x11,
  0x06, 0x03, 0x55, 0x04, 0x03, 0x0c, 0x0a, 0x70, 0x31, 0x65, 0x2d, 0x77,
  0x65, 0x62, 0x72, 0x74, 0x63, 0x30, 0x1e, 0x17, 0x0d, 0x32, 0x36, 0x30,
  0x35, 0x32, 0x36, 0x32, 0x30, 0x33, 0x30, 0x31, 0x39, 0x5a, 0x17, 0x0d,
  0x33, 0x36, 0x30, 0x35, 0x32, 0x33, 0x32, 0x30, 0x33, 0x30, 0x31, 0x39,
  0x5a, 0x30, 0x15, 0x31, 0x13, 0x30, 0x11, 0x06, 0x03, 0x55, 0x04, 0x03,
  0x0c, 0x0a, 0x70, 0x31, 0x65, 0x2d, 0x77, 0x65, 0x62, 0x72, 0x74, 0x63,
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
  0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
  0x42, 0x00, 0x04, 0xb9, 0x25, 0x82, 0x6b, 0x29, 0x81, 0x7c, 0x2a, 0x80,
  0x16, 0xce, 0x32, 0xb2, 0x94, 0x12, 0x25, 0x3c, 0xb1, 0xe5, 0x53, 0x81,
  0x06, 0x05, 0x83, 0xef, 0xb8, 0x84, 0xa6, 0x60, 0x75, 0xf7, 0x05, 0x59,
  0xe7, 0x89, 0x1b, 0x50, 0x24, 0xf2, 0x4c, 0x24, 0x6a, 0xa5, 0x71, 0x3b,
  0xa6, 0x8e, 0xfa, 0x35, 0x3d, 0x03, 0x78, 0xce, 0x8c, 0x80, 0x84, 0xea,
  0xb3, 0xdd, 0x7a, 0x50, 0xb6, 0x95, 0x79, 0x30, 0x0a, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02, 0x03, 0x48, 0x00, 0x30, 0x45,
  0x02, 0x20, 0x69, 0xe8, 0x8a, 0x37, 0xf1, 0x79, 0x6f, 0xae, 0x33, 0xf4,
  0x7e, 0xf9, 0x6d, 0x64, 0x45, 0x40, 0x6c, 0xc5, 0x3e, 0x88, 0x23, 0xcc,
  0x86, 0x72, 0x7d, 0xcc, 0x49, 0x21, 0x00, 0xa2, 0xe1, 0xa7, 0x02, 0x21,
  0x00, 0x90, 0x10, 0x4c, 0xea, 0xe0, 0x64, 0xc1, 0x82, 0x28, 0xf4, 0xcc,
  0x29, 0x96, 0xaf, 0xeb, 0xd1, 0xa2, 0x41, 0x31, 0x83, 0xae, 0x7b, 0x81,
  0xba, 0xcb, 0xdf, 0xa5, 0x5d, 0xa0, 0xb4, 0xa0, 0x77
};

static const unsigned char p1e_dtls_key_der[] = {
  0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20, 0x36, 0xcb, 0xb3, 0x77, 0xaf,
  0x29, 0x00, 0xa1, 0x5a, 0x0c, 0x23, 0xf0, 0xfc, 0xe3, 0x9d, 0x54, 0xf4,
  0xc2, 0x9e, 0x81, 0x6e, 0x0b, 0xee, 0x5e, 0x79, 0x1d, 0x8a, 0x62, 0x88,
  0x40, 0x2c, 0x4e, 0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
  0x03, 0x01, 0x07, 0xa1, 0x44, 0x03, 0x42, 0x00, 0x04, 0xb9, 0x25, 0x82,
  0x6b, 0x29, 0x81, 0x7c, 0x2a, 0x80, 0x16, 0xce, 0x32, 0xb2, 0x94, 0x12,
  0x25, 0x3c, 0xb1, 0xe5, 0x53, 0x81, 0x06, 0x05, 0x83, 0xef, 0xb8, 0x84,
  0xa6, 0x60, 0x75, 0xf7, 0x05, 0x59, 0xe7, 0x89, 0x1b, 0x50, 0x24, 0xf2,
  0x4c, 0x24, 0x6a, 0xa5, 0x71, 0x3b, 0xa6, 0x8e, 0xfa, 0x35, 0x3d, 0x03,
  0x78, 0xce, 0x8c, 0x80, 0x84, 0xea, 0xb3, 0xdd, 0x7a, 0x50, 0xb6, 0x95,
  0x79
};
#endif

static void dtls_srtp_log_mbedtls_error(const char* label, int ret) {
  char errbuf[128];
  mbedtls_strerror(ret, errbuf, sizeof(errbuf));
  LOGE("%s returned -0x%.4x (%s)", label, (unsigned int)-ret, errbuf);
}

int dtls_srtp_udp_send(void* ctx, const uint8_t* buf, size_t len) {
  DtlsSrtp* dtls_srtp = (DtlsSrtp*)ctx;
  UdpSocket* udp_socket = (UdpSocket*)dtls_srtp->user_data;

  int ret = udp_socket_sendto(udp_socket, dtls_srtp->remote_addr, buf, len);

  LOGD("dtls_srtp_udp_send (%d)", ret);

  return ret;
}

int dtls_srtp_udp_recv(void* ctx, uint8_t* buf, size_t len) {
  DtlsSrtp* dtls_srtp = (DtlsSrtp*)ctx;
  UdpSocket* udp_socket = (UdpSocket*)dtls_srtp->user_data;

  int ret;

  while ((ret = udp_socket_recvfrom(udp_socket, &udp_socket->bind_addr, buf, len)) <= 0) {
    ports_sleep_ms(1);
  }

  LOGD("dtls_srtp_udp_recv (%d)", ret);

  return ret;
}

static void dtls_srtp_x509_digest(const mbedtls_x509_crt* crt, char* buf) {
  int i;
  unsigned char digest[32];

  mbedtls_sha256_context sha256_ctx;
  mbedtls_sha256_init(&sha256_ctx);
  mbedtls_sha256_starts(&sha256_ctx, 0);
  mbedtls_sha256_update(&sha256_ctx, crt->raw.p, crt->raw.len);
  mbedtls_sha256_finish(&sha256_ctx, (unsigned char*)digest);
  mbedtls_sha256_free(&sha256_ctx);

  for (i = 0; i < 32; i++) {
    snprintf(buf, 4, "%.2X:", digest[i]);
    buf += 3;
  }

  *(--buf) = '\0';
}

// Do not verify CA
static int dtls_srtp_cert_verify(void* data, mbedtls_x509_crt* crt, int depth, uint32_t* flags) {
  *flags &= ~(MBEDTLS_X509_BADCERT_NOT_TRUSTED | MBEDTLS_X509_BADCERT_CN_MISMATCH | MBEDTLS_X509_BADCERT_BAD_KEY);
  return 0;
}

static int dtls_srtp_seed_rng(DtlsSrtp* dtls_srtp) {
  const char* pers = "dtls_srtp";
  int ret = mbedtls_ctr_drbg_seed(&dtls_srtp->ctr_drbg,
                                  mbedtls_entropy_func,
                                  &dtls_srtp->entropy,
                                  (const unsigned char*)pers,
                                  strlen(pers));
  if (ret < 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_ctr_drbg_seed", ret);
  }
  return ret;
}

#if CONFIG_DTLS_USE_STATIC_CERT
static int dtls_srtp_static_cert(DtlsSrtp* dtls_srtp) {
  int ret = dtls_srtp_seed_rng(dtls_srtp);
  if (ret < 0) {
    return ret;
  }

  ret = mbedtls_x509_crt_parse_der(&dtls_srtp->cert, p1e_dtls_cert_der, sizeof(p1e_dtls_cert_der));
  if (ret < 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_x509_crt_parse_der static cert", ret);
    return ret;
  }

#if CONFIG_MBEDTLS_2_X
  ret = mbedtls_pk_parse_key(&dtls_srtp->pkey, p1e_dtls_key_der, sizeof(p1e_dtls_key_der), NULL, 0);
#else
  ret = mbedtls_pk_parse_key(&dtls_srtp->pkey,
                             p1e_dtls_key_der,
                             sizeof(p1e_dtls_key_der),
                             NULL,
                             0,
                             mbedtls_ctr_drbg_random,
                             &dtls_srtp->ctr_drbg);
#endif
  if (ret < 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_pk_parse_key static key", ret);
    return ret;
  }

  LOGI("loaded static DTLS certificate");
  return 0;
}
#endif

static int dtls_srtp_selfsign_cert(DtlsSrtp* dtls_srtp) {
  int ret;
  mbedtls_x509write_cert crt;
  unsigned char* cert_buf = NULL;
  unsigned char serial[16];
  const size_t cert_buf_len = 2048;

  mbedtls_x509write_crt_init(&crt);

  ret = dtls_srtp_seed_rng(dtls_srtp);
  if (ret < 0) {
    goto cleanup;
  }

  cert_buf = (unsigned char*)calloc(1, cert_buf_len);
  if (cert_buf == NULL) {
    LOGE("malloc failed");
    ret = -1;
    goto cleanup;
  }

#if CONFIG_DTLS_USE_ECDSA
  ret = mbedtls_pk_setup(&dtls_srtp->pkey, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
  if (ret < 0) {
    LOGE("mbedtls_pk_setup ECDSA failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }
  ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(dtls_srtp->pkey), mbedtls_ctr_drbg_random, &dtls_srtp->ctr_drbg);
  if (ret < 0) {
    LOGE("mbedtls_ecp_gen_key failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }
#else
  ret = mbedtls_pk_setup(&dtls_srtp->pkey, mbedtls_pk_info_from_type(MBEDTLS_PK_RSA));
  if (ret < 0) {
    LOGE("mbedtls_pk_setup RSA failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }
  ret = mbedtls_rsa_gen_key(mbedtls_pk_rsa(dtls_srtp->pkey), mbedtls_ctr_drbg_random, &dtls_srtp->ctr_drbg, RSA_KEY_LENGTH, 65537);
  if (ret < 0) {
    LOGE("mbedtls_rsa_gen_key failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }
#endif

  mbedtls_x509write_crt_set_subject_key(&crt, &dtls_srtp->pkey);
  mbedtls_x509write_crt_set_version(&crt, MBEDTLS_X509_CRT_VERSION_3);
  mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
  mbedtls_x509write_crt_set_issuer_key(&crt, &dtls_srtp->pkey);

  ret = mbedtls_x509write_crt_set_subject_name(&crt, "CN=libpeer");
  if (ret < 0) {
    LOGE("mbedtls_x509write_crt_set_subject_name failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  ret = mbedtls_x509write_crt_set_issuer_name(&crt, "CN=libpeer");
  if (ret < 0) {
    LOGE("mbedtls_x509write_crt_set_issuer_name failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  ret = mbedtls_ctr_drbg_random(&dtls_srtp->ctr_drbg, serial, sizeof(serial));
  if (ret < 0) {
    LOGE("mbedtls_ctr_drbg_random serial failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  ret = mbedtls_x509write_crt_set_serial_raw(&crt, serial, sizeof(serial));
  if (ret < 0) {
    LOGE("mbedtls_x509write_crt_set_serial_raw failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  ret = mbedtls_x509write_crt_set_validity(&crt, "20240101000000", "20340101000000");
  if (ret < 0) {
    LOGE("mbedtls_x509write_crt_set_validity failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  ret = mbedtls_x509write_crt_der(&crt, cert_buf, cert_buf_len, mbedtls_ctr_drbg_random, &dtls_srtp->ctr_drbg);

  if (ret < 0) {
    LOGE("mbedtls_x509write_crt_der failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  ret = mbedtls_x509_crt_parse_der(&dtls_srtp->cert, cert_buf + cert_buf_len - ret, ret);
  if (ret < 0) {
    LOGE("mbedtls_x509_crt_parse_der failed -0x%.4x", (unsigned int)-ret);
    goto cleanup;
  }

  LOGI("generated ephemeral DTLS certificate");

cleanup:
  mbedtls_x509write_crt_free(&crt);
  free(cert_buf);

  return ret;
}

#if CONFIG_MBEDTLS_DEBUG
static void dtls_srtp_debug(void* ctx, int level, const char* file, int line, const char* str) {
  LOGD("%s:%04d: %s", file, line, str);
}
#endif

int dtls_srtp_init(DtlsSrtp* dtls_srtp, DtlsSrtpRole role, void* user_data) {
  static const mbedtls_ssl_srtp_profile default_profiles[] = {
      MBEDTLS_TLS_SRTP_AES128_CM_HMAC_SHA1_80,
      MBEDTLS_TLS_SRTP_AES128_CM_HMAC_SHA1_32,
      MBEDTLS_TLS_SRTP_NULL_HMAC_SHA1_80,
      MBEDTLS_TLS_SRTP_NULL_HMAC_SHA1_32,
      MBEDTLS_TLS_SRTP_UNSET};

  dtls_srtp->role = role;
  dtls_srtp->state = DTLS_SRTP_STATE_INIT;
  dtls_srtp->user_data = user_data;
  dtls_srtp->udp_send = dtls_srtp_udp_send;
  dtls_srtp->udp_recv = dtls_srtp_udp_recv;

  mbedtls_ssl_config_init(&dtls_srtp->conf);
  mbedtls_ssl_init(&dtls_srtp->ssl);

  mbedtls_x509_crt_init(&dtls_srtp->cert);
  mbedtls_pk_init(&dtls_srtp->pkey);
  mbedtls_entropy_init(&dtls_srtp->entropy);
  mbedtls_ctr_drbg_init(&dtls_srtp->ctr_drbg);
#if CONFIG_MBEDTLS_DEBUG
  mbedtls_debug_set_threshold(3);
  mbedtls_ssl_conf_dbg(&dtls_srtp->conf, dtls_srtp_debug, NULL);
#endif
#if CONFIG_DTLS_USE_STATIC_CERT
  int ret = dtls_srtp_static_cert(dtls_srtp);
#else
  int ret = dtls_srtp_selfsign_cert(dtls_srtp);
#endif
  if (ret < 0) {
    return ret;
  }

  if (dtls_srtp->role == DTLS_SRTP_ROLE_SERVER) {
    LOGI("dtls role server/passive");
    ret = mbedtls_ssl_config_defaults(&dtls_srtp->conf,
                                      MBEDTLS_SSL_IS_SERVER,
                                      MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                      MBEDTLS_SSL_PRESET_DEFAULT);
    if (ret < 0) {
      dtls_srtp_log_mbedtls_error("mbedtls_ssl_config_defaults server", ret);
      return ret;
    }

    mbedtls_ssl_cookie_init(&dtls_srtp->cookie_ctx);

    ret = mbedtls_ssl_cookie_setup(&dtls_srtp->cookie_ctx, mbedtls_ctr_drbg_random, &dtls_srtp->ctr_drbg);
    if (ret < 0) {
      dtls_srtp_log_mbedtls_error("mbedtls_ssl_cookie_setup", ret);
      return ret;
    }

    mbedtls_ssl_conf_dtls_cookies(&dtls_srtp->conf, mbedtls_ssl_cookie_write, mbedtls_ssl_cookie_check, &dtls_srtp->cookie_ctx);

  } else {
    LOGI("dtls role client/active");
    ret = mbedtls_ssl_config_defaults(&dtls_srtp->conf,
                                      MBEDTLS_SSL_IS_CLIENT,
                                      MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                      MBEDTLS_SSL_PRESET_DEFAULT);
    if (ret < 0) {
      dtls_srtp_log_mbedtls_error("mbedtls_ssl_config_defaults client", ret);
      return ret;
    }
  }

  mbedtls_ssl_conf_rng(&dtls_srtp->conf, mbedtls_ctr_drbg_random, &dtls_srtp->ctr_drbg);

  mbedtls_ssl_conf_verify(&dtls_srtp->conf, dtls_srtp_cert_verify, NULL);

  // WebRTC authenticates the device certificate with the SDP fingerprint. On
  // ESP32 Classic, requesting a browser client certificate can trip an
  // unavailable mbedTLS DTLS feature in the server CertificateRequest path.
  mbedtls_ssl_conf_authmode(&dtls_srtp->conf, MBEDTLS_SSL_VERIFY_NONE);

  mbedtls_ssl_conf_ca_chain(&dtls_srtp->conf, &dtls_srtp->cert, NULL);

  ret = mbedtls_ssl_conf_own_cert(&dtls_srtp->conf, &dtls_srtp->cert, &dtls_srtp->pkey);
  if (ret < 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_ssl_conf_own_cert", ret);
    return ret;
  }

  mbedtls_ssl_conf_read_timeout(&dtls_srtp->conf, 1000);

  dtls_srtp_x509_digest(&dtls_srtp->cert, dtls_srtp->local_fingerprint);

  LOGD("local fingerprint: %s", dtls_srtp->local_fingerprint);

#if CONFIG_DTLS_MAX_FRAGMENT_LENGTH && defined(MBEDTLS_SSL_MAX_FRAGMENT_LENGTH)
  ret = mbedtls_ssl_conf_max_frag_len(&dtls_srtp->conf, MBEDTLS_SSL_MAX_FRAG_LEN_1024);
  if (ret < 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_ssl_conf_max_frag_len", ret);
    return ret;
  }
  LOGI("configured DTLS max fragment length 1024");
#endif

  mbedtls_ssl_conf_dtls_srtp_protection_profiles(&dtls_srtp->conf, default_profiles);

  mbedtls_ssl_conf_srtp_mki_value_supported(&dtls_srtp->conf, MBEDTLS_SSL_DTLS_SRTP_MKI_UNSUPPORTED);

  mbedtls_ssl_conf_cert_req_ca_list(&dtls_srtp->conf, MBEDTLS_SSL_CERT_REQ_CA_LIST_DISABLED);

  ret = mbedtls_ssl_setup(&dtls_srtp->ssl, &dtls_srtp->conf);
  if (ret < 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_ssl_setup", ret);
    return ret;
  }

  return 0;
}

void dtls_srtp_deinit(DtlsSrtp* dtls_srtp) {
  mbedtls_ssl_free(&dtls_srtp->ssl);
  mbedtls_ssl_config_free(&dtls_srtp->conf);

  mbedtls_x509_crt_free(&dtls_srtp->cert);
  mbedtls_pk_free(&dtls_srtp->pkey);
  mbedtls_entropy_free(&dtls_srtp->entropy);
  mbedtls_ctr_drbg_free(&dtls_srtp->ctr_drbg);

  if (dtls_srtp->role == DTLS_SRTP_ROLE_SERVER) {
    mbedtls_ssl_cookie_free(&dtls_srtp->cookie_ctx);
  }

  if (dtls_srtp->state == DTLS_SRTP_STATE_CONNECTED) {
    srtp_dealloc(dtls_srtp->srtp_in);
    srtp_dealloc(dtls_srtp->srtp_out);
  }
}

static int dtls_srtp_key_derivation(DtlsSrtp* dtls_srtp, const unsigned char* master_secret, size_t secret_len, const unsigned char* randbytes, size_t randbytes_len, mbedtls_tls_prf_types tls_prf_type) {
  int ret;
  const char* dtls_srtp_label = "EXTRACTOR-dtls_srtp";
  uint8_t key_material[DTLS_SRTP_KEY_MATERIAL_LENGTH];
  // Export keying material
  if ((ret = mbedtls_ssl_tls_prf(tls_prf_type, master_secret, secret_len, dtls_srtp_label,
                                 randbytes, randbytes_len, key_material, sizeof(key_material))) != 0) {
    LOGE("mbedtls_ssl_tls_prf failed(%d)", ret);
    return ret;
  }

#if 0
  int i, j;
  printf("    DTLS-SRTP key material is:");
  for (j = 0; j < sizeof(key_material); j++) {
    if (j % 8 == 0) {
      printf("\n    ");
    }
    printf("%02x ", key_material[j]);
  }
  printf("\n");

  /* produce a less readable output used to perform automatic checks
   * - compare client and server output
   * - interop test with openssl which client produces this kind of output
   */
  printf("    Keying material: ");
  for (j = 0; j < sizeof(key_material); j++) {
    printf("%02X", key_material[j]);
  }
  printf("\n");
#endif

  const uint8_t* client_key = key_material;
  const uint8_t* server_key = client_key + SRTP_MASTER_KEY_LENGTH;
  const uint8_t* client_salt = server_key + SRTP_MASTER_KEY_LENGTH;
  const uint8_t* server_salt = client_salt + SRTP_MASTER_SALT_LENGTH;
  uint8_t *local_key, *remote_key, *local_salt, *remote_salt;
  if (dtls_srtp->role == DTLS_SRTP_ROLE_SERVER) {
    local_key = server_key;
    local_salt = server_salt;
    remote_key = client_key;
    remote_salt = client_salt;
  } else {
    local_key = client_key;
    local_salt = client_salt;
    remote_key = server_key;
    remote_salt = server_salt;
  }
  // derive inbounds keys

  memset(&dtls_srtp->remote_policy, 0, sizeof(dtls_srtp->remote_policy));

  srtp_crypto_policy_set_rtp_default(&dtls_srtp->remote_policy.rtp);
  srtp_crypto_policy_set_rtcp_default(&dtls_srtp->remote_policy.rtcp);

  memcpy(dtls_srtp->remote_policy_key, remote_key, SRTP_MASTER_KEY_LENGTH);
  memcpy(dtls_srtp->remote_policy_key + SRTP_MASTER_KEY_LENGTH, remote_salt, SRTP_MASTER_SALT_LENGTH);

  dtls_srtp->remote_policy.ssrc.type = ssrc_any_inbound;
  dtls_srtp->remote_policy.key = dtls_srtp->remote_policy_key;
  dtls_srtp->remote_policy.next = NULL;

  if (srtp_create(&dtls_srtp->srtp_in, &dtls_srtp->remote_policy) != srtp_err_status_ok) {
    LOGD("Error creating inbound SRTP session for component");
    return -1;
  }

  LOGI("Created inbound SRTP session");

  // derive outbounds keys
  memset(&dtls_srtp->local_policy, 0, sizeof(dtls_srtp->local_policy));

  srtp_crypto_policy_set_rtp_default(&dtls_srtp->local_policy.rtp);
  srtp_crypto_policy_set_rtcp_default(&dtls_srtp->local_policy.rtcp);

  memcpy(dtls_srtp->local_policy_key, local_key, SRTP_MASTER_KEY_LENGTH);
  memcpy(dtls_srtp->local_policy_key + SRTP_MASTER_KEY_LENGTH, local_salt, SRTP_MASTER_SALT_LENGTH);

  dtls_srtp->local_policy.ssrc.type = ssrc_any_outbound;
  dtls_srtp->local_policy.key = dtls_srtp->local_policy_key;
  dtls_srtp->local_policy.next = NULL;

  if (srtp_create(&dtls_srtp->srtp_out, &dtls_srtp->local_policy) != srtp_err_status_ok) {
    LOGE("Error creating outbound SRTP session");
    return -1;
  }

  LOGI("Created outbound SRTP session");
  dtls_srtp->state = DTLS_SRTP_STATE_CONNECTED;
  return 0;
}

#if CONFIG_MBEDTLS_2_X
static int dtls_srtp_key_derivation_cb(void* context,
                                       const unsigned char* ms,
                                       const unsigned char* kb,
                                       size_t maclen,
                                       size_t keylen,
                                       size_t ivlen,
                                       const unsigned char client_random[32],
                                       const unsigned char server_random[32],
                                       mbedtls_tls_prf_types tls_prf_type) {
#else
static void dtls_srtp_key_derivation_cb(void* context,
                                        mbedtls_ssl_key_export_type secret_type,
                                        const unsigned char* secret,
                                        size_t secret_len,
                                        const unsigned char client_random[32],
                                        const unsigned char server_random[32],
                                        mbedtls_tls_prf_types tls_prf_type) {
#endif
  DtlsSrtp* dtls_srtp = (DtlsSrtp*)context;

  unsigned char master_secret[48];
  unsigned char randbytes[64];

  memcpy(randbytes, client_random, 32);
  memcpy(randbytes + 32, server_random, 32);

#if CONFIG_MBEDTLS_2_X
  memcpy(master_secret, ms, sizeof(master_secret));
  return dtls_srtp_key_derivation(dtls_srtp, master_secret, sizeof(master_secret), randbytes, sizeof(randbytes), tls_prf_type);
#else
  memcpy(master_secret, secret, sizeof(master_secret));
  dtls_srtp_key_derivation(dtls_srtp, master_secret, sizeof(master_secret), randbytes, sizeof(randbytes), tls_prf_type);
#endif
}

static int dtls_srtp_do_handshake(DtlsSrtp* dtls_srtp) {
  int ret;

  static mbedtls_timing_delay_context timer;

  mbedtls_ssl_set_timer_cb(&dtls_srtp->ssl, &timer, mbedtls_timing_set_delay, mbedtls_timing_get_delay);

#if CONFIG_MBEDTLS_2_X
  mbedtls_ssl_conf_export_keys_ext_cb(&dtls_srtp->conf, dtls_srtp_key_derivation_cb, dtls_srtp);
#else
  mbedtls_ssl_set_export_keys_cb(&dtls_srtp->ssl, dtls_srtp_key_derivation_cb, dtls_srtp);
#endif

  mbedtls_ssl_set_bio(&dtls_srtp->ssl, dtls_srtp, dtls_srtp->udp_send, dtls_srtp->udp_recv, NULL);

  do {
    ret = mbedtls_ssl_handshake(&dtls_srtp->ssl);

  } while (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE);

  return ret;
}

static int dtls_srtp_handshake_server(DtlsSrtp* dtls_srtp) {
  int ret;

  while (1) {
    unsigned char client_ip[] = "test";

    mbedtls_ssl_session_reset(&dtls_srtp->ssl);

    mbedtls_ssl_set_client_transport_id(&dtls_srtp->ssl, client_ip, sizeof(client_ip));

    ret = dtls_srtp_do_handshake(dtls_srtp);

    if (ret == MBEDTLS_ERR_SSL_HELLO_VERIFY_REQUIRED) {
      LOGD("DTLS hello verification requested");

    } else if (ret != 0) {
      dtls_srtp_log_mbedtls_error("mbedtls_ssl_handshake", ret);

      break;

    } else {
      break;
    }
  }

  LOGD("DTLS server handshake done");

  return ret;
}

static int dtls_srtp_handshake_client(DtlsSrtp* dtls_srtp) {
  int ret;

  ret = dtls_srtp_do_handshake(dtls_srtp);
  if (ret != 0) {
    dtls_srtp_log_mbedtls_error("mbedtls_ssl_handshake", ret);
  }

  LOGD("DTLS client handshake done");

  return ret;
}

int dtls_srtp_handshake(DtlsSrtp* dtls_srtp, Address* addr) {
  int ret;
  dtls_srtp->remote_addr = addr;

  if (dtls_srtp->role == DTLS_SRTP_ROLE_SERVER) {
    ret = dtls_srtp_handshake_server(dtls_srtp);
  } else {
    ret = dtls_srtp_handshake_client(dtls_srtp);
  }

  if (ret != 0) {
    return ret;
  }

  if (dtls_srtp->remote_fingerprint[0] == '\0') {
    LOGE("missing expected remote SDP fingerprint");
    return -1;
  }

  const mbedtls_x509_crt* remote_crt;
  if ((remote_crt = mbedtls_ssl_get_peer_cert(&dtls_srtp->ssl)) != NULL) {
    dtls_srtp_x509_digest(remote_crt, dtls_srtp->actual_remote_fingerprint);

    if (strncmp(dtls_srtp->remote_fingerprint, dtls_srtp->actual_remote_fingerprint, DTLS_SRTP_FINGERPRINT_LENGTH) != 0) {
      LOGE("Actual and Expected Fingerprint mismatch: %s %s",
           dtls_srtp->remote_fingerprint,
           dtls_srtp->actual_remote_fingerprint);
      return -1;
    }

  } else {
    LOGE("DTLS handshake completed without peer certificate");
    return -1;
  }

  mbedtls_dtls_srtp_info dtls_srtp_negotiation_result;
  mbedtls_ssl_get_dtls_srtp_negotiation_result(&dtls_srtp->ssl, &dtls_srtp_negotiation_result);

  return ret;
}

void dtls_srtp_reset_session(DtlsSrtp* dtls_srtp) {
  if (dtls_srtp->state == DTLS_SRTP_STATE_CONNECTED) {
    srtp_dealloc(dtls_srtp->srtp_in);
    srtp_dealloc(dtls_srtp->srtp_out);
    mbedtls_ssl_session_reset(&dtls_srtp->ssl);
  }

  dtls_srtp->state = DTLS_SRTP_STATE_INIT;
}

int dtls_srtp_write(DtlsSrtp* dtls_srtp, const unsigned char* buf, size_t len) {
  int ret;

  do {
    ret = mbedtls_ssl_write(&dtls_srtp->ssl, buf, len);

  } while (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE);
  return ret;
}

int dtls_srtp_read(DtlsSrtp* dtls_srtp, unsigned char* buf, size_t len) {
  int ret;

  memset(buf, 0, len);

  do {
    ret = mbedtls_ssl_read(&dtls_srtp->ssl, buf, len);

  } while (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE);

  return ret;
}

int dtls_srtp_probe(uint8_t* buf) {
  if (buf == NULL)
    return 0;

  LOGD("DTLS content type: %d", buf[0]);
  // only handle application data
  return (buf[0] == 0x17);
}

void dtls_srtp_decrypt_rtp_packet(DtlsSrtp* dtls_srtp, uint8_t* packet, int* bytes) {
  srtp_unprotect(dtls_srtp->srtp_in, packet, bytes);
}

void dtls_srtp_decrypt_rtcp_packet(DtlsSrtp* dtls_srtp, uint8_t* packet, int* bytes) {
  srtp_unprotect_rtcp(dtls_srtp->srtp_in, packet, bytes);
}

void dtls_srtp_encrypt_rtp_packet(DtlsSrtp* dtls_srtp, uint8_t* packet, int* bytes) {
  srtp_protect(dtls_srtp->srtp_out, packet, bytes);
}

void dtls_srtp_encrypt_rctp_packet(DtlsSrtp* dtls_srtp, uint8_t* packet, int* bytes) {
  srtp_protect_rtcp(dtls_srtp->srtp_out, packet, bytes);
}
