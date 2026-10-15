/** Two-minute maximum-size artist stream; restores fixture layout and blackout. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {FacadeArtist} from '../artist/client.mjs';
const keys=JSON.parse(await readFile(`${homedir()}/.codex/memories/logicsync-private/access-keys.json`));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,body,admin=false){
 const r=await fetch('http://2.0.0.100'+path,{method:body?'POST':'GET',body,headers:admin?{'X-Facade-Key':keys.admin}:{},signal:AbortSignal.timeout(5000)});
 assert.equal(r.status,200);return r;
}
const status=async()=> (await request('/api/status')).json();
const config=async fixtures=>request('/api/config',JSON.stringify({fixtures}),true);
await request('/api/command','/set/brightness 0');
const original=await status(),artist=new FacadeArtist({fixtures:[4,4,4,4]});
let sent=0,dropped=0,samples=0,maxBuffered=0;
try{
 await config([4,4,4,4]);
 await artist.connect('ws://2.0.0.100',keys.artist);
 const first=await status(),start=performance.now();let nextSample=0;
 const frame=new Uint8Array(448*3);
 while(performance.now()-start<120000){
  const tick=performance.now();
  for(let i=0;i<frame.length;i++)frame[i]=(i+sent)&255;
  assert.equal(artist.claimed,true);
  if(artist.frame(frame))sent++;else dropped++;
  maxBuffered=Math.max(maxBuffered,artist.ws.bufferedAmount);
  if(tick-start>=nextSample){
   const s=await status();assert.equal(s.artist,true);assert.equal(s.pixels,448);assert.equal(s.brightness,0);
   samples++;nextSample+=5000;
  }
  await sleep(Math.max(0,1000/30-(performance.now()-tick)));
 }
 while(artist.pending)await sleep(5);
 const last=await status(),seconds=(performance.now()-start)/1000;
 const rates=last.dmx_frames.map((v,i)=>(v-first.dmx_frames[i])/seconds);
 assert.ok(rates.every(v=>v>=30&&v<=40));
 for(let port=0;port<4;port++)assert.match(await(await request('/api/dmx/'+port)).text(),/^0{1024}$/);
 await artist.disconnect();assert.equal((await status()).artist,false);
 const report={firmware:last.firmware,seconds,sent,dropped,samples,maxBuffered,dmx_fps:rates,blackout:true,release:true,artist_27fps_target_passed:sent/seconds>27};
 await writeFile(new URL('../artifacts/analysis/artist-stream-hardware.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 assert.ok(report.artist_27fps_target_passed,'Artist stream below 27 frames/sec target; measurements saved');
}catch(error){
 console.error(JSON.stringify({failed:true,sent,dropped,samples,error:error.message}));throw error;
}finally{
 artist.close();await sleep(100);
 await request('/api/command','/set/brightness 0');await config(original.fixtures);
 const s=await status();assert.deepEqual(s.fixtures,original.fixtures);assert.equal(s.brightness,0);
 console.log('Original fixture layout restored; brightness zero.');
}
