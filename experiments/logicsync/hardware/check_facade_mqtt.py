"""Hardware MQTT test; restores the public broker explicitly required by specification section 5."""
import socket,struct,json,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1];key=json.loads((Path.home()/'.codex/memories/logicsync-private/access-keys.json').read_text())['admin'];prefix='illutron-facade-dmx112-gd32f307-4universe-7c92e6b4a8134f60a9d2';opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def http(path,body=None,admin=False):
 with opener.open(urllib.request.Request('http://2.0.0.100'+path,data=body,headers={'X-Facade-Key':key} if admin else {}),timeout=5) as r:return r.read()
def config(data):assert json.loads(http('/api/config',json.dumps(data).encode(),True))['ok']
def command(t,v):assert json.loads(http('/api/command',(t+' '+json.dumps(v)).encode()))['ok']
def exact(s,n):
 b=b''
 while len(b)<n:
  p=s.recv(n-len(b))
  if not p:raise EOFError()
  b+=p
 return b
def packet(s):
 head=exact(s,1)[0];n=0;m=1
 while True:
  b=exact(s,1)[0];n+=(b&127)*m;m*=128
  if b<128:break
 return head,exact(s,n)
def publish(s,topic,value,retained=False):
 topic=(prefix+topic).encode();body=struct.pack('>H',len(topic))+topic+json.dumps(value,separators=(',',':')).encode();n=len(body);header=bytes([49 if retained else 48])
 while True:
  b=n%128;n//=128;header+=bytes([b|(128 if n else 0)])
  if not n:break
 s.sendall(header+body)
with socket.socket() as server:
 server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);server.bind(('2.0.0.10',18884));server.listen(1);server.settimeout(40)
 try:
  config({'broker':'2.0.0.10','port':18884,'fixtures':[4,4,4,4],'limit':32});print('Waiting for controller MQTT connection',flush=True)
  s,_=server.accept();s.settimeout(8)
  with s:
   h,b=packet(s);assert h==16 and b'public' in b and b'facade-' in b;s.sendall(b'\x20\2\0\0');subscriptions=[]
   while len(subscriptions)<2:
    h,b=packet(s)
    if h==130:subscriptions.append(b[4:-1].decode());s.sendall(b'\x90\3'+b[:2]+b'\0')
   assert set(subscriptions)=={prefix+'/set/+',prefix+'/pixels/+'}
   command('/set/brightness',255);publish(s,'/pixels/frame',{'rgb':[0,0,255]*448});time.sleep(1)
   for p in range(4):assert bytes.fromhex(http('/api/dmx/'+str(p)).decode())==bytes([0,0,32,0])*112+bytes(64)
   publish(s,'/pixels/set',{'index':447,'r':255,'g':0,'b':0},True);time.sleep(.2);assert bytes.fromhex(http('/api/dmx/3').decode())[444:448]==bytes([0,0,32,0])
   publish(s,'/pixels/set',{'index':447,'r':255,'g':0,'b':0});time.sleep(.2);assert bytes.fromhex(http('/api/dmx/3').decode())[444:448]==bytes([32,0,0,0])
   publish(s,'/pixels/release',{});time.sleep(.2);assert json.loads(http('/api/status'))['mode']==0
   result={'mqtt_credentials':True,'topic_subscriptions':True,'full_frame_448':True,'retained_pixel_rejected':True,'single_pixel_447':True,'release':True};(root/'artifacts/analysis/facade-mqtt-hardware.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
 finally:
  command('/set/brightness',0);config({'broker':'public.cloud.shiftr.io','port':1883});print('Specified public broker restored; blackout saved',flush=True)
