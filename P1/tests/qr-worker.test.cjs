const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {pathToFileURL}=require('node:url');
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {fixture,root,moduleHarness}=require('./helpers/qr-anchor.cjs');
function exchange(worker,data,transfer=[]) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('worker timeout'));},15000);
    const message=result=>{cleanup();result.type==='error'?reject(Error(result.message)):resolve(result);};
    const error=error=>{cleanup();reject(error);};
    const cleanup=()=>{clearTimeout(timer);worker.off('message',message);worker.off('error',error);};
    worker.on('message',message);worker.on('error',error);worker.postMessage(data,transfer);
  });
}
test('real worker uses the pixel tracker, transfers observations only, and recovers after loss',async()=>{
  const worker=new Worker(path.join(__dirname,'helpers/qr-worker-thread.cjs'),{workerData:{root}});
  try {
    const f=fixture({text:'qr7'});
    assert.equal((await exchange(worker,{type:'init',coreUrl:pathToFileURL(path.join(root,'portal/qr-anchor/core.js')).href,
      moduleUrl:pathToFileURL(path.join(root,'portal/QrAnchor.js')).href,options:{target:'qr7',cameraMotion:true,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}})).type,'ready');
    const frame=async (now,pixels)=>{
      const rgba=new Uint8ClampedArray(pixels);
      const promise=exchange(worker,{type:'frame',generation:1,now,time:now/1000,width:f.width,height:f.height,rgba},[rgba.buffer]);
      assert.equal(rgba.byteLength,0,'frame buffer ownership transfers to the worker');
      return promise;
    };
    const first=await frame(0,f.data);assert.equal(first.result.text,'qr7');assert.equal(first.result.decoded,true);assert.equal(first.diagnostics.sceneMotion.mode,'uncertain');
    const next=await frame(40,fixture({text:'qr7',position:[.12,0,3]}).data);
    assert.equal(next.observed,true);assert.equal(next.diagnostics.mode,'centres');
    assert.equal(next.result.tracking,undefined);assert.equal(next.result.centreTracking,undefined);
    assert.ok(next.result.analysisScale>0&&next.result.analysisScale<=1,'display receives pixel scale without image history');
    assert.ok(JSON.stringify(next).length<5000,'no image pyramid is cloned back');
    const blank=new Uint8ClampedArray(f.data.length);blank.fill(255);
    const lost=await frame(80,blank);assert.equal(lost.observed,false);assert.equal(lost.diagnostics.searchAttempted,undefined);
    const recovered=await frame(120,f.data);assert.equal(recovered.observed,true,JSON.stringify(recovered.diagnostics));assert.equal(recovered.result.decoded,false);
    worker.postMessage({type:'reset'});
    const restarted=await frame(160,f.data);assert.equal(restarted.result.decoded,true);
  } finally {await worker.terminate();}
});
function clientHarness() {
  const workers=[],captures=[];
  class FakeWorker {
    constructor(){this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(data){this.messages.push(data);if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));}
    terminate(){this.terminated=true;}
  }
  const c=vm.createContext({Worker:FakeWorker,URL,Blob,setTimeout,clearTimeout,createImageBitmap:()=>new Promise((resolve,reject)=>captures.push({resolve,reject})),console});
  vm.runInContext(fs.readFileSync(path.join(root,'portal/qr-anchor/worker-client.js'),'utf8'),c);
  return {c,workers,captures};
}
test('worker client has no frame queue and closes a capture invalidated by reset',async()=>{
  const h=clientHarness(),results=[],errors=[];
  const client=await h.c.PortalQrAnchorWorker.create('https://example.test/P1/portal/QrAnchor.js',{},r=>results.push(r),e=>errors.push(e));
  const video={currentTime:0,videoWidth:640,videoHeight:480};
  assert.equal(client.send(video,0),true);
  for(let i=1;i<20;i++)assert.equal(client.send(video,i*16),false);
  assert.equal(h.captures.length,1,'busy means no additional capture, not just no postMessage');
  let closed=0;client.reset();h.captures[0].resolve({close(){closed++;}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,1);assert.equal(client.busy,false);
  const motion={q:[0,0,0,1],time:400,epoch:2};client.send(video,400,motion);h.captures[1].resolve({close(){closed++;}});await new Promise(resolve=>setImmediate(resolve));
  const worker=h.workers[0],frame=worker.messages.find(m=>m.type==='frame');
  assert.ok(frame);assert.deepEqual(frame.motion,motion);client.reset();worker.onmessage({data:{type:'frame',generation:frame.generation}});
  assert.equal(results.length,0,'stale worker response cannot revive stopped/switched tracking');
  assert.equal(client.busy,false);client.dispose();assert.equal(worker.terminated,true);assert.equal(errors.length,0);
});
test('worker client releases resources on worker failure and cannot enqueue more work',async()=>{
  const h=clientHarness(),errors=[];
  const client=await h.c.PortalQrAnchorWorker.create('https://example.test/P1/portal/QrAnchor.js',{},()=>{},e=>errors.push(e));
  h.workers[0].onerror({message:'test worker failure'});
  assert.equal(client.disposed,true);assert.equal(h.workers[0].terminated,true);assert.equal(errors.length,1);
  assert.equal(client.send({},0),false);
});
test('display accepts worker observations without running analysis, and stop clears late work',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',kalmanFilter:true,renderSmoothingMs:60}).init();a.update();
  const r=a._result;a._resetTracking();let sent=0,resets=0,disposed=0;
  a._worker={send(){sent++;return true;},reset(){resets++;},dispose(){disposed++;}};
  a._core={...a._core,detect(){throw Error('main-thread decode forbidden');},trackCentres(){throw Error('main-thread tracking forbidden');}};
  h.setTime(40);h.video.currentTime=.04;a.update();assert.equal(sent,1);
  a._receiveWorker({now:40,observed:true,result:{...r,time:40},diagnostics:{mode:'centres',processingMs:12},status:'tracking'});
  assert.equal(a.getLatest().visible,true);assert.equal(a.getLatest().diagnostics.backend,'worker');
  a.stop();assert.equal(resets,1);assert.equal(a.getLatest().visible,false);
  a.dispose();assert.equal(disposed,1);
});

