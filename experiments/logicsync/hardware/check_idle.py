"""Ten-minute real-time idle/fade/wake check; uses dim red and restores blackout."""
import json,time,urllib.request
from pathlib import Path
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(path,body=None):
 with opener.open(urllib.request.Request('http://2.0.0.100'+path,data=body),timeout=3) as response:return response.read()
def state():return json.loads(request('/api/status'))
def command(topic,value):assert json.loads(request('/api/command',(topic+' '+json.dumps(value)).encode()))['ok']
def output():return bytes.fromhex(request('/api/dmx/0').decode())
original=state();assert not original['artist'] and original['fixtures'][0]>0
samples=[];failures=[]
try:
 command('/set/effect',9);command('/set/color',{'r':255,'g':0,'b':0});command('/set/brightness',32)
 time.sleep(1);initial=output();assert initial[0]>0
 deadline=time.monotonic()+650;last=None
 while time.monotonic()<deadline:
  try:
   s=state();level=output()[0];samples.append({'uptime_ms':s['uptime_ms'],'inactive_ms':s['inactive_ms'],'level':level,'frames':s['dmx_frames']})
   if last:
    assert s['uptime_ms']>last['uptime_ms'],'Controller restarted'
    assert all(b>a for a,b in zip(last['dmx_frames'],s['dmx_frames'])),'DMX counters stalled'
   last=s
   if s['inactive_ms']>=604000:
    assert level==0 and not any(output()),'Idle output did not reach black'
    break
  except OSError as e:failures.append({'elapsed':time.monotonic(),'error':type(e).__name__})
  time.sleep(.3 if last and last['inactive_ms']>598000 else 5)
 else:raise AssertionError('No verified idle blackout before deadline')
 assert any(0<x['level']<initial[0] for x in samples if x['inactive_ms']>=600000),'No intermediate fade level observed'
 command('/set/color',{'r':255,'g':0,'b':0});time.sleep(1);assert output()[0]==initial[0],'Interaction did not restore output'
 report={'idle_fade_blackout_wake':True,'samples':samples,'network_read_failures':failures}
 Path(__file__).resolve().parents[1].joinpath('artifacts/analysis/facade-idle-hardware.json').write_text(json.dumps(report,indent=2)+'\n')
 print('PASS: ten-minute idle, intermediate fade, blackout, wake, continuous DMX',flush=True)
finally:
 # Retry through a DHCP maintenance window if necessary.
 for attempt in range(60):
  try:
   command('/set/brightness',0);command('/set/effect',original['effect']);command('/set/color',dict(zip(('r','g','b'),original['color'])));break
  except OSError:time.sleep(1)
 else:raise RuntimeError('Could not verify cleanup blackout')
