/** Measure installed artist ownership publication through the real Shiftr broker.
 * Requires the controller already connected; does not alter saved settings.
 */
import net from 'node:net';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {FacadeArtist} from '../artist/client.mjs';
const prefix='illutron-facade-dmx112-gd32f307-4universe-7c92e6b4a8134f60a9d2';
const keys=JSON.parse(await readFile(`${homedir()}/.codex/memories/logicsync-private/access-keys.json`));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const string=s=>{const b=Buffer.from(s),h=Buffer.alloc(2);h.writeUInt16BE(b.length);return Buffer.concat([h,b]);};
function packet(type,body){let n=body.length,l=[];do{let b=n%128;n=Math.floor(n/128);l.push(b|(n?128:0));}while(n);return Buffer.concat([Buffer.from([type,...l]),body]);}
const socket=net.createConnection(1883,'public.cloud.shiftr.io');
let pending=Buffer.alloc(0),connected=false,subscribed=false,transportError=null;
const states=[];
socket.on('error',e=>{transportError=e.message;});
socket.on('data',data=>{
 pending=Buffer.concat([pending,data]);
 while(pending.length>=2){
  let length=0,multiplier=1,i=1;
  for(;i<pending.length;i++){const b=pending[i];length+=(b&127)*multiplier;multiplier*=128;if(!(b&128))break;}
  if(i===pending.length||pending.length<i+1+length)return;
  const type=pending[0],body=pending.subarray(i+1,i+1+length);pending=pending.subarray(i+1+length);
  if(type===32){assert.equal(body[1],0);connected=true;}
  if(type===144)subscribed=true;
  if(type>>4===3){const n=body.readUInt16BE(0);if(body.subarray(2,2+n).toString()===prefix+'/state')states.push({at:performance.now(),state:JSON.parse(body.subarray(2+n))});}
 }
});
async function until(test,ms=5000){const end=performance.now()+ms;while(!test()){if(transportError)throw Error(transportError);assert.ok(performance.now()<end,'Timed out waiting for broker state');await sleep(5);}}
const artist=new FacadeArtist();const results=[];
try{
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
 socket.write(packet(16,Buffer.concat([string('MQTT'),Buffer.from([4,194,0,30]),string('artist-latency-'+Date.now()),string('public'),string('public')])));
 await until(()=>connected);
 socket.write(packet(130,Buffer.concat([Buffer.from([0,1]),string(prefix+'/state'),Buffer.from([0])])));
 await until(()=>subscribed);
 const response=await fetch('http://2.0.0.100/api/status',{signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);const initial=await response.json();
 assert.equal(initial.mqtt_connected,true);assert.equal(initial.artist,false);assert.equal(initial.brightness,0);
 artist.configure(initial.fixtures);
 async function transition(name,value,action){
  const start=performance.now();await action();
  await until(()=>states.some(s=>s.at>=start&&s.state.artist===value&&s.state.firmware===initial.firmware),2000);
  const match=states.find(s=>s.at>=start&&s.state.artist===value&&s.state.firmware===initial.firmware);
  results.push({name,milliseconds:match.at-start,artist:value});
 }
 await transition('claim',true,()=>artist.connect('ws://2.0.0.100',keys.artist));
 await sleep(150);
 await transition('explicit release',false,()=>artist.disconnect());
 await sleep(150);
 await transition('second claim',true,()=>artist.connect('ws://2.0.0.100',keys.artist));
 await sleep(150);
 await transition('socket close',false,()=>artist.close());
 assert.ok(results.every(r=>r.milliseconds<2000));
 const report={firmware:initial.firmware,broker:'public.cloud.shiftr.io',bench_relay:true,results};
 await writeFile(new URL('../artifacts/analysis/artist-mqtt-latency.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{artist.close();socket.end(Buffer.from([224,0]));socket.destroy();}
