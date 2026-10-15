"""Explicit hardware test: sets A dim red and briefly configures a local MQTT test peer.
Run only with the intended RGBW fixture connected; not an offline unit test.
This minimal peer checks protocol exchanges, not full broker interoperability.
"""
import socket,struct,base64,hashlib,json,urllib.request,time
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def http(path,data=None):
 return json.load(opener.open(urllib.request.Request('http://2.0.0.100'+path,data=data),timeout=5))
def exact(s,n):
 b=b''
 while len(b)<n:
  x=s.recv(n-len(b))
  if not x: raise EOFError()
  b+=x
 return b
with socket.create_connection(('2.0.0.100',80),5) as s:
 key=base64.b64encode(bytes(range(16)))
 s.sendall(b'GET /ws HTTP/1.1\r\nHost: 2.0.0.100\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+b'\r\n\r\n')
 h=b''
 while not h.endswith(b'\r\n\r\n'):h+=exact(s,1)
 assert b'101' in h and base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest()) in h
 for opcode,payload in [(1,b'set 0 1 32'),(2,b'\0\0\1'+bytes([32,0,0,0])*28),(9,b'ping')]:
  mask=b'abcd';s.sendall(bytes([128|opcode,128|len(payload)])+mask+bytes(v^mask[i%4] for i,v in enumerate(payload)))
  head=exact(s,2);body=exact(s,head[1]);assert body==(b'ping' if opcode==9 else b'{"ok":true}'),body
 print('WebSocket handshake, text, 112-channel binary and ping passed',flush=True)
def packet(s):
 h=exact(s,1)[0];n=0;m=1
 while True:
  b=exact(s,1)[0];n+=(b&127)*m;m*=128
  if b<128:break
 return h,exact(s,n)
with socket.socket() as server:
 server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);server.bind(('2.0.0.10',18884));server.listen(1);server.settimeout(15)
 try:
  assert http('/api/command',b'mqtt 2.0.0.10 18884')['ok']
  for cycle in range(2):
   s,_=server.accept();s.settimeout(8)
   with s:
    h,b=packet(s);assert h==16 and b'logicsync-dmx4' in b;s.sendall(b'\x20\x02\0\0')
    subscribed=online=False
    while not(subscribed and online):
     h,b=packet(s)
     if h==130:
      assert b'logicsync/control' in b;s.sendall(b'\x90\x03'+b[:2]+b'\0');subscribed=True
     elif h==48:assert b'logicsync/statusonline' in b;online=True
    topic=b'logicsync/control';body=struct.pack('>H',len(topic))+topic+b'set 0 1 32';s.sendall(bytes([48,len(body)])+body)
    h,b=packet(s);assert h==48 and b'logicsync/resultok' in b,(h,b)
    assert http('/api/status')['mqtt_connected']
    print('MQTT test-peer CONNECT, subscribe, publish and command acknowledgment passed; cycle',cycle+1,flush=True)
 finally:
  print('MQTT disabled:',http('/api/command',b'mqtt 0.0.0.0 1883'),flush=True)
print(json.dumps(http('/api/status')))
