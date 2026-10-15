#include "gd32f30x.h"
#include "app.h"
#include "runtime.h"
#include "lwip/dhcp.h"
#include "lwip/dns.h"
#include "lwip/init.h"
#include "lwip/netif.h"
#include "lwip/timeouts.h"
#include "lwip/etharp.h"
#include "netif/ethernet.h"
#include "string.h"
static volatile uint32_t milliseconds;
uint32_t ethernet_rx,ethernet_tx;
static struct netif interface;
static uint8_t frame[1536];
uint32_t sys_now(void){return milliseconds;}
void SysTick_Handler(void){++milliseconds;dmx_tick();}
static void delay_ms(uint32_t n){uint32_t start=sys_now();while((uint32_t)(sys_now()-start)<n){}}
void board_init(void){
 SystemCoreClockUpdate();
 rcu_periph_clock_enable(RCU_AF);rcu_periph_clock_enable(RCU_GPIOA);rcu_periph_clock_enable(RCU_GPIOB);rcu_periph_clock_enable(RCU_GPIOC);rcu_periph_clock_enable(RCU_GPIOD);
 gpio_pin_remap_config(GPIO_SWJ_SWDPENABLE_REMAP,ENABLE);
 gpio_init(GPIOC,GPIO_MODE_OUT_PP,GPIO_OSPEED_50MHZ,GPIO_PIN_0|GPIO_PIN_2);
 gpio_bit_set(GPIOC,GPIO_PIN_0|GPIO_PIN_2);
 gpio_init(GPIOC,GPIO_MODE_IPU,GPIO_OSPEED_50MHZ,GPIO_PIN_3);
 SysTick_Config(SystemCoreClock/1000);
}
static err_t transmit(struct netif*n,struct pbuf*p){
 (void)n;if(p->tot_len>sizeof frame)return ERR_IF;
 pbuf_copy_partial(p,frame,p->tot_len,0);
 if(enet_frame_transmit(frame,p->tot_len)!=SUCCESS)return ERR_MEM;
 ++ethernet_tx;return ERR_OK;
}
static err_t init_interface(struct netif*n){
 n->name[0]='l';n->name[1]='s';n->hostname="logicsync-custom";
 n->hwaddr_len=6;n->hwaddr[0]=0x02;n->hwaddr[1]=0x4c;n->hwaddr[2]=0x53;
 uint32_t uid=*(const uint32_t*)0x1ffff7e8;n->hwaddr[3]=uid>>16;n->hwaddr[4]=uid>>8;n->hwaddr[5]=uid;
 n->mtu=1500;n->flags=NETIF_FLAG_BROADCAST|NETIF_FLAG_ETHARP;
 n->output=etharp_output;n->linkoutput=transmit;return ERR_OK;
}
void network_init(void){
 gpio_ethernet_phy_select(GPIO_ENET_PHY_RMII);
 gpio_init(GPIOA,GPIO_MODE_IN_FLOATING,GPIO_OSPEED_50MHZ,GPIO_PIN_1|GPIO_PIN_7);
 gpio_init(GPIOA,GPIO_MODE_AF_PP,GPIO_OSPEED_50MHZ,GPIO_PIN_2);
 gpio_init(GPIOC,GPIO_MODE_AF_PP,GPIO_OSPEED_50MHZ,GPIO_PIN_1);
 gpio_init(GPIOC,GPIO_MODE_IN_FLOATING,GPIO_OSPEED_50MHZ,GPIO_PIN_4|GPIO_PIN_5);
 gpio_init(GPIOB,GPIO_MODE_AF_PP,GPIO_OSPEED_50MHZ,GPIO_PIN_11|GPIO_PIN_12|GPIO_PIN_13);
 gpio_init(GPIOA,GPIO_MODE_OUT_PP,GPIO_OSPEED_50MHZ,GPIO_PIN_3);
 rcu_periph_clock_enable(RCU_ENET);rcu_periph_clock_enable(RCU_ENETTX);rcu_periph_clock_enable(RCU_ENETRX);
 gpio_bit_reset(GPIOA,GPIO_PIN_3);delay_ms(5);gpio_bit_set(GPIOA,GPIO_PIN_3);delay_ms(20);
 enet_deinit();enet_software_reset();ENET_MAC_PHY_CTL=ENET_MDC_HCLK_DIV62;
 lwip_init();ip4_addr_t ip,mask,gw;
 IP4_ADDR(&ip,runtime_network.ip[0],runtime_network.ip[1],runtime_network.ip[2],runtime_network.ip[3]);
 IP4_ADDR(&mask,runtime_network.mask[0],runtime_network.mask[1],runtime_network.mask[2],runtime_network.mask[3]);
 IP4_ADDR(&gw,runtime_network.gateway[0],runtime_network.gateway[1],runtime_network.gateway[2],runtime_network.gateway[3]);
 if(runtime_network.dhcp){ip.addr=mask.addr=gw.addr=0;}
 netif_add(&interface,&ip,&mask,&gw,0,init_interface,ethernet_input);netif_set_default(&interface);netif_set_up(&interface);
 if(runtime_network.dhcp)dhcp_start(&interface);
 else{ip_addr_t dns;IP_ADDR4(&dns,1,1,1,1);dns_setserver(0,&dns);}

}
void network_poll(void){
 static uint32_t last_link,dhcp_since;static int ready,fallback;
 sys_check_timeouts();
 if(runtime_network.dhcp&&ready){
  if(dhcp_supplied_address(&interface)){fallback=0;dhcp_since=sys_now();}
  else if(!fallback&&(uint32_t)(sys_now()-dhcp_since)>45000){
   dhcp_stop(&interface);ip4_addr_t ip,mask,gw;
   IP4_ADDR(&ip,runtime_network.ip[0],runtime_network.ip[1],runtime_network.ip[2],runtime_network.ip[3]);
   IP4_ADDR(&mask,runtime_network.mask[0],runtime_network.mask[1],runtime_network.mask[2],runtime_network.mask[3]);
   IP4_ADDR(&gw,runtime_network.gateway[0],runtime_network.gateway[1],runtime_network.gateway[2],runtime_network.gateway[3]);
   netif_set_addr(&interface,&ip,&mask,&gw);fallback=1;dhcp_since=sys_now();runtime_event("No DHCP lease; maintenance address active");
  }else if(fallback&&(uint32_t)(sys_now()-dhcp_since)>120000){fallback=0;dhcp_since=sys_now();dhcp_start(&interface);runtime_event("Retrying DHCP");}
 }
 if(!ready){
  if((uint32_t)(sys_now()-last_link)<1000)return;
  last_link=sys_now();
  uint16_t phy_status=0;enet_phy_write_read(ENET_PHY_READ,1,1,&phy_status);enet_phy_write_read(ENET_PHY_READ,1,1,&phy_status);if(!(phy_status&4))return;
  if(enet_init(ENET_AUTO_NEGOTIATION,ENET_NO_AUTOCHECKSUM,ENET_BROADCAST_FRAMES_PASS)!=SUCCESS)return;
  enet_mac_address_set(ENET_MAC_ADDRESS0,interface.hwaddr);
  enet_descriptors_chain_init(ENET_DMA_RX);enet_descriptors_chain_init(ENET_DMA_TX);
  enet_enable();netif_set_link_up(&interface);ready=1;dhcp_since=sys_now();update_mark_boot_success();runtime_event("Ethernet connected");
 }
 for(unsigned i=0;i<8;i++){
  uint32_t n=enet_rxframe_size_get();if(!n)break;
  if(n==1)continue;
  if(n>sizeof frame){enet_rxframe_drop();continue;}
  if(enet_frame_receive(frame,sizeof frame)!=SUCCESS)break;
  struct pbuf*p=pbuf_alloc(PBUF_RAW,n,PBUF_POOL);
  if(p){pbuf_take(p,frame,n);if(interface.input(p,&interface)!=ERR_OK)pbuf_free(p);++ethernet_rx;}
 }
 enet_rxprocess_check_recovery();
 if((uint32_t)(sys_now()-last_link)>1000){
  last_link=sys_now();uint16_t status=0;enet_phy_write_read(ENET_PHY_READ,1,1,&status);enet_phy_write_read(ENET_PHY_READ,1,1,&status);
  if(!(status&4)){netif_set_link_down(&interface);enet_disable();ready=0;runtime_event("Ethernet disconnected");}
 }
 gpio_bit_write(GPIOC,GPIO_PIN_0,(sys_now()/500)&1);
}

void network_address(char*out,unsigned size){ip4addr_ntoa_r(netif_ip4_addr(&interface),out,size);}
int network_ready(void){return netif_is_up(&interface)&&netif_is_link_up(&interface)&&!ip4_addr_isany_val(*netif_ip4_addr(&interface));}

uint32_t network_random(void){static uint32_t seed; if(!seed)seed=*(const uint32_t*)0x1ffff7e8 ^ sys_now() ^ 0x91a54e37u;seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return seed;}
