/** Connected-board SDK test. Keeps brightness zero; never prints access keys. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {FacadeArtist} from '../artist/client.mjs';
const base='http://2.0.0.100';
const keys=JSON.parse(await readFile(`${homedir()}/.codex/memories/logicsync-private/access-keys.json`));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,body){const response=await fetch(base+path,{method:body?'POST':'GET',body,signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response;}
async function status(){return (await request('/api/status')).json();}
await request('/api/command','/set/brightness 0');
const initial=await status();
const artist=new FacadeArtist({fixtures:initial.fixtures});
try {
 await artist.connect(base.replace('http:','ws:'),keys.artist);
 assert.equal((await status()).artist,true);
 await artist.pixel(0,255,0,0);
 await artist.fixture(initial.fixtures.findIndex(n=>n>0),0,new Uint8Array(84).fill(96));
 assert.equal(artist.frame(new Uint8Array(initial.pixels*3).fill(64)),true);
 while(artist.pending)await sleep(10);
 await artist.raw(3,512,[255]);
 for(let port=0;port<4;port++)assert.match(await (await request('/api/dmx/'+port)).text(),/^0{1024}$/);
 await sleep(6500);assert.equal((await status()).artist,true);
 await artist.disconnect();await sleep(150);assert.equal((await status()).artist,false);
 await artist.connect(base.replace('http:','ws:'),keys.artist);
 artist.close();await sleep(150);assert.equal((await status()).artist,false);
 await artist.connect(base.replace('http:','ws:'),keys.artist);
 // Deliberately stop SDK keepalive while leaving TCP open to test board timeout.
 clearInterval(artist.heartbeat);artist.heartbeat=null;
 await sleep(11000);const final=await status();assert.equal(final.artist,false);assert.equal(final.mode,0);
 const report={sdk_commands:true,blackout_preserved:true,heartbeat:true,explicit_release:true,socket_close_release:true,ten_second_timeout:true,initial_frames:initial.dmx_frames,final_frames:final.dmx_frames};
 await writeFile(new URL('../artifacts/analysis/artist-sdk-hardware.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} finally {artist.close();await request('/api/command','/set/brightness 0');}
