const {test}=require('node:test');
const assert=require('node:assert/strict');
const {core,fixture,moduleHarness}=require('./helpers/qr-anchor.cjs');
const k={fx:600,fy:600,cx:320,cy:240};
const pose=(a,position=[0,0,6])=>({rotation:[Math.cos(a),0,-Math.sin(a),0,-1,0,-Math.sin(a),0,-Math.cos(a)],position});

test('subpixel finder-corner noise through the actual pose solver produces less visible tilt',()=>{
  const truth=pose(0),dim=21;
  const src=[[0,0],[14,0],[0,14]].flatMap(([x,y])=>[[x+2,y+2],[x+5,y+2],[x+5,y+5],[x+2,y+5]]);
  const dst=src.map(([x,y])=>core.project(truth,[x/dim-.5,.5-y/dim,0],k));
  const filter=new core.RotationFilter();filter.observe(truth,k,1,0);
  let raw=0,filtered=0;
  for(let i=1;i<=120;i++) {
    const observed=dst.map((p,j)=>[p[0]+.35*Math.sin(i*1.9+j*2.5),p[1]+.35*Math.cos(i*2.3+j*1.7)]);
    const measured=core.estimatePose(src,observed,k,1,dim),r=filter.observe(measured,k,1,i*1000/30);
    raw+=measured.rotation[2]**2+measured.rotation[5]**2;filtered+=r[2]**2+r[5]**2;
  }
  assert.ok(Math.sqrt(filtered/raw)<.4,'at least 60% reduction in tilt RMS from known subpixel measurement noise');
});

test('uncertain tilt jitter is suppressed but a clear deliberate tilt responds quickly',()=>{
  const filter=new core.RotationFilter();filter.observe(pose(0),k,1,0);
  let max=0;
  for(let i=1;i<=120;i++) {
    const input=pose(i%2?.08:-.08),r=filter.observe(input,k,1,i*1000/30);
    max=Math.max(max,Math.abs(r[2]));
    assert.deepEqual(input,pose(i%2?.08:-.08),'raw pose is untouched');
  }
  assert.ok(max<Math.sin(.08)*.2,'at least 80% less alternating tilt');
  const next=filter.observe(pose(.5),k,1,4000+1000/30);
  assert.ok(Math.asin(-next[2])>.35,'clear 29-degree tilt follows by over 20 degrees in one frame');
  for(let i=2;i<=30;i++)filter.observe(pose(.5),k,1,4000+i*1000/30);
  assert.ok(Math.abs(Math.asin(-filter.rotation[2])-.5)<.005,'small sustained tilt is not frozen by a deadband');
});
test('rotation damping is time based, resolution independent and resets after a gap',()=>{
  const run=(fps,scale)=>{
    const f=new core.RotationFilter(),kk={fx:k.fx*scale,fy:k.fy*scale,cx:k.cx*scale,cy:k.cy*scale};f.observe(pose(0),kk,1,0);
    for(let i=1;i<=fps;i++)f.observe(pose(.04,[.1*i/fps,0,6]),kk,1,i*1000/fps,1.25*scale);
    return f;
  };
  const a=run(30,1),b=run(60,3);
  assert.ok(Math.abs(a.rotation[2]-b.rotation[2])<1e-6);
  assert.deepEqual(Array.from(a.observe(pose(.6),k,1,2000)),pose(.6).rotation);
});
test('display rotation stabilization leaves raw tracking, identity and position unchanged',async()=>{
  const f=fixture(),h=moduleHarness(f),a=await new h.c.QrAnchor({video:h.video,smoothing:1,rotationStabilization:true}).init();
  a.update();const base=a._result;
  const changed={...base,pose:pose(.08,[.2,0,6]),time:33};
  h.setTime(33);a._acceptResult(changed,true,33);
  assert.equal(a._result.pose,changed.pose);
  const shown=a.getLatest(33);
  assert.deepEqual(Array.from(shown.pose.position),[.2,0,6],'rotation filter adds no position lag');
  assert.equal(shown.finderCentres,base.finderCentres);
  assert.equal(a._lastSeen,33);
  assert.notDeepEqual(Array.from(shown.pose.rotation),Array.from(changed.pose.rotation));
  a.stop();assert.equal(a._rotationFilter,null);
});
