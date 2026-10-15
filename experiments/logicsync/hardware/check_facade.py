"""Explicit connected-board test. Temporarily uses 16 fixtures and leaves blackout."""
import socket,struct,json,time,urllib.request,urllib.error,base64,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1];keys=json.loads((Path.home()/'.codex/memories/logicsync-private/access-keys.json').read_text());opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(path,body=None,admin=False):
 headers={'X-Facade-Key':keys['admin']} if admin else {}
 with opener.open(urllib.request.Request('http://2.0.0.100'+path,data=body,headers=headers),timeout=5) as r:return r.read()
def status():return json.loads(request('/api/status'))
def command(topic,value):assert json.loads(request('/api/command',(topic+' '+json.dumps(value)).encode()))['ok']
def config(value):assert json.loads(request('/api/config',json.dumps(value).encode(),True))['ok']
def exact(s,n):
 b=b''
 while len(b)<n:
  piece=s.recv(n-len(b))
  if not piece:raise EOFError()
  b+=piece
 return b
def frame(s,payload,opcode=1):
 n=len(payload);mask=b'abcd';head=bytes([128|opcode,128|n]) if n<126 else bytes([128|opcode,254])+struct.pack('>H',n)
 s.sendall(head+mask+bytes(v^mask[i%4] for i,v in enumerate(payload)))
 h=exact(s,2);n=h[1]&127
 if n==126:n=struct.unpack('>H',exact(s,2))[0]
 return json.loads(exact(s,n))
for path,body in [('/api/config',b'{"fixtures":[4,4,4,4]}'),('/api/update',b'enter-usb-update')]:
 try:request(path,body);raise AssertionError('Unauthenticated request accepted')
 except urllib.error.HTTPError as e:assert e.code==403
config({'fixtures':[4,4,4,4],'limit':32})
command('/set/brightness',255);command('/set/effect',9);command('/set/color',{'r':255,'g':0,'b':0})
time.sleep(.9)
for port in range(4):
 data=bytes.fromhex(request('/api/dmx/'+str(port)).decode());assert data==bytes([32,0,0,0])*112+bytes(64)
a=status();time.sleep(1);b=status();rates=[y-x for x,y in zip(a['dmx_frames'],b['dmx_frames'])];assert all(30<=r<=38 for r in rates),rates
with socket.create_connection(('2.0.0.100',80),5) as s:
 key=base64.b64encode(bytes(range(16)));s.sendall(b'GET /ws HTTP/1.1\r\nHost: 2.0.0.100\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+b'\r\n\r\n');h=b''
 while not h.endswith(b'\r\n\r\n'):h+=exact(s,1)
 assert b'101' in h
 assert not frame(s,b'claim '+b'0'*32)['ok'];assert frame(s,b'claim '+keys['artist'].encode())['ok']
 try:command('/set/effect',0);raise AssertionError('Artist priority bypassed')
 except urllib.error.HTTPError as e:assert e.code==400
 assert frame(s,b'\1'+bytes([0,255,0])*448,2)['ok'];time.sleep(.9)
 for port in range(4):assert bytes.fromhex(request('/api/dmx/'+str(port)).decode())==bytes([0,32,0,0])*112+bytes(64)
 assert frame(s,bytes([3,3,2,0,255]),2)['ok'];time.sleep(.1);assert bytes.fromhex(request('/api/dmx/3').decode())[511]==32
 assert frame(s,b'release')['ok']
time.sleep(.9);assert status()['mode']==0
command('/set/brightness',0);time.sleep(.1)
for port in range(4):assert not any(bytes.fromhex(request('/api/dmx/'+str(port)).decode()))
report={'status':status(),'frames_per_second':rates,'admin_rejection':True,'artist_auth_priority':True,'full_448_rgb_frame':True,'raw_channel_512_limit':True,'release_to_effect':True,'blackout':True}
(root/'artifacts/analysis/facade-0.4-hardware.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
