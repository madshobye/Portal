/** Exercise live stack diagnostics with artist traffic, HTTP and status reads.
 * Requires blackout and preserves fixture/effect configuration. No broker change.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {FacadeArtist} from '../artist/client.mjs';
const base='http://2.0.0.100';
const keys=JSON.parse(await readFile(`${homedir()}/.codex/memories/logicsync-private/access-keys.json`));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path){
 const response=await fetch(base+path,{signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,200);return response;
}
const status=async()=> (await request('/api/status')).json();
const initial=await status();
assert.equal(initial.brightness,0,'Run only while already blacked out');
assert.equal(initial.artist,false,'Do not interrupt an existing artist');
assert.ok(initial.stack_untouched_bytes>0,'Requires stack diagnostic firmware');
const artist=new FacadeArtist({fixtures:initial.fixtures});
const samples=[];let sent=0,skipped=0,error=null;
try{
 await artist.connect(base.replace('http:','ws:'),keys.artist);
 const frame=new Uint8Array(initial.pixels*3).fill(64);
 const start=performance.now();let nextRead=0;
 while(performance.now()-start<45000){
  if(artist.frame(frame))sent++;else skipped++;
  if(performance.now()>=nextRead){
   const s=await status();samples.push(s);
   assert.equal(s.artist,true);assert.equal(s.brightness,0);
   assert.deepEqual(s.fixtures,initial.fixtures);
   assert.ok(s.stack_untouched_bytes>6144,'Measured stack margin below 6 KiB');
   assert.ok(s.stack_untouched_bytes<=s.ram_unallocated_bytes);
   const page=await(await request('/')).text();assert.ok(page.includes('stack_untouched_bytes'));
   nextRead=performance.now()+1000;
  }
  await sleep(33);
 }
 while(artist.pending)await sleep(5);
 await artist.disconnect();
}catch(e){error=e.message;throw e;}
finally{
 artist.close();await sleep(200);
 const last=await status();
 const report={firmware:last.firmware,initial,final:last,samples,sent,skipped,error,
  minimum_untouched_bytes:Math.min(...samples.map(s=>s.stack_untouched_bytes),last.stack_untouched_bytes)};
 await writeFile(new URL('../artifacts/analysis/facade-memory-hardware.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 assert.equal(last.artist,false);assert.deepEqual(last.fixtures,initial.fixtures);
 assert.deepEqual(last.color,initial.color);assert.equal(last.effect,initial.effect);
 assert.equal(last.brightness,initial.brightness);
 console.log(JSON.stringify({firmware:last.firmware,samples:samples.length,sent,skipped,error,
  minimum_untouched_bytes:report.minimum_untouched_bytes,settings_preserved:true}));
}
