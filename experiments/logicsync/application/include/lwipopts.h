#define NO_SYS 1
#define SYS_LIGHTWEIGHT_PROT 0
#define LWIP_SOCKET 0
#define LWIP_NETCONN 0
#define LWIP_IPV4 1
#define LWIP_IPV6 0
#define LWIP_TCP 1
#define LWIP_UDP 1
#define LWIP_ICMP 1
#define LWIP_ARP 1
#define LWIP_DHCP 1
#define LWIP_DNS 1
#define LWIP_RAW 0
#define LWIP_STATS 0
#define LWIP_TCP_KEEPALIVE 1
#define MEM_ALIGNMENT 4
#define MEM_SIZE (16*1024)
#define MEMP_NUM_TCP_PCB 6
#define MEMP_NUM_TCP_PCB_LISTEN 2
#define MEMP_NUM_TCP_SEG 24
#define MEMP_NUM_UDP_PCB 4
#define PBUF_POOL_SIZE 8
#define PBUF_POOL_BUFSIZE 1536
#define TCP_MSS 1460
#define TCP_WND (4*TCP_MSS)
#define TCP_SND_BUF (4*TCP_MSS)
#define TCP_SND_QUEUELEN 16
#define LWIP_NETIF_LINK_CALLBACK 0
#define LWIP_NETIF_STATUS_CALLBACK 0
#define LWIP_NETIF_HOSTNAME 1
#define MQTT_OUTPUT_RINGBUF_SIZE 2048
#define MQTT_VAR_HEADER_BUFFER_LEN 256

#define MEMP_NUM_SYS_TIMEOUT 16

#define LWIP_DHCP_CHECK_LINK_UP 1
#define LWIP_DHCP_GET_NTP_SRV 0
#define DNS_TABLE_SIZE 2
#define DNS_MAX_SERVERS 2

/* Read-only network time, validated by lwIP source/port/origin checks. */
#define SNTP_SERVER_DNS 1
#define SNTP_MAX_SERVERS 2
#define SNTP_CHECK_RESPONSE 2
#define SNTP_UPDATE_DELAY 3600000
#define SNTP_STARTUP_DELAY 0
#include <stdint.h>
void clock_set_utc(uint32_t utc);
#define SNTP_SET_SYSTEM_TIME(sec) clock_set_utc(sec)
