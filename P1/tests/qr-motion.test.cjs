const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {core,root,fixture,moduleHarness}=require('./helpers/qr-anchor.cjs');
const points=Array.from({length:30},(_,i)=>[30+(i%6)*48,30+Math.floor(i/6)*40]);
const pairs=(dx,dy=0)=>points.map(from=>({from,to:[from[0]+dx,from[1]+dy]}));
const input=(now,dx=2,marker=dx)=>({pairs:pairs(dx),markerPairs:pairs(marker),width:320,height:240,now});
test('scene flow needs sustained distributed agreement and revokes immediately',()=>{
 const c=new core.SceneMotion();
 for(let t=0;t<600;t+=100)assert.equal(c.update(input(t)).mode,'uncertain');
 assert.equal(c.update(input(600)).mode,'camera-moving');
 assert.equal(c.update(input(700,2,9)).mode,'marker-moving');
 assert.equal(c.update(input(800)).mode,'uncertain');
 assert.equal(c.update(input(900,0)).mode,'still');
 assert.equal(c.update({...input(1000),pairs:[]}).mode,'uncertain');
 assert.equal(c.update({...input(1100),markerPairs:[]}).mode,'uncertain');
 assert.equal(c.update(input(2000)).reason,'frame gap');
});
test('robust background consensus rejects concentrated support and tolerates minority outliers',()=>{
 const c=new core.SceneMotion();
 for(let t=0;t<=700;t+=100){const f=input(t);f.pairs[2].to=[300,0];f.pairs[9].to=[0,200];c.update(f);}
 assert.equal(c.state.mode,'camera-moving');
 const local=pairs(2).map(p=>({from:p.from.map(v=>v/3),to:[p.from[0]/3+2,p.from[1]/3]}));
 assert.equal(c.update({...input(800),pairs:local}).reason,'background concentrated in one region');
});
test('gyro agreement is separate from visual agreement; stale, malformed, reset samples rejected',()=>{
 const c=new core.SceneMotion();
 for(let t=0;t<=700;t+=100)c.update({...input(t),gyroPredict:p=>[p[0]+2,p[1]]});
 assert.equal(c.state.gyroConsistent,true);
 assert.equal(c.update({...input(800),gyroPredict:p=>[p[0]-8,p[1]]}).gyroConsistent,false);
 const a={q:[0,0,0,1],time:0,epoch:1},b={q:[0,Math.sin(.01),0,Math.cos(.01)],time:100,epoch:1};
 const q=core.gyroDelta(a,b,100);assert.ok(q);
 assert.ok(core.gyroProject([160,120],q,{fx:300,fy:300,cx:160,cy:120})[0]<160);
 assert.equal(core.gyroDelta(a,b,300),null);
 assert.equal(core.gyroDelta(a,{...b,epoch:2},100),null);
 assert.equal(core.gyroDelta(a,{...b,q:[0,0,1]},100),null);
});
test('real pixel patches independently measure scene and QR-region translation',()=>{
 const w=320,h=240,corners=[[100,70],[220,70],[220,180],[100,180]];
 const image=(shift)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   // Textured patches survive coarse pyramid sampling.
   const xx=x-shift,v=127+55*Math.sin(xx*.23)+55*Math.cos(y*.27)+20*Math.sin(xx*.13+y*.17);
   const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
  }
  return core.prepareTrackingFrame(data,w,h);
 };
 const a=image(0),b=image(2),background=core.sceneFeatures(a,corners),marker=core.sceneFeatures(a,corners,true);
 const bg=core.sceneFlow(a,b,background),qr=core.sceneFlow(a,b,marker);
 assert.ok(bg.length>=8,`background ${bg.length}`);assert.ok(qr.length>=8,`QR ${qr.length}`);
 for(const p of [...bg,...qr])assert.ok(Math.abs(p.to[0]-p.from[0]-2)<.3);
 const c=new core.SceneMotion();for(let now=0;now<=700;now+=100)c.update({pairs:bg,markerPairs:qr,width:w,height:h,now});
 assert.equal(c.state.mode,'camera-moving');
});
test('sensor permission, screen changes, gaps and disposal invalidate stale rotations',async()=>{
 let now=0,listener=null,removed=0;
 const c=vm.createContext({performance:{now:()=>now},screen:{orientation:{angle:0}},DeviceMotionEvent:{requestPermission:async()=> 'granted'},
 addEventListener:(name,fn)=>listener=fn,removeEventListener:()=>{listener=null;removed++;}});
 vm.runInContext(fs.readFileSync(path.join(root,'portal/qr-anchor/motion-sensor.js'),'utf8'),c);
 const s=new c.PortalQrMotionSensor();s.start();assert.equal(s.status,'permission-needed');assert.equal(listener,null);
 assert.equal(await s.requestPermission(),true);assert.ok(listener);
 listener({rotationRate:{alpha:0,beta:0,gamma:10}});now=20;listener({rotationRate:{alpha:0,beta:0,gamma:10}});
 const sample=s.sample();assert.ok(sample.q[1]<0);
 c.screen.orientation.angle=90;now=40;listener({rotationRate:{alpha:0,beta:0,gamma:10}});assert.notEqual(s.sample().epoch,sample.epoch);
 now=500;assert.equal(s.sample(),null);s.stop();s.start();assert.ok(listener);s.dispose();assert.equal(listener,null);assert.ok(removed>=2);
 assert.equal(await s.requestPermission(),false);
});
test('motion assistance is opt-in, bounded to search, and reset with tracking',async()=>{
 const f=fixture(),h=moduleHarness(f),a=await new h.c.QrAnchor({video:h.video,cameraMotion:true}).init();
 a.update();assert.ok(a.getLatest().diagnostics.sceneMotion);assert.equal(a.getLatest().visible,true);
 const prior=a._centreResult||a._reliableResult;prior.motionSample={q:[0,0,0,1],time:0,epoch:1};
 a._frameMotion={q:[0,Math.sin(.01),0,Math.cos(.01)],time:100,epoch:1};
 a._sceneClassifier.state={mode:'camera-moving',gyroConsistent:true};a._sceneFrame.time=100;
 const old=a._result.pose;a._prepareMotionHint(100,a._intrinsics(f.width,f.height));assert.equal(a._diagnostics.gyroAssisted,true);assert.strictEqual(a._result.pose,old);
 a._sceneClassifier.state.mode='uncertain';a._prepareMotionHint(100,a._intrinsics(f.width,f.height));assert.equal(a._gyroPoints,null);
 a.stop();assert.equal(a._sceneFrame,null);assert.equal(a._sceneClassifier.state.mode,'uncertain');
});
