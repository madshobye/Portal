"""Exercise compiled update flag code and HTTP request handler in ARM emulation.
Flash peripheral calls are mocked; their addresses and preserved bytes are checked.
"""
import struct,subprocess,unittest,json
from pathlib import Path
from unicorn import *
from unicorn.arm_const import *
OUT=Path.home()/'.codex/memories/logicsync-private/application'
class UpdateTests(unittest.TestCase):
 def setup_cpu(self):
  self.sym={f[2]:int(f[0],16) for line in subprocess.check_output(['arm-none-eabi-nm',str(OUT/'custom.elf')],text=True).splitlines() if len(f:=line.split())==3}
  uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS)
  for a,n in [(0x08000000,0x40000),(0x20000000,0x18000),(0x40000000,0x30000)]:uc.mem_map(a,n)
  raw=(OUT/'custom.raw.bin').read_bytes();uc.mem_write(0x08008000,raw)
  uc.reg_write(UC_ARM_REG_SP,0x20018000)
  uc.mem_write(self.sym['_sdata'],bytes(uc.mem_read(self.sym['_sidata'],self.sym['_edata']-self.sym['_sdata'])))
  self.call(uc,'runtime_init')
  return uc
 def call(self,uc,name,*args):
  for reg,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args):uc.reg_write(reg,v)
  uc.reg_write(UC_ARM_REG_LR,0x0803fff1);uc.emu_start(self.sym[name]|1,0x0803fff0,count=1000000)
  self.assertEqual(uc.reg_read(UC_ARM_REG_PC),0x0803fff0)
  return uc.reg_read(UC_ARM_REG_R0)
 def test_flag_page_preserved_and_erase_failure_reported(self):
  for value,fail in [(0x55aaee11,False),(0xffffffff,False),(0x55aaee11,True)]:
   uc=self.setup_cpu();page=bytes((i*17)%256 for i in range(2048));uc.mem_write(0x0803d800,page);calls=[]
   def hook(uc,addr,size,extra):
    name=next((n for n in ['fmc_unlock','fmc_lock','fmc_page_erase','fmc_word_program'] if self.sym[n]==addr),None)
    if not name:return
    a=uc.reg_read(UC_ARM_REG_R0);v=uc.reg_read(UC_ARM_REG_R1);result=0
    if name=='fmc_page_erase':
     self.assertEqual(a,0x0803d800);calls.append(name)
     if fail:result=4
     else:uc.mem_write(a,b'\xff'*2048)
    elif name=='fmc_word_program':
     self.assertTrue(0x0803d800<=a<=0x0803dffc and a%4==0);self.assertFalse(fail);uc.mem_write(a,v.to_bytes(4,'little'))
    uc.reg_write(UC_ARM_REG_R0,result);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
   uc.hook_add(UC_HOOK_CODE,hook)
   self.assertEqual(self.call(uc,'set_flag',value),not fail)
   expected=page if fail else value.to_bytes(4,'little')+page[4:]
   self.assertEqual(bytes(uc.mem_read(0x0803d800,2048)),expected);self.assertEqual(calls,['fmc_page_erase'])
 def test_http_fragmentation_and_invalid_update_requests(self):
  key=json.loads((OUT.parent/'access-keys.json').read_text())['admin'].encode()
  valid=b'POST /api/update HTTP/1.1\r\nHost: 2.0.0.100\r\nContent-Length: 16\r\nX-LogicSync-Update: 1\r\n\r\nenter-usb-update'
  valid=valid.replace(b'X-LogicSync-Update: 1',b'X-Facade-Key: '+key+b'\r\nX-LogicSync-Update: 1')
  for chunks,success in [([valid],True),([valid.replace(key,b'0'*32)],False),([valid.replace(b'X-Facade-Key: '+key+b'\r\n',b'')],False),([valid.replace(b'X-LogicSync-Update',b'X-logicsync-update')],True),([valid.replace(b'Content-Length',b'content-length')],True),([valid[:30],valid[30:-5],valid[-5:]],True),([valid.replace(b'X-LogicSync-Update: 1\r\n',b'')],False),([valid.replace(b'enter-usb-update',b'wrong-usb-update')],False),([b'GET /api/update HTTP/1.1\r\n\r\n'],False)]:
   uc=self.setup_cpu();replies=[];updates=[]
   def string(p):
    b=bytearray()
    while (v:=bytes(uc.mem_read(p+len(b),1)))!=b'\0':b.extend(v)
    return b.decode()
   def hook(uc,addr,size,extra):
    r0=uc.reg_read(UC_ARM_REG_R0);r1=uc.reg_read(UC_ARM_REG_R1);r2=uc.reg_read(UC_ARM_REG_R2)
    if addr==self.sym['reply']:replies.append((string(r1),string(r2),string(uc.reg_read(UC_ARM_REG_R3))))
    elif addr==self.sym['update_schedule']:updates.append(1)
    elif addr==self.sym['pbuf_copy_partial']:
     payload=struct.unpack('<I',uc.mem_read(r0+4,4))[0];uc.mem_write(r1,bytes(uc.mem_read(payload,r2)))
    elif addr not in [self.sym['pbuf_free'],self.sym['tcp_recved']]:return
    uc.reg_write(UC_ARM_REG_R0,0);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
   uc.hook_add(UC_HOOK_CODE,hook);connection=self.sym['connections'];pbuf=0x20016000;payload=pbuf+64
   for chunk in chunks:
    uc.mem_write(payload,chunk);uc.mem_write(pbuf,struct.pack('<IIHH',0,payload,len(chunk),len(chunk)))
    self.call(uc,'received',connection,0x20017000,pbuf,0)
   self.assertEqual(bool(updates),success);self.assertEqual(len(replies),1)
   self.assertEqual(replies[0][0].startswith('200'),success)
if __name__=='__main__':unittest.main()
