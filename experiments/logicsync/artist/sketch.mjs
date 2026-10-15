import {FacadeArtist} from './client.mjs';
const $=id=>document.getElementById(id);let artist=null,values=new Uint8Array(84),sent=0,dropped=0;
$('connect').onclick=async()=>{
 if(artist)return;
 try{
  if(location.protocol==='https:'&&$('address').value.startsWith('ws:'))throw Error('Open this artist example through a local HTTP server to use ws://');
  const counts=$('counts').value.split(',').map(value=>Number(value.trim()));artist=new FacadeArtist({fixtures:counts});values=new Uint8Array(artist.pixelCount*3);
  const current=artist;current.addEventListener('disconnected',()=>{if(artist===current){artist=null;$('connect').disabled=false;$('release').disabled=$('clear').disabled=true;$('status').textContent='Disconnected · controller restores its previous effect';}});
  $('connect').disabled=true;$('status').textContent='Requesting artist control…';await current.connect($('address').value,$('key').value.trim());$('key').value='';$('release').disabled=$('clear').disabled=false;$('status').textContent='Artist control active';sent=dropped=0;
 }catch(error){artist?.close();artist=null;$('connect').disabled=false;$('status').textContent=error.message;}
};
$('release').onclick=async()=>{try{await artist?.disconnect();}catch(error){$('status').textContent=error.message;}};
$('clear').onclick=async()=>{if(!artist)return;$('animate').checked=false;try{await artist.clear();values.fill(0);}catch(error){$('status').textContent=error.message;}};
new p5(p=>{
 p.setup=()=>{p.createCanvas(800,180).parent('preview');p.frameRate(30);p.noStroke();};
 p.draw=()=>{
  const n=values.length/3;if($('animate').checked){const time=p.millis()/1000*Number($('speed').value);for(let i=0;i<n;i++){const t=i/n*Math.PI*4+time;values[i*3]=Math.round(127.5+127.5*Math.sin(t));values[i*3+1]=Math.round(127.5+127.5*Math.sin(t+2.1));values[i*3+2]=Math.round(127.5+127.5*Math.sin(t+4.2));}}
  p.background('#182b24');const columns=Math.min(n,112),rows=Math.ceil(n/columns);for(let i=0;i<n;i++){p.fill(values[i*3],values[i*3+1],values[i*3+2]);p.rect((i%columns)*p.width/columns,Math.floor(i/columns)*p.height/rows,p.width/columns+1,p.height/rows-2);}
  if(artist?.claimed&&$('animate').checked){if(artist.frame(values))sent++;else dropped++;$('status').textContent=`Artist control active · ${n} pixels · ${sent} frames sent · ${dropped} frames skipped`;}
 };
});
window.addEventListener('pagehide',()=>artist?.close());
