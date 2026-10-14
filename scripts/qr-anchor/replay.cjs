#!/usr/bin/env node
// Replay actual video pixels through QrAnchor with recording timestamps, no browser.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {performance}=require('node:perf_hooks');
const {moduleHarness,root}=require('../../P1/tests/helpers/qr-anchor.cjs');
const args=process.argv.slice(2),video=args.shift(),options={width:1280,target:'qr7',output:path.join(os.tmpdir(),'portal-qr-replay')};
for(let i=0;i<args.length;i+=2){if(!['--width','--target','--output','--baseline'].includes(args[i])||!args[i+1])throw Error('Unknown or missing option: '+args[i]);options[args[i].slice(2)]=args[i+1];}
const hashFile=async file=>{const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
const percentile=(values,f)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*f))]||0;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reportHtml(report) {
 const packed=JSON.stringify(report).replace(/</g,'\\u003c');
 return `<!doctype html><meta charset="utf-8"><title>QR recording replay</title><style>body{font:16px system-ui;margin:24px auto;max-width:1100px;padding:0 16px;background:#15181d;color:#eee}a{color:#83d7ff}.preview{position:relative}video{width:100%;display:block}canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}pre{white-space:pre-wrap;font-size:13px}button{padding:8px;margin:4px}#timeline{display:flex;height:22px;margin:16px 0}#timeline i{flex:1}table{border-collapse:collapse}td,th{padding:7px;text-align:left;border-bottom:1px solid #555}</style><h1>QR recording replay</h1><p>Fixed video frames and timestamps. Green: measured. Amber: held/predicted. Red: searching. This measures analysis cost, not browser FPS. Detection coverage is not an accuracy score.</p><div class="preview"><video id="video" controls src="${escape(pathToFileURL(report.video.path).href)}"></video><canvas id="canvas"></canvas></div><div id="timeline"></div><p id="status"></p><h2>Results</h2><pre>${escape(JSON.stringify(report.summary,null,2))}</pre><h2>Dropouts after initial acquisition</h2><div id="drops"></div><script>const report=${packed};const video=document.getElementById('video'),canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');canvas.width=report.video.width;canvas.height=report.video.height;const timeline=document.getElementById('timeline');for(const f of report.frames){const item=document.createElement('i');item.style.background=f.measured?'#4c8':f.visible?'#eaa52c':'#ed5363';item.title=f.time.toFixed(3)+'s '+f.reason;item.onclick=()=>video.currentTime=f.time;timeline.append(item);}for(const d of report.dropouts){const b=document.createElement('button');b.textContent=d.start.toFixed(2)+'–'+d.end.toFixed(2)+'s ('+Math.round(d.duration*1000)+' ms)';b.onclick=()=>video.currentTime=Math.max(0,d.start-.2);document.getElementById('drops').append(b);}function draw(){const t=video.currentTime;let f=report.frames[0];for(const item of report.frames){if(item.time>t+.001)break;f=item;}ctx.clearRect(0,0,canvas.width,canvas.height);if(f.measured&&f.points){for(let i=0;i<3;i++){const p=f.points[i];ctx.strokeStyle=['#ff4d64','#32de8a','#51cfff'][i];ctx.lineWidth=2;ctx.beginPath();ctx.arc(p[0],p[1],8,0,7);ctx.moveTo(p[0]-14,p[1]);ctx.lineTo(p[0]+14,p[1]);ctx.moveTo(p[0],p[1]-14);ctx.lineTo(p[0],p[1]+14);ctx.stroke();}ctx.strokeStyle='white';ctx.beginPath();f.corners.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}document.getElementById('status').textContent=f.time.toFixed(3)+'s · '+f.phase+' · '+f.mode+' · '+f.processingMs.toFixed(1)+' ms · '+f.reason;requestAnimationFrame(draw);}draw();</script>`;
}
async function main() {
 if(!video)throw Error('Usage: node scripts/qr-anchor/replay.cjs recording.mov [--output directory] [--width 1280] [--target qr7] [--baseline report.json]');
 if(process.platform!=='darwin')throw Error('This local video decoder requires macOS AVFoundation and Swift.');
 const input=path.resolve(video),out=path.resolve(options.output);fs.mkdirSync(out,{recursive:true});
 const swift=path.join(__dirname,'video-frames.swift'),cache=path.join(os.tmpdir(),'portal-qr-video-decoder');fs.mkdirSync(cache,{recursive:true});
 const binary=path.join(cache,'frames'),signature=await hashFile(swift);
 if(!fs.existsSync(binary)||!fs.existsSync(binary+'.sha256')||fs.readFileSync(binary+'.sha256','utf8')!==signature){
   const compile=spawnSync('swiftc',['-O','-suppress-warnings','-module-cache-path',path.join(cache,'modules'),swift,'-o',binary],{encoding:'utf8'});
   if(compile.status!==0)throw Error(compile.stderr||'Swift decoder compilation failed');fs.writeFileSync(binary+'.sha256',signature);
 }
 const inputHash=await hashFile(input),codeHash=createHash('sha256');
 for(const name of ['portal/QrAnchor.js','portal/qr-anchor/core.js'])codeHash.update(fs.readFileSync(path.join(root,name)));
 const config={target:options.target,maxWidth:640,fps:30,worker:false,centreTracking:true,kalmanFilter:true,smoothing:.4,renderSmoothingMs:60};
 const child=spawn(binary,[input,String(Number(options.width))],{stdio:['ignore','pipe','pipe']});
 let stderr='',buffer=Buffer.alloc(0),meta,h,anchor,frame,fixedSize,firstSeen=null,activeDrop=null,previousState='',count=0;
 const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(stderr||'Video decode failed')));});
 completion.catch(()=>{});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
 const frames=[],dropouts=[],events=[];
 try {
   for await(const chunk of child.stdout) {
     buffer=Buffer.concat([buffer,chunk]);
     if(!meta){const end=buffer.indexOf(10);if(end<0)continue;meta=JSON.parse(buffer.subarray(0,end));buffer=buffer.subarray(end+1);fixedSize=meta.width*meta.height*4+8;
       frame={width:meta.width,height:meta.height,data:null};h=moduleHarness(frame);anchor=await new h.c.QrAnchor({...config,video:h.video}).init();
     }
     while(buffer.length>=fixedSize) {
       const time=buffer.readDoubleLE(0),now=time*1000;
       frame.data=new Uint8ClampedArray(buffer.buffer,buffer.byteOffset+8,fixedSize-8);buffer=buffer.subarray(fixedSize);
       h.setTime(now);h.video.currentTime=time;
       const started=performance.now();anchor.update(now);const processingMs=performance.now()-started;
       const latest=anchor.getLatest(now),d=latest.diagnostics,measured=anchor._lastSeen===now;
       const row={index:count++,time,measured,visible:latest.visible,phase:d.phase||'search',mode:measured?d.mode:'',processingMs,
         reason:measured?'':d.centreReason||d.trackingReason||latest.statusMessage,decoded:measured&&!!anchor._result.decoded,
         points:measured?latest.finderCentres:null,corners:measured?latest.corners:null,
         search:!!d.searchAttempted,crop:[d.cropWidth||0,d.cropHeight||0],localSearches:d.centreLocalSearches||0,checks:d.centreChecks||null};
       frames.push(row);
       const state=measured?row.mode:row.phase;
       if(state!==previousState){events.push({time,state,reason:row.reason});previousState=state;}
       if(measured){if(firstSeen===null)firstSeen=time;if(activeDrop){activeDrop.end=time;activeDrop.duration=time-activeDrop.start;dropouts.push(activeDrop);activeDrop=null;}}
       else if(firstSeen!==null&&!activeDrop)activeDrop={start:time,reason:row.reason};
       // The test harness normally records draw calls. Replay deliberately bounds
       // that bookkeeping so a long fixture cannot create an artificial leak.
       h.drawCalls.length=0;
       if(count%60===0)process.stderr.write('Replayed '+count+' frames ('+time.toFixed(1)+' s)\n');
     }
   }
   await completion;
   if(!frames.length||buffer.length)throw Error('Missing or truncated video frames');
 } finally {child.kill();anchor?.dispose();}
 const end=frames.at(-1).time+1/meta.fps;
 if(activeDrop){activeDrop.end=end;activeDrop.duration=end-activeDrop.start;dropouts.push(activeDrop);}
 const times=frames.map(f=>f.processingMs),measured=frames.filter(f=>f.measured).length;
 const summary={frames:frames.length,measuredFrames:measured,measurementCoverage:measured/frames.length,firstAcquisitionSeconds:firstSeen,
   decodedFrames:frames.filter(f=>f.decoded).length,dropouts:dropouts.length,longestDropoutMs:Math.max(0,...dropouts.map(d=>d.duration*1000)),
   analysisMedianMs:percentile(times,.5),analysisP95Ms:percentile(times,.95),analysisMaxMs:Math.max(...times)};
 const report={schema:1,created:new Date().toISOString(),video:{...meta,path:input,sha256:inputHash},codeSha256:codeHash.digest('hex'),config,summary,dropouts,events,frames};
 if(options.baseline){const old=JSON.parse(fs.readFileSync(options.baseline,'utf8'));
   if(old.video.sha256!==inputHash||old.video.width!==meta.width||JSON.stringify(old.config)!==JSON.stringify(config))throw Error('Baseline input/config differs; results are not comparable');
   report.comparison={measuredFramesDelta:measured-old.summary.measuredFrames,dropoutsDelta:summary.dropouts-old.summary.dropouts,longestDropoutMsDelta:summary.longestDropoutMs-old.summary.longestDropoutMs,analysisP95MsDelta:summary.analysisP95Ms-old.summary.analysisP95Ms};
   report.regression=report.comparison.measuredFramesDelta< -2||report.comparison.longestDropoutMsDelta>100;
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'report.html'),reportHtml(report));
 console.log(JSON.stringify({summary,comparison:report.comparison,regression:report.regression,report:path.join(out,'report.html')},null,2));
 if(report.regression)process.exitCode=2;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
