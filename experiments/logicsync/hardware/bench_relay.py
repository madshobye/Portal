"""Bounded, controller-only DNS/TCP relay to the explicitly specified Shiftr broker.

Use alongside dhcp_peer.py. This proves real-broker interoperability, not normal
router connectivity. Does not change host routes, firewall or Internet Sharing.
"""
import argparse,select,socket,struct,threading,time
parser=argparse.ArgumentParser();parser.add_argument('--seconds',type=int,default=600);parser.add_argument('--tcp-only',action='store_true');args=parser.parse_args()
assert 1<=args.seconds<=1800
host='2.0.0.10';controller='2.0.0.100';broker='public.cloud.shiftr.io';deadline=time.monotonic()+args.seconds
def pipe(client):
 try:
  with client,socket.create_connection((broker,1883),5) as remote:
   client.settimeout(5);remote.settimeout(5)
   while time.monotonic()<deadline:
    ready,_,_=select.select([client,remote],[],[],1)
    for source in ready:
     data=source.recv(4096)
     if not data:return
     (remote if source is client else client).sendall(data)
 except OSError as error:print('Relay connection ended:',type(error).__name__,flush=True)
dns=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);tcp=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
workers=[]
try:
 if not args.tcp_only:dns.bind((host,53))
 tcp.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);tcp.bind((host,1883));tcp.listen(2)
 print('Bench relay ready: only controller 2.0.0.100 -> public.cloud.shiftr.io:1883',flush=True)
 while time.monotonic()<deadline:
  ready,_,_=select.select([tcp] if args.tcp_only else [dns,tcp],[],[],1)
  for source in ready:
   if source is tcp:
    client,address=tcp.accept();workers=[w for w in workers if w.is_alive()]
    if address[0]!=controller or workers:client.close();continue
    worker=threading.Thread(target=pipe,args=(client,));workers.append(worker);worker.start();print('Controller TCP relay connected',flush=True)
   else:
    data,address=dns.recvfrom(512)
    if address[0]!=controller or len(data)<17 or data[2]&128 or data[4:6]!=b'\0\1':continue
    index=12;labels=[]
    while index<len(data) and data[index]:
     n=data[index];index+=1
     if n>63 or index+n>len(data):break
     labels.append(data[index:index+n]);index+=n
    if index>=len(data) or data[index]!=0 or index+5!=len(data):continue
    if b'.'.join(labels).lower()!=broker.encode() or data[index+1:]!=b'\0\1\0\1':continue
    reply=data[:2]+b'\x81\x80\0\1\0\1\0\0\0\0'+data[12:]+b'\xc0\x0c\0\1\0\1'+struct.pack('>I',30)+b'\0\4'+socket.inet_aton(host)
    dns.sendto(reply,address);print('Answered broker DNS for controller',flush=True)
finally:
 dns.close();tcp.close();deadline=0
 for worker in workers:worker.join(6)
 print('Bench relay stopped',flush=True)
