#include <stdint.h>
#include "gd32f30x.h"
extern uint32_t _estack,_sidata,_sdata,_edata,_sbss,_ebss;
extern int main(void);
void SysTick_Handler(void);
void Default_Handler(void){while(1){}}
void Reset_Handler(void){
 __disable_irq();
 /* The USB bootloader may leave interrupts enabled and pending. */
 SysTick->CTRL=0;
 for(unsigned i=0;i<8;i++){NVIC->ICER[i]=0xffffffff;NVIC->ICPR[i]=0xffffffff;}
 for(uint32_t *p=&_sdata,*s=&_sidata;p<&_edata;)*p++=*s++;
 for(uint32_t *p=&_sbss;p<&_ebss;)*p++=0;
 /* Paint only unused RAM below the live reset stack. Interrupts remain
  * disabled; no active frame or static allocation is overwritten. */
 uint32_t *stack_limit=(uint32_t*)(__get_MSP()&~3u);
 for(volatile uint32_t *p=&_ebss;p<stack_limit;p++)*p=0x51ac7e3d;
 SystemInit();SCB->VTOR=0x08008000;
 __DSB();__ISB();__enable_irq();main();while(1){}
}
__attribute__((section(".isr_vector"),used))
void (*const vectors[100])(void)={
 [0]=(void(*)(void))&_estack,[1]=Reset_Handler,
 [2 ... 14]=Default_Handler,[15]=SysTick_Handler,[16 ... 99]=Default_Handler
};

/* Untouched paint is a high-water estimate, not a guarantee against overflow.
 * Include the current stack depth even if a frame reserves unwritten bytes. */
unsigned memory_stack_untouched(void){
 uintptr_t limit=__get_MSP()&~3u;
 if(limit>(uintptr_t)&_estack)limit=(uintptr_t)&_estack;
 volatile uint32_t *p=&_ebss;
 while((uintptr_t)p<limit&&*p==0x51ac7e3d)p++;
 return (unsigned)((uintptr_t)p-(uintptr_t)&_ebss);
}
