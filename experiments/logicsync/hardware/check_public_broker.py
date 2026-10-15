"""Real Shiftr round trip. Requires controller online; restores blackout.

May be run with the explicitly documented bench relay. Does not claim that the
controller has standalone internet routing when that relay is in use.
"""
import json,socket,struct,time,urllib.request
from pathlib import Path
prefix='illutron-facade-dmx112-gd32f307-4universe-7c92e6b4a8134f60a9d2'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(path,body=None):
 with opener.open(urllib.request.Request('http://2.0.0.100'+path,data=body),timeout=5) as response:return response.read()
def state():return json.loads(request('/api/status'))
def string(value):data=value.encode();return struct.pack('>H',len(data))+data
def packet(kind,payload):
 n=len(payload);length=bytearray()
 while True:
  byte=n%128;n//=128;length.append(byte|(128 if n else 0))
  if not n:break
 return bytes([kind])+length+payload
def exact(stream,n):
 out=b''
 while len(out)<n:
  part=stream.recv(n-len(out))
  if not part:raise EOFError('Broker disconnected')
  out+=part
 return out
def read(stream):
 kind=exact(stream,1)[0];n=0
 for shift in range(0,28,7):
  byte=exact(stream,1)[0];n+=(byte&127)<<shift
  if not byte&128:break
 else:raise ValueError('Invalid broker packet length')
 assert n<16384
 return kind,exact(stream,n)
initial=state();assert initial['mqtt_connected'] and not initial['artist']
with socket.create_connection(('public.cloud.shiftr.io',1883),10) as stream:
 stream.settimeout(10)
 stream.sendall(packet(16,string('MQTT')+b'\4\xc2'+struct.pack('>H',30)+string('facade-roundtrip-'+str(time.time_ns()))+string('public')+string('public')))
 assert read(stream)==(32,b'\0\0')
 stream.sendall(packet(130,b'\0\1'+string(prefix+'/state')+b'\0'))
 def publish(suffix,value):stream.sendall(packet(48,string(prefix+suffix)+json.dumps(value).encode()))
 try:
  publish('/set/brightness',0);publish('/set/effect',9);publish('/set/color',{'r':0,'g':0,'b':255});publish('/set/brightness',32)
  deadline=time.monotonic()+20;observed=None
  while time.monotonic()<deadline:
   kind,payload=read(stream)
   if kind>>4!=3:continue
   length=int.from_bytes(payload[:2],'big');topic=payload[2:2+length].decode()
   if topic!=prefix+'/state':continue
   candidate=json.loads(payload[2+length:])
   if candidate['brightness']==32 and candidate['color']==[0,0,255] and candidate['effect']==9:observed=candidate;break
  assert observed,'No matching state received through public broker'
  time.sleep(1);current=state();assert current['color']==[0,0,255] and current['brightness']==32
  expected=32*current['limit']//255
  output=bytes.fromhex(request('/api/dmx/0').decode());assert output[:4]==bytes([0,0,expected,0])
  publish('/pixels/frame',{'rgb':[255,0,0]*current['pixels']});time.sleep(1)
  assert state()['mode']==1
  assert bytes.fromhex(request('/api/dmx/0').decode())[:4]==bytes([expected,0,0,0])
  publish('/pixels/release',{});time.sleep(1);assert state()['mode']==0
  report={'broker':'public.cloud.shiftr.io','bench_relay':True,'mqtt_command_and_state_roundtrip':True,'dmx_buffer_match':True,'full_configured_pixel_frame':True,'release':True,'controller_state':observed}
  Path(__file__).resolve().parents[1].joinpath('artifacts/analysis/public-broker-roundtrip.json').write_text(json.dumps(report,indent=2)+'\n')
  print('PASS: real Shiftr commands, returned state, DMX buffers, pixel frame and release',flush=True)
 finally:
  # HTTP cleanup does not depend on the public broker connection remaining alive.
  for topic,value in [('/set/brightness',0),('/pixels/release',{}),('/set/effect',initial['effect']),('/set/color',dict(zip(('r','g','b'),initial['color'])))]:
   request('/api/command',(topic+' '+json.dumps(value)).encode())
  stream.sendall(b'\xe0\0')
