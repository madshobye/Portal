"""Check compiled startup and image boundaries; peripheral setup is stubbed.
This is not a substitute for Ethernet or electrical DMX hardware validation.
"""
import struct,subprocess,unittest
from pathlib import Path
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE
from unicorn.arm_const import *
OUT=Path.home()/'.codex/memories/logicsync-private/application'
class StartupTests(unittest.TestCase):
 def test_compiled_reset_initializes_memory_and_application_vectors(self):
  symbols={}
  for line in subprocess.check_output(['arm-none-eabi-nm',str(OUT/'custom.elf')],text=True).splitlines():
   fields=line.split()
   if len(fields)==3:symbols[fields[2]]=int(fields[0],16)
  raw=(OUT/'custom.raw.bin').read_bytes();sp,reset=struct.unpack_from('<II',raw)
  self.assertEqual(sp,0x20018000);self.assertEqual(reset,symbols['Reset_Handler']|1)
  self.assertLessEqual(len(raw),0x33000);self.assertLessEqual(symbols['_ebss'],sp-6144)
  uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);uc.mem_map(0x08000000,0x40000);uc.mem_write(0x08008000,raw);uc.mem_map(0x20000000,0x18000);uc.mem_write(0x20000000,b'\xa5'*0x18000);uc.mem_map(0xe000e000,0x2000)
  uc.reg_write(UC_ARM_REG_SP,sp)
  def hook(uc,addr,size,extra):
   if addr==symbols['SystemInit']:
    limit=uc.reg_read(UC_ARM_REG_SP)&~3
    self.assertEqual(uc.reg_read(UC_ARM_REG_PRIMASK),1)
    self.assertEqual(bytes(uc.mem_read(symbols['_ebss'],limit-symbols['_ebss'])),struct.pack('<I',0x51ac7e3d)*((limit-symbols['_ebss'])//4))
    uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  def write(uc,access,addr,size,value,extra):
   if value==0x51ac7e3d:self.assertTrue(symbols['_ebss']<=addr<uc.reg_read(UC_ARM_REG_SP))
   self.assertTrue(0x20000000<=addr and addr+size<=0x20018000 or 0xe000e000<=addr and addr+size<=0xe0010000)
  uc.hook_add(UC_HOOK_CODE,hook);uc.hook_add(UC_HOOK_MEM_WRITE,write)
  uc.emu_start(reset,symbols['main'],count=1000000)
  self.assertEqual(uc.reg_read(UC_ARM_REG_PC),symbols['main'])
  self.assertEqual(bytes(uc.mem_read(symbols['_sbss'],symbols['_ebss']-symbols['_sbss'])),bytes(symbols['_ebss']-symbols['_sbss']))
  length=symbols['_edata']-symbols['_sdata'];offset=symbols['_sidata']-0x08008000
  self.assertEqual(bytes(uc.mem_read(symbols['_sdata'],length)),raw[offset:offset+length])
  self.assertEqual(struct.unpack('<I',uc.mem_read(0xe000ed08,4))[0],0x08008000)
  def untouched():
   uc.reg_write(UC_ARM_REG_LR,0x0803fff1)
   uc.emu_start(symbols['memory_stack_untouched']|1,0x0803fff0,count=100000)
   self.assertEqual(uc.reg_read(UC_ARM_REG_PC),0x0803fff0)
   return uc.reg_read(UC_ARM_REG_R0)
  initial=untouched()
  self.assertGreater(initial,6144)
  self.assertLessEqual(initial,uc.reg_read(UC_ARM_REG_SP)-symbols['_ebss'])
  # A deeper stack write reduces the watermark even after the stack unwinds.
  uc.mem_write(symbols['_ebss']+128,b'\0'*4);self.assertEqual(untouched(),128)
  uc.mem_write(symbols['_ebss']+64,b'\0'*4);self.assertEqual(untouched(),64)
  uc.mem_write(symbols['_ebss'],b'\0'*4);self.assertEqual(untouched(),0)
if __name__=='__main__':unittest.main()
