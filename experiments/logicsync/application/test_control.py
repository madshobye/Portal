"""Execute the actual compiled artist gate and WebSocket parser in ARM emulation."""
import json,struct,unittest
from test_update import UpdateTests,OUT
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import *
class ControlTests(UpdateTests):
 def test_status_with_full_event_log_fits_transport_buffer(self):
  uc=self.setup_cpu();buffer=0x20016000
  uc.mem_write(buffer,b'x'*63+b'\0')
  for _ in range(6):self.call(uc,'runtime_event',buffer)
  uc.mem_write(buffer,b'\xaa'*1401)
  n=self.call(uc,'control_state',buffer,1400)
  self.assertGreater(n,0);self.assertLess(n,1400)
  self.assertEqual(bytes(uc.mem_read(buffer+1400,1)),b'\xaa')
  state=json.loads(bytes(uc.mem_read(buffer,n)))
  self.assertEqual(len(state['events']),6)
  self.assertIn('stack_untouched_bytes',state)
  self.assertLessEqual(state['stack_untouched_bytes'],state['ram_unallocated_bytes'])
 def test_changes_publish_next_poll_without_frame_flooding(self):
  uc=self.setup_cpu();now=[1000];online=[True];fail=[False];states=[]
  uc.mem_write(self.sym['client'],struct.pack('<I',0x20016000))
  def hook(uc,addr,size,arg):
   result=None
   if addr==self.sym['network_ready']:result=int(online[0])
   elif addr==self.sym['mqtt_client_is_connected']:result=1
   elif addr==self.sym['mqtt_publish']:
    n=uc.reg_read(UC_ARM_REG_R3)
    payload=bytes(uc.mem_read(uc.reg_read(UC_ARM_REG_R2),n))
    decoded=json.loads(payload)
    if 'artist' in decoded:states.append(decoded)
    result=0xffffffff if fail[0] else 0
   if result is not None:
    uc.reg_write(UC_ARM_REG_R0,result);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  uc.hook_add(UC_HOOK_CODE,hook)
  def call(name,*args):
   uc.mem_write(self.sym['milliseconds'],struct.pack('<I',now[0]))
   return self.call(uc,name,*args)
  call('control_poll');self.assertFalse(states[-1]['artist'])
  # Two accepted public commands in the same millisecond each publish on
  # the next poll, without the former 100 ms minimum wait. No render or
  # transition time elapses before the accepted brightness is acknowledged.
  for value in [101,102]:
   payload=f'/set/brightness {value}'.encode();uc.mem_write(0x20016000,payload)
   self.assertEqual(call('control_command',0x20016000,len(payload)),1)
   call('control_poll');self.assertEqual(states[-1]['brightness'],value)
  self.assertEqual(len(states),3);states[:]=states[-1:]
  self.assertEqual(call('facade_claim',1,now[0]),1)
  call('control_poll');self.assertEqual(len(states),2);self.assertTrue(states[-1]['artist'])
  # Heartbeat/frame activity must not turn state publication into a frame stream.
  for t in range(1200,2000,100):
   now[0]=t;call('facade_keepalive',1,t);call('control_poll')
  self.assertEqual(len(states),2)
  call('facade_disconnect',1,now[0]);call('control_poll')
  self.assertFalse(states[-1]['artist']);self.assertEqual(len(states),3)
  now[0]=2100;call('facade_claim',1,now[0]);call('control_poll')
  self.assertTrue(states[-1]['artist'])
  # Actual render-time timeout also invalidates the published ownership.
  now[0]=12100;call('facade_render',now[0],0x20016000)
  call('control_poll');self.assertFalse(states[-1]['artist'])
  now[0]=12200;call('facade_claim',1,now[0]);call('control_poll')
  now[0]=12300;call('facade_release_request',1,now[0])
  online[0]=False;call('control_poll');self.assertTrue(states[-1]['artist'])
  online[0]=True;fail[0]=True;call('control_poll');count=len(states)
  fail[0]=False;call('control_poll')
  self.assertEqual(len(states),count+1);self.assertFalse(states[-1]['artist'])
 def test_websocket_upgrade_headers_and_malformed_close(self):
  valid=b'GET /ws HTTP/1.1\r\nHost: controller\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
  cases=[(valid,True),(valid.replace(b'websocket',b'WebSocket'),True),(valid.replace(b'Upgrade: websocket\r\n',b''),False),(valid.replace(b'keep-alive, Upgrade',b'keep-alive'),False),(valid.replace(b'HTTP/1.1',b'HTTP/1.0'),False)]
  for request,accepted in cases:
   uc=self.setup_cpu();c=self.sym['connections'];rejected=[]
   def hook(uc,addr,size,arg):
    if addr==self.sym['reply']:rejected.append(True)
    elif addr!=next(value for name,value in self.sym.items() if name=='flush' or name.startswith('flush.')):return
    uc.reg_write(UC_ARM_REG_R0,0);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
   uc.hook_add(UC_HOOK_CODE,hook);uc.mem_write(c+8,struct.pack('<I',len(request)));uc.mem_write(c+1444,request)
   self.call(uc,'process',c)
   self.assertEqual(bool(struct.unpack('<I',uc.mem_read(c+28,4))[0]),accepted)
   self.assertEqual(bool(rejected),not accepted)
  uc=self.setup_cpu();c=self.sym['connections'];codes=[]
  def close_hook(uc,addr,size,arg):
   if addr!=self.sym['ws_close']:return
   codes.append(uc.reg_read(UC_ARM_REG_R1));uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  uc.hook_add(UC_HOOK_CODE,close_hook)
  frame=b'\x88\x81abcd'+bytes([ord('a')])
  uc.mem_write(c+8,struct.pack('<I',len(frame)));uc.mem_write(c+1444,frame)
  self.call(uc,'ws_process',c);self.assertEqual(codes,[1002])
 def test_saved_network_changes_do_not_mutate_running_network(self):
  uc=self.setup_cpu();address=self.sym['runtime_network'];before=bytes(uc.mem_read(address,144))
  self.assertEqual(self.call(uc,'runtime_network_pending'),0)
  # Bypass only flash storage; execute the real configuration validation/apply.
  def hook(uc,addr,size,arg):
   if addr==self.sym['runtime_save']:
    uc.reg_write(UC_ARM_REG_R0,1);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  uc.hook_add(UC_HOOK_CODE,hook)
  payload=b'{"dhcp":0,"ip":"10.0.0.42","broker":"example.test","port":1884}'
  uc.mem_write(0x20016000,payload)
  self.assertEqual(self.call(uc,'control_configure',0x20016000,len(payload)),1)
  self.assertEqual(self.call(uc,'runtime_network_pending'),1)
  self.assertEqual(bytes(uc.mem_read(address,144)),before)
  n=self.call(uc,'control_configuration',0x20016000,640)
  saved=json.loads(bytes(uc.mem_read(0x20016000,n)))
  self.assertEqual(saved['ip'],'10.0.0.42');self.assertEqual(saved['broker'],'example.test')
 def test_configuration_readback_authentication_and_bounds(self):
  key=json.loads((OUT.parent/'access-keys.json').read_text())['admin'].encode()
  for supplied in [b'',b'0'*32,key]:
   uc=self.setup_cpu();replies=[]
   def string(p):
    result=bytearray()
    while (v:=bytes(uc.mem_read(p+len(result),1)))!=b'\0':result.extend(v)
    return result.decode()
   def hook(uc,addr,size,arg):
    if addr!=self.sym['reply']:return
    replies.append((string(uc.reg_read(UC_ARM_REG_R1)),string(uc.reg_read(UC_ARM_REG_R3))))
    uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
   uc.hook_add(UC_HOOK_CODE,hook)
   request=b'GET /api/config HTTP/1.1\r\nHost: controller\r\nX-Facade-Key: '+supplied+b'\r\n\r\n'
   c=self.sym['connections'];uc.mem_write(c+8,struct.pack('<I',len(request)));uc.mem_write(c+1444,request)
   self.call(uc,'process',c);self.assertEqual(len(replies),1)
   self.assertEqual(replies[0][0].startswith('200'),supplied==key)
   if supplied==key:
    config=json.loads(replies[0][1]);self.assertEqual(config,dict(dhcp=1,ip='2.0.0.100',mask='255.255.255.0',gateway='2.0.0.1',broker='public.cloud.shiftr.io',port=1883))
    self.assertNotIn(key.decode(),replies[0][1])
  uc=self.setup_cpu();buffer=0x20016000
  for size in [0,1,2,16,128,640]:
   uc.mem_write(buffer,b'\xaa'*650)
   length=self.call(uc,'control_configuration',buffer,size)
   self.assertEqual(bytes(uc.mem_read(buffer+size,1)),b'\xaa')
   if length:self.assertEqual(json.loads(bytes(uc.mem_read(buffer,length)))['broker'],'public.cloud.shiftr.io')
 def command(self,uc,connection,payload,opcode=1):
  replies=[]
  def hook(uc,addr,size,arg):
   if addr!=self.sym['ws_send']:return
   n=uc.reg_read(UC_ARM_REG_R3);replies.append(bytes(uc.mem_read(uc.reg_read(UC_ARM_REG_R2),n)))
   uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  handle=uc.hook_add(UC_HOOK_CODE,hook)
  mask=b'abcd';data=bytes([128|opcode,128|len(payload)])+mask+bytes(v^mask[i%4] for i,v in enumerate(payload))
  uc.mem_write(connection+8,struct.pack('<I',len(data)));uc.mem_write(connection+28,struct.pack('<I',1));uc.mem_write(connection+1444,data)
  self.call(uc,'ws_process',connection);uc.hook_del(handle)
  self.assertEqual(len(replies),1)
  return json.loads(replies[0])['ok']
 def test_artist_authentication_ownership_and_raw_limits(self):
  uc=self.setup_cpu();c=self.sym['connections'];key=json.loads((OUT.parent/'access-keys.json').read_text())['artist'].encode()
  self.assertEqual(self.command(uc,c,b'claim '+b'0'*32),0)
  self.assertEqual(self.command(uc,c,bytes([3,0,0,1,255]),2),0)
  self.assertEqual(self.command(uc,c,b'claim '+key),1)
  self.assertEqual(self.command(uc,c,b'keepalive'),1)
  self.assertEqual(self.command(uc,c,bytes([3,0,2,0,255,255]),2),0)
  self.assertEqual(self.command(uc,c,bytes([3,0,2,0,255]),2),1)
  self.assertEqual(self.command(uc,c,b'release'),1)
  self.assertEqual(self.command(uc,c,b'keepalive'),0)
 def test_full_binary_frame_and_fragmentation(self):
  for fragmented in [False,True]:
   uc=self.setup_cpu();c=self.sym['connections'];key=json.loads((OUT.parent/'access-keys.json').read_text())['artist'].encode()
   uc.mem_write(self.sym['facade_config'],b'\4\4\4\4')
   self.assertEqual(self.command(uc,c,b'claim '+key),1)
   replies=[]
   def hook(uc,addr,size,arg):
    if addr!=self.sym['ws_send']:return
    n=uc.reg_read(UC_ARM_REG_R3);replies.append(bytes(uc.mem_read(uc.reg_read(UC_ARM_REG_R2),n)))
    uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
   uc.hook_add(UC_HOOK_CODE,hook)
   def frame(op,fin,payload):
    mask=b'abcd';n=len(payload);head=bytes([op|(128 if fin else 0),128|n]) if n<126 else bytes([op|(128 if fin else 0),254])+struct.pack('>H',n)
    return head+mask+bytes(v^mask[i%4] for i,v in enumerate(payload))
   payload=b'\1'+bytes([32,12,5])*448
   frames=[frame(2,True,payload)] if not fragmented else [frame(2,False,payload[:700]),frame(0,True,payload[700:])]
   for data in frames:
    uc.mem_write(c+8,struct.pack('<I',len(data)));uc.mem_write(c+28,struct.pack('<I',1));uc.mem_write(c+1444,data);self.call(uc,'ws_process',c)
   self.assertEqual(replies,[b'{"ok":true}']);self.assertEqual(self.call(uc,'facade_mode'),2)
   self.assertEqual(bytes(uc.mem_read(self.sym['custom'],1344)),payload[1:])
if __name__=='__main__':unittest.main()
