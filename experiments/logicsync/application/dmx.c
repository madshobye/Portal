#include "gd32f30x.h"
#include "app.h"
#include "string.h"
static const uint32_t uart[4]={USART0,USART1,USART2,UART3};
static const uint32_t txgpio[4]={GPIOB,GPIOD,GPIOD,GPIOC};
static const uint16_t txpin[4]={GPIO_PIN_6,GPIO_PIN_5,GPIO_PIN_8,GPIO_PIN_10};
static const uint32_t dirgpio[4]={GPIOC,GPIOA,GPIOA,GPIOA};
static const uint16_t dirpin[4]={GPIO_PIN_13,GPIO_PIN_15,GPIO_PIN_10,GPIO_PIN_9};
static const uint32_t dma[4]={DMA0,DMA0,DMA0,DMA1};
static const dma_channel_enum channel[4]={DMA_CH3,DMA_CH6,DMA_CH1,DMA_CH4};
static uint8_t pending[4][513],active[4][513];
static volatile unsigned enabled;
static int initialized;
static volatile uint32_t frame_count[4];
uint32_t dmx_frames(unsigned p){return p<4?frame_count[p]:0;}
unsigned dmx_enabled(void){return enabled;}
uint8_t dmx_value(unsigned p,unsigned c){return p<4&&c<513?pending[p][c]:0;}
int dmx_set(unsigned p,unsigned c,const uint8_t*d,unsigned n){
 if(p>=4||c<1||c>512||!n||n>513-c)return 0;
 __disable_irq();memcpy(&pending[p][c],d,n);enabled|=1u<<p;__enable_irq();return 1;
}
void dmx_blackout(void){__disable_irq();memset(pending,0,sizeof pending);__enable_irq();}
void dmx_init(void){
 rcu_periph_clock_enable(RCU_USART0);rcu_periph_clock_enable(RCU_USART1);rcu_periph_clock_enable(RCU_USART2);rcu_periph_clock_enable(RCU_UART3);
 rcu_periph_clock_enable(RCU_DMA0);rcu_periph_clock_enable(RCU_DMA1);
 gpio_pin_remap_config(GPIO_USART0_REMAP,ENABLE);gpio_pin_remap_config(GPIO_USART1_REMAP,ENABLE);gpio_pin_remap_config(GPIO_USART2_FULL_REMAP,ENABLE);
 for(unsigned i=0;i<4;i++){
  gpio_bit_reset(dirgpio[i],dirpin[i]);gpio_init(dirgpio[i],GPIO_MODE_OUT_PP,GPIO_OSPEED_50MHZ,dirpin[i]);
  gpio_bit_set(txgpio[i],txpin[i]);gpio_init(txgpio[i],GPIO_MODE_AF_PP,GPIO_OSPEED_50MHZ,txpin[i]);
  usart_deinit(uart[i]);usart_baudrate_set(uart[i],250000);usart_word_length_set(uart[i],USART_WL_8BIT);usart_stop_bit_set(uart[i],USART_STB_2BIT);usart_parity_config(uart[i],USART_PM_NONE);usart_transmit_config(uart[i],USART_TRANSMIT_ENABLE);usart_enable(uart[i]);
  dma_deinit(dma[i],channel[i]);dma_parameter_struct d;dma_struct_para_init(&d);
  d.periph_addr=uart[i]+4;d.memory_addr=(uint32_t)active[i];d.direction=DMA_MEMORY_TO_PERIPHERAL;d.number=513;d.periph_inc=DMA_PERIPH_INCREASE_DISABLE;d.memory_inc=DMA_MEMORY_INCREASE_ENABLE;d.periph_width=DMA_PERIPHERAL_WIDTH_8BIT;d.memory_width=DMA_MEMORY_WIDTH_8BIT;d.priority=DMA_PRIORITY_HIGH;
  dma_init(dma[i],channel[i],&d);usart_dma_transmit_config(uart[i],USART_TRANSMIT_DMA_ENABLE);
 }
 initialized=1;
}
void dmx_tick(void){
 if(!initialized)return;
 unsigned phase=sys_now()%30;
 for(unsigned i=0;i<4;i++)if(enabled&(1u<<i)){
  if(phase==0){
   /* 30 ms period exceeds 513 slots * 44 us plus break and mark. */
   dma_channel_disable(dma[i],channel[i]);memcpy(active[i],pending[i],513);
   gpio_bit_reset(txgpio[i],txpin[i]);gpio_init(txgpio[i],GPIO_MODE_OUT_PP,GPIO_OSPEED_50MHZ,txpin[i]);gpio_bit_set(dirgpio[i],dirpin[i]);
  }else if(phase==1)gpio_bit_set(txgpio[i],txpin[i]);
  else if(phase==2){
   frame_count[i]++;
   gpio_init(txgpio[i],GPIO_MODE_AF_PP,GPIO_OSPEED_50MHZ,txpin[i]);dma_transfer_number_config(dma[i],channel[i],513);dma_channel_enable(dma[i],channel[i]);
  }
 }
}
void dmx_stop(void){
 __disable_irq();enabled=0;
 for(unsigned i=0;i<4;i++){dma_channel_disable(dma[i],channel[i]);gpio_bit_reset(dirgpio[i],dirpin[i]);}
 __enable_irq();
}

void dmx_frame(const uint8_t data[4][512]){uint32_t mask=__get_PRIMASK();__disable_irq();for(unsigned p=0;p<4;p++)memcpy(pending[p]+1,data[p],512);enabled=15;if(!mask)__enable_irq();}
