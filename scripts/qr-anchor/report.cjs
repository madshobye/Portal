const {pathToFileURL}=require('node:url');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Standalone functions are embedded in the offline report and tested in Node.
function nearestFrame(frames,time) {
  let lo=0,hi=frames.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(frames[mid].time<time)lo=mid+1;else hi=mid;}
  if(!lo)return frames[0];
  if(lo===frames.length)return frames[lo-1];
  return time-frames[lo-1].time<=frames[lo].time-time?frames[lo-1]:frames[lo];
}
function startViewer(report,doc=document) {
  const video=doc.getElementById('video'),canvas=doc.getElementById('canvas'),ctx=canvas.getContext('2d');
  canvas.width=report.video.width;canvas.height=report.video.height;
  const precise=typeof video.requestVideoFrameCallback==='function';
  let presentedTime=null;
  const status=doc.getElementById('status'),seek=doc.getElementById('seek'),play=doc.getElementById('play');
  function draw(time) {
    if(video.seeking||video.readyState<2)return;
    const f=nearestFrame(report.frames,time);
    // Paint the video and observations together, so the compositor cannot move
    // the video ahead of an independently updated overlay canvas.
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const matched=f&&Math.abs(f.time-time)<=.6/report.video.fps;
    if(matched&&f.measured&&f.points) {
      for(let i=0;i<3;i++) {
        const p=f.points[i];ctx.strokeStyle=['#ff4d64','#32de8a','#51cfff'][i];ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(p[0],p[1],8,0,7);ctx.moveTo(p[0]-14,p[1]);ctx.lineTo(p[0]+14,p[1]);
        ctx.moveTo(p[0],p[1]-14);ctx.lineTo(p[0],p[1]+14);ctx.stroke();
      }
      if(f.corners){ctx.strokeStyle='white';ctx.beginPath();f.corners.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}
    }
    seek.value=time;
    status.textContent=`${time.toFixed(3)}s · ${precise?'video frame timestamp':'approximate playback clock'} · `+
      (matched?`${f.phase} · ${f.mode} · ${f.processingMs.toFixed(1)} ms · ${f.reason}`:'no matching observation');
  }
  if(precise) {
    const next=(_,metadata)=>{presentedTime=metadata.mediaTime;draw(presentedTime);video.requestVideoFrameCallback(next);};
    video.requestVideoFrameCallback(next);
  } else {
    const next=()=>{draw(video.currentTime);requestAnimationFrame(next);};next();
  }
  video.addEventListener('seeking',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);status.textContent='Seeking…';});
  video.addEventListener('seeked',()=>{
    if(presentedTime!==null&&Math.abs(presentedTime-video.currentTime)<.6/report.video.fps)draw(presentedTime);
  });
  video.addEventListener('loadedmetadata',()=>{seek.max=video.duration;});
  video.addEventListener('play',()=>{play.textContent='Pause';});
  video.addEventListener('pause',()=>{play.textContent='Play';});
  video.addEventListener('error',()=>{status.textContent='Cannot load the original recording. Check its local file path.';});
  play.onclick=()=>{if(video.paused)video.play().catch(e=>{status.textContent=e.message;});else video.pause();};
  seek.oninput=()=>{video.currentTime=Number(seek.value);};
  for(const [id,step] of [['previous',-1],['next',1]])doc.getElementById(id).onclick=()=>{
    video.pause();const f=nearestFrame(report.frames,Number(seek.value));
    const i=report.frames.indexOf(f);video.currentTime=report.frames[Math.max(0,Math.min(report.frames.length-1,i+step))].time;
  };
  for(const f of report.frames){
    const item=doc.createElement('i');item.style.background=f.measured?'#4c8':f.visible?'#eaa52c':'#ed5363';
    item.title=f.time.toFixed(3)+'s '+f.reason;item.onclick=()=>{video.currentTime=f.time;};doc.getElementById('timeline').append(item);
  }
  for(const d of report.dropouts){
    const b=doc.createElement('button');b.textContent=d.start.toFixed(2)+'–'+d.end.toFixed(2)+'s ('+Math.round(d.duration*1000)+' ms)';
    b.onclick=()=>{video.currentTime=Math.max(0,d.start-.2);};doc.getElementById('drops').append(b);
  }
}
function reportHtml(report) {
  const packed=JSON.stringify(report).replace(/</g,'\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>QR recording replay</title>
<style>body{font:16px system-ui;margin:24px auto;max-width:1100px;padding:0 16px;background:#15181d;color:#eee}canvas{width:100%;display:block;background:#000}video{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}pre{white-space:pre-wrap;font-size:13px}button{padding:8px;margin:4px}#seek{width:100%}#timeline{display:flex;height:22px;margin:16px 0}#timeline i{flex:1;cursor:pointer}</style>
<h1>QR recording replay</h1><p>Video and measured points are drawn together using video frame timestamps. Green: measured. Amber: held/predicted. Red: searching. Analysis cost is not browser FPS; coverage is not an accuracy score.</p>
<video id="video" playsinline preload="auto" src="${escape(pathToFileURL(report.video.path).href)}"></video><canvas id="canvas"></canvas>
<button id="play">Play</button><button id="previous">Previous frame</button><button id="next">Next frame</button><input id="seek" aria-label="Video time" type="range" min="0" max="${report.video.duration}" step="any" value="0">
<div id="timeline"></div><p id="status">Loading recording…</p><h2>Results</h2><pre>${escape(JSON.stringify(report.summary,null,2))}</pre><h2>Dropouts after initial acquisition</h2><div id="drops"></div>
<script>const report=${packed};${nearestFrame.toString()}\n${startViewer.toString()}\nstartViewer(report);</script>`;
}
module.exports={reportHtml,nearestFrame,startViewer};
if(require.main===module) {
  const fs=require('node:fs'),path=require('node:path'),input=process.argv[2];
  if(!input)throw Error('Usage: node scripts/qr-anchor/report.cjs path/to/report.json');
  const output=path.join(path.dirname(input),'report.html');
  fs.writeFileSync(output,reportHtml(JSON.parse(fs.readFileSync(input,'utf8'))));console.log(output);
}
