"""Temporary DHCP peer for the directly connected test controller only.
Binds en12 and replies only to the observed LogicSync MAC. No other clients served.
"""
import socket,struct,time,json,argparse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--seconds',type=int,default=120);args=parser.parse_args();assert 1<=args.seconds<=1800
mac=bytes.fromhex('024c5336fb93');ip=socket.inet_aton('2.0.0.100');server=socket.inet_aton('2.0.0.10')
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)
s.setsockopt(socket.IPPROTO_IP,25,socket.if_nametoindex('en12'));s.bind(('',67));s.settimeout(1)
end=time.monotonic()+args.seconds;events=[]
print('DHCP test peer ready on en12; only controller MAC is eligible',flush=True)
while time.monotonic()<end:
 try:data,addr=s.recvfrom(2048)
 except socket.timeout:continue
 if len(data)<240 or data[0]!=1 or data[28:34]!=mac or data[236:240]!=b'\x63\x82\x53\x63':continue
 options={};i=240
 while i<len(data):
  code=data[i];i+=1
  if code==255:break
  if code==0:continue
  if i>=len(data):break
  n=data[i];i+=1;options[code]=data[i:i+n];i+=n
 typ=options.get(53,b'\0')[0]
 if typ not in [1,3]:continue
 if 54 in options and options[54]!=server:continue
 if 50 in options and options[50]!=ip:continue
 out=bytearray(240);out[:4]=b'\2\1\6\0';out[4:8]=data[4:8];out[10:12]=b'\x80\0';out[16:20]=ip;out[20:24]=server;out[28:44]=data[28:44];out[236:240]=b'\x63\x82\x53\x63'
 out+=bytes([53,1,2 if typ==1 else 5,54,4])+server+bytes([51,4])+struct.pack('>I',300)+bytes([1,4,255,255,255,0,3,4])+server+bytes([6,4])+server+b'\xff'
 try:s.sendto(out,('2.0.255.255',68))
 except OSError as error:
  print('Ethernet route not ready; waiting for next DHCP request:',error,flush=True);continue
 events.append({'message':'offer' if typ==1 else 'ack','ip':'2.0.0.100'});print(events[-1],flush=True)
 Path('experiments/logicsync/artifacts/analysis/dhcp-test.json').write_text(json.dumps(events,indent=2)+'\n')
s.close()
