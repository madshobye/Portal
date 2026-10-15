/* The factory bootloader checks 0x0803d800 for 0x55aaee11 before jumping
 * to the application. Preserve the rest of that 2-KiB page on every change.
 * No bootloader code, option bytes or application pages are modified here. */
#include "gd32f30x.h"
#include "app.h"
#include "string.h"
#define FLAG_ADDRESS 0x0803d800u
#define UPDATE_MAGIC 0x55aaee11u
static uint32_t page[512];
static uint32_t update_at;
static int scheduled;
static int set_flag(uint32_t value){
 if(*(volatile uint32_t*)FLAG_ADDRESS==value)return 1;
 memcpy(page,(const void*)FLAG_ADDRESS,sizeof page);page[0]=value;
 uint32_t mask=__get_PRIMASK();__disable_irq();fmc_unlock();
 /* Clear any sticky status from earlier flash operations. */
 FMC_STAT0=FMC_STAT0_ENDF|FMC_STAT0_PGERR|FMC_STAT0_WPERR;
 int ok=fmc_page_erase(FLAG_ADDRESS)==FMC_READY;
 for(unsigned i=0;ok&&i<512;i++)if(page[i]!=0xffffffffu)ok=fmc_word_program(FLAG_ADDRESS+4*i,page[i])==FMC_READY;
 fmc_lock();if(!mask)__enable_irq();
 return ok&&!memcmp((const void*)FLAG_ADDRESS,page,sizeof page);
}
int update_mark_boot_success(void){
 if(*(volatile uint32_t*)FLAG_ADDRESS==UPDATE_MAGIC)return set_flag(0xffffffffu);
 return 1;
}
void update_schedule(void){scheduled=1;update_at=sys_now()+1000;}
void update_poll(void){
 if(scheduled&&(int32_t)(sys_now()-update_at)>=0){
  scheduled=0;dmx_stop();
  if(set_flag(UPDATE_MAGIC)){__DSB();NVIC_SystemReset();}
 }
}