test('public init starts a real worker, uses RGBA capture fallback, and skips idle search captures',async()=>{
  const workers=[];
  class BrowserWorker {
    constructor() {
      this.worker=new Worker(path.join(__dirname,'helpers/qr-worker-thread.cjs'),{workerData:{root}});
      this.worker.on('message',data=>this.onmessage?.({data}));
      this.worker.on('error',error=>this.onerror?.(error));workers.push(this);
    }
    postMessage(data,transfer){this.worker.postMessage(data,transfer);}
    terminate(){this.terminated=true;return this.worker.terminate();}
  }
  const f=fixture({text:'qr7'}),clear=f.data;
  const h=moduleHarness(f,{Worker:BrowserWorker,OffscreenCanvas:class{},URL,Blob,setTimeout,clearTimeout,
    moduleUrl:pathToFileURL(path.join(root,'portal/QrAnchor.js')).href});
  h.c.loadScript=async name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),h.c);
  let a;
  try {
    a=await new h.c.QrAnchor({video:h.video,target:'qr7'}).init();
    assert.ok(a._worker,'default init must actually select the worker');
    a._core={...coreWithoutAnalysis(a._core)};
    const update=now=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('public worker timeout')),15000);
      a._receiveWorker=data=>{clearTimeout(timer);h.c.QrAnchor.prototype._receiveWorker.call(a,data);resolve(data);};
      h.setTime(now);h.video.currentTime=now/1000;a.update();
    });
    f.data=new Uint8ClampedArray(clear.length);f.data.fill(255);
    const first=await update(0);assert.equal(first.observed,false);assert.equal(first.nextScanAt,120);
    const captures=h.drawCalls.length;
    for(let now=40;now<120;now+=40){h.setTime(now);h.video.currentTime=now/1000;a.update();}
    assert.equal(h.drawCalls.length,captures,'idle search must skip capture, not merely analysis');
    // Simulated minute with no QR: the public path stays on the worker, and
    // searching does not accumulate display observations or a pending queue.
    for(let now=1000;now<=60000;now+=1000) {
      const reply=await update(now);
      assert.equal(reply.observed,false);assert.equal(a._worker.busy,false);
      assert.equal(a._result,null);assert.ok(JSON.stringify(reply).length<2000);
    }
    f.data=clear;await update(60120);
    assert.equal(a.getLatest().visible,true);assert.equal(a.getLatest().diagnostics.backend,'worker');
    a.stop();assert.equal(a.getLatest().visible,false);
    await update(60240);assert.equal(a.getLatest().visible,true,'reset releases the old identity and reacquires');
    a.dispose();assert.equal(workers[0].terminated,true);
  } finally {a?.dispose();await Promise.all(workers.map(w=>w.worker.terminate()));}
});
function coreWithoutAnalysis(core) {
  const result={...core};
  for(const key of ['detect','locate','track','trackCentres'])result[key]=()=>{throw Error('analysis ran on display thread');};
  return result;
}
