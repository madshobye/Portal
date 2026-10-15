const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {core,context,fixture,root,cropPixels,htmlNode,moduleHarness}=require('./helpers/qr-anchor.cjs');
const comparisonOptions={centreTracking:false,patternIntervalMs:0,recoveryMs:0,roiPadding:.35,lostAfterMs:180};
for(const [name,options] of [
  ['front-facing version 1',{}],
  ['perspective version 1',{angles:[.45,-.4,.25]}],
  ['rotated version 1',{angles:[-.3,.4,1.8]}],
  ['version 2',{version:2,angles:[.3,-.3,-.25]}],
  ['off-centre noisy image',{position:[.3,-.2,3.5],angles:[.3,.4,-.2],noise:12}],
]) test(`real QR pixels: ${name}`,()=>{
  const f=fixture(options),result=core.detect(f.data,f.width,f.height,{intrinsics:f.intrinsics});
  assert.ok(result,'must detect qr2');assert.equal(result.text,'qr2');assert.equal(result.dimension,f.qr.size);
  assert.ok(Math.abs(result.pose.position[2]-f.pose.position[2])<.12,`depth ${result.pose.position[2]}`);
  const top=[0,0,.5],estimated=core.project(result.pose,top,f.intrinsics),truth=core.project(f.pose,top,f.intrinsics);
  assert.ok(Math.hypot(estimated[0]-truth[0],estimated[1]-truth[1])<8,`3D cube apex error: ${estimated} vs ${truth}`);
  assert.ok(result.pose.reprojectionError<3);
});
test('rejects another payload and blank frames',()=>{
  const f=fixture({text:'qr3'});
  assert.equal(core.detect(f.data,f.width,f.height,{intrinsics:f.intrinsics}),null);
  f.data.fill(255);assert.equal(core.detect(f.data,f.width,f.height,{intrinsics:f.intrinsics}),null);
});

test('module uses supplied video, preserves QrReader globals, expires stale poses and stops only itself',async()=>{
  const f=fixture(),h=moduleHarness(f),sentinel=h.c.ZXing;
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:{elt:h.video},intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  anchor.start();assert.equal(anchor.getLatest().visible,true);assert.equal(h.timers.size,1);
  anchor.start();assert.equal(h.timers.size,1);
  assert.equal(h.c.ZXing,sentinel);
  // Same paused video frame must not refresh the lastSeen timestamp.
  const captures=h.drawCalls.length;
  h.setTime(250);anchor.update();assert.equal(anchor.getLatest().visible,false);
  assert.equal(h.drawCalls.length,captures);
  h.video.currentTime=1;anchor.update();assert.equal(anchor.getLatest().visible,true);
  const projected=anchor.projectPoint(0,0,0);assert.ok(Math.abs(projected.x-195)<2);assert.ok(Math.abs(projected.y-422)<2);
  anchor.stop();assert.equal(h.timers.size,0);assert.equal(anchor.getLatest().visible,false);
  anchor.start();assert.equal(anchor.getLatest().visible,true);
  anchor.dispose();assert.equal(h.timers.size,0);assert.throws(()=>anchor.start(),/init/);
  // Existing reader can still be loaded and constructed without new global collisions.
  vm.runInContext(fs.readFileSync(path.join(root,'portal/QrReader.js'),'utf8'),h.c);
  assert.equal(vm.runInContext('new QrReader({video:{elt:{}}}).getLatest().result',h.c),null);
});
test('drawing helper renders five cube faces and matches camera cover cropping',async()=>{
  const f=fixture({angles:[.35,-.4,.2]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();anchor.update();
  const shapes=[],cameraArgs=[];
  const g={CLOSE:'close',push(){},pop(){},stroke(){},strokeWeight(){},fill(){},
    beginShape(){shapes.push([]);},vertex(x,y){assert.ok(Number.isFinite(x+y));shapes.at(-1).push([x,y]);},endShape(mode){assert.equal(mode,'close');},
    drawingContext:{save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(...args){cameraArgs.push(args);}}};
  const rect={x:20,y:30,width:300,height:500};
  anchor.drawCamera(rect,g);anchor.drawCube({rect,target:g});
  assert.equal(shapes.length,5);assert.ok(shapes.every(p=>p.length===4));
  const [,x,y,w,hh]=cameraArgs[0];assert.ok(Math.abs(hh-500)<1e-9);assert.ok(Math.abs(y-30)<1e-9);assert.ok(w>300&&x<20);
  const p=anchor.projectPoint(0,0,0,rect);assert.ok(Math.abs(p.x-170)<2&&Math.abs(p.y-280)<2);
});
test('missing and invalid configuration fail clearly; capture failures remove the anchor',async()=>{
  const f=fixture(),h=moduleHarness(f);
  assert.throws(()=>new h.c.QrAnchor({...comparisonOptions,markerSize:0}),/markerSize/);
  assert.throws(()=>new h.c.QrAnchor({...comparisonOptions,intrinsics:{fx:1}}),/intrinsics/);
  await assert.rejects(new h.c.QrAnchor().init(),/existing video/);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video}).init();anchor.start();
  anchor._context.getImageData=()=>{throw new Error('Cannot read frame');};h.setTime(100);h.video.currentTime=2;
  anchor.update();assert.equal(anchor.getLatest().status,'error');assert.equal(anchor.running,false);
  assert.equal(anchor.getLatest().pose,null);assert.equal(h.timers.size,0);
});
test('wrong QR and lost marker do not leave a permanent cube',async()=>{
  const f=fixture(),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video}).init();anchor.update();assert.ok(anchor.getLatest().visible);
  const other=fixture({text:'qr3'});f.data=other.data;
  h.setTime(60);h.video.currentTime=1;anchor.update();assert.ok(anchor.getLatest().visible,'short loss grace period');
  h.setTime(250);h.video.currentTime=2;anchor.update();assert.equal(anchor.getLatest().visible,false);
});
test('bundled detector cannot open the camera or change the legacy ZXing global',()=>{
  const source=fs.readFileSync(path.join(root,'portal/qr-anchor/core.js'),'utf8');
  assert.doesNotMatch(source,/getUserMedia|enumerateDevices|decodeFromVideoDevice|navigator\.mediaDevices/);
  assert.equal(context.ZXing,undefined);
});

for(const centres of [false,true]) test(`complete example boots with square centres ${centres}`,async()=>{
  const text='qr7';
  const f=fixture({text}),h=moduleHarness(f),loads=[],events={};
  let captures=0,boxes=0,markers=0,wireframes=0,removed=false,debug=true,rings=0,vertices=0,masks=0;
  const layer={width:640,height:480,clear(){},push(){},pop(){},resetMatrix(){},_renderer:{camera(){},frustum(){}},
    scale(){},applyMatrix(){},translate(){},fill(){},noFill(){wireframes++;},stroke(){},strokeWeight(){},
    rotateX(){},rotateY(){},rotateZ(){},noStroke(){},beginShape(){},endShape(){},
    vertex(...p){assert.ok(p.every(Number.isFinite));vertices++;},torus(){rings++;},
    ellipse(...args){assert.deepEqual(args,[0,0,3,3]);masks++;},
    box(...dimensions){boxes++;assert.deepEqual(dimensions,[1,1,.6]);},remove(){removed=true;},resizeCanvas(){}};
  Object.assign(h.c,{windowWidth:640,windowHeight:480,WEBGL:'webgl',TRIANGLES:'triangles',LINES:'lines',POINTS:'points',
    uiIsDebugOverlayVisible:()=>debug,
    async loadScript(url){loads.push(url);},
    async setupWebcamera(front,w,hh,flipped){captures++;assert.equal(front,false);assert.equal(w,1920);assert.equal(hh,1080);assert.equal(flipped,false);return {elt:h.video};},
    createCanvas(w,hh){h.c.width=w;h.c.height=hh;},resizeCanvas(){},background(){},
    createGraphics(w,hh,mode){assert.equal(mode,'webgl');return layer;},
    image(g){assert.equal(g,layer);},addEventListener(name,fn){events[name]=fn;},
    drawingContext:{save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){},arc(){markers++;},moveTo(){},lineTo(){},stroke(){},fillText(){}},
  });
  h.c.window=h.c;h.c.location.search=`?tracker=${centres?'centres':'corners'}`;
  vm.runInContext(fs.readFileSync(path.join(root,'sketches/qr-anchor/sketch.js'),'utf8'),h.c);
  await vm.runInContext('setup()',h.c);vm.runInContext('draw()',h.c);
  assert.equal(captures,1);assert.deepEqual(loads,['portal/QrAnchor.js']);assert.equal(boxes,1);assert.equal(wireframes,1);assert.equal(markers,3);
  const overlay=vm.runInContext('overlay',h.c);
  assert.equal(overlay.status.textContent,`${text}: decoded · pose OK`);
  assert.match(overlay.confidence.textContent,/Pattern match: 100%/);
  assert.equal(overlay.log.children.length,1);
  vm.runInContext('draw();draw();',h.c);assert.equal(overlay.log.children.length,1,'same state is logged only once');
  const toggle=overlay.panel.children[1].children[0];
  assert.equal(toggle.checked,centres);
  toggle.checked=!centres;toggle.onchange();vm.runInContext('draw()',h.c);
  assert.equal(vm.runInContext('anchor.centreTracking',h.c),!centres);
  assert.equal(overlay.log.children.length,2,'changing the tracker logs its state');
  const kalmanToggle=overlay.panel.children[2].children[0];assert.equal(kalmanToggle.checked,true);
  kalmanToggle.checked=false;kalmanToggle.onchange();vm.runInContext('draw()',h.c);
  assert.equal(vm.runInContext('anchor.kalmanFilter',h.c),false);
  assert.equal(vm.runInContext('anchor._kalman',h.c),null);
  assert.match(overlay.log.children[0].textContent,/Kalman off/);
  for(let i=0;i<12;i++) vm.runInContext(`startupError='test state ${i}';draw()`,h.c);
  assert.equal(overlay.log.children.length,7,'history stays bounded');
  assert.equal(overlay.panel.hidden,false);
  const debugBoxes=boxes,debugMarkers=markers;
  assert.equal(rings,0,'the scene is not drawn while debugging');
  assert.equal(masks,0,'debugging leaves the camera QR visible');
  debug=false;vm.runInContext('draw()',h.c);
  assert.equal(overlay.panel.hidden,true,'console follows Portal debug visibility');
  assert.equal(boxes,debugBoxes,'no debug cube in presentation mode');
  assert.equal(markers,debugMarkers,'no finder markers in presentation mode');
  assert.equal(rings,2);assert.ok(vertices>500,'3D sculpture and particle trails are rendered');
  assert.equal(masks,1,'presentation covers the QR with a black marker-space circle');
  debug=true;vm.runInContext('draw()',h.c);
  assert.equal(overlay.panel.hidden,false);assert.equal(boxes,debugBoxes+1);assert.equal(markers,debugMarkers+3);
  assert.equal(rings,2,'turning debug back on stops the animated scene');
  assert.equal(masks,1,'turning debug back on also removes the QR mask');
  events.pagehide();assert.equal(h.timers.size,0);assert.equal(removed,true);assert.equal(h.c.document.body.children.length,0);
});

test('custom WebGL drawing uses the marker pose, restores state and stops after loss',async()=>{
  const f=fixture(),h=moduleHarness(f),a=await new h.c.QrAnchor({video:h.video}).init();a.update();
  let pushes=0,pops=0,matrix=null,draws=0;
  const layer={width:640,height:480,push(){pushes++;},pop(){pops++;},resetMatrix(){},
    _renderer:{camera(){},frustum(){}},scale(){},applyMatrix(m){matrix=m;}};
  a.drawWebGL({target:layer},(g,state)=>{assert.equal(g,layer);assert.equal(matrix,state.pose.matrix);draws++;});
  assert.equal(draws,1);assert.equal(pushes,pops);
  assert.throws(()=>a.drawWebGL({target:layer},()=>{throw Error('model failed');}),/model failed/);
  assert.equal(pushes,pops,'a model error cannot leak its matrix/style stack');
  h.setTime(1000);a.drawWebGL({target:layer},()=>draws++);
  assert.equal(draws,1,'no model is drawn after the anchor expires');
});

test('timer includes processing time and yields without queuing catch-up work',async()=>{
  const h=moduleHarness(fixture()),anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,fps:30}).init();
  let duration=12,calls=0;
  anchor.update=()=>{calls++;h.advanceTime(duration);};
  anchor.start();assert.ok(Math.abs([...h.delays.values()][0]-(1000/30-12))<1e-6);
  duration=50;h.runTimer();assert.equal([...h.delays.values()][0],0);
  assert.equal(calls,2);assert.equal(h.timers.size,1);
  anchor.stop();assert.equal(h.timers.size,0);
});

test('corner tracking skips finder detection and payload decoding, but rejects a changed QR',async()=>{
  const f=fixture({width:1280,height:720,focal:1000,position:[.45,-.15,5]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  let detections=0;anchor._core={...core,detect(...args){detections++;return core.detect(...args);}};
  anchor.update();assert.ok(anchor.getLatest().visible);assert.ok(anchor._result.decoded);
  const reference=anchor._reference,captures=h.drawCalls.length;
  for(let t=50;t<=650;t+=50) {
    h.setTime(t);h.video.currentTime=t/1000;anchor.update();
    assert.equal(anchor._lastSeen,t,'fresh geometry on every frame');
    assert.equal(anchor._result.decoded,false,'stable corners earn longer reuse');
    assert.equal(detections,1,'no finder or decoder call on the corner tracking path');
    assert.equal(anchor._reference,reference,'reference is immutable between actual decodes');
    assert.ok(h.drawCalls.at(-1).w<500&&h.drawCalls.at(-1).h<500,'reads small native ROI');
  }
  assert.equal(h.drawCalls.length,captures+13,'one crop per tracked frame, no full-frame search');
  assert.equal(anchor.getLatest().frameWidth,1280);
  const truth=core.project(f.pose,[0,0,.4],f.intrinsics);
  const projected=anchor.projectPoint(0,0,.4,{x:0,y:0,width:f.width,height:f.height});
  assert.ok(Math.hypot(projected.x-truth[0],projected.y-truth[1])<6,'crop intrinsics preserve native projection');
  f.data=fixture({text:'qr3',width:1280,height:720,focal:1000,position:[.45,-.15,5]}).data;
  h.setTime(700);h.video.currentTime=.7;anchor.update();
  assert.equal(anchor._lastSeen,650,'wrong payload must not refresh cached identity');
  assert.equal(anchor._misses,1);
  h.setTime(850);h.video.currentTime=.85;anchor.update();
  assert.equal(anchor.getLatest().visible,false);
});

test('small QR is recovered from native crop when the coarse image cannot fit its outlines',async()=>{
  const f=fixture({width:1280,height:720,focal:1000,position:[.2,-.1,18],angles:[.4,-.35,.2]}),h=moduleHarness(f);
  const coarse=cropPixels(f,0,0,f.width,f.height,640,360);
  const low=core.detect(coarse,640,360,{intrinsics:{fx:500,fy:500,cx:320,cy:180}});
  assert.ok(!low,'28-pixel tilted QR cannot supply the old full-frame pose fit');
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  anchor.update();assert.ok(anchor.getLatest().visible,'native 56-pixel QR yields an anchor');
  assert.ok(Math.abs(anchor.getLatest().pose.position[2]-18)<1);
  assert.ok(h.drawCalls.some(c=>c.w<250&&c.width===c.w),'crop keeps original camera detail');
});

test('failed coarse search uses higher resolution occasionally, not on every frame',async()=>{
  const f=fixture({width:1280,height:720});f.data.fill(255);
  const h=moduleHarness(f),anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video}).init();
  for(const t of [0,50,100,1050]) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  assert.deepEqual(h.drawCalls.map(c=>c.width),[640,1280,640,640,640,1280]);
  assert.equal(anchor.getLatest().visible,false);
});

test('losing the ROI expands the search then reacquires without smoothing a stale pose',async()=>{
  const f=fixture({width:1280,height:720,focal:1000,position:[-.9,0,4]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  anchor.update();assert.ok(anchor.getLatest().visible);
  const moved=fixture({width:1280,height:720,focal:1000,position:[.9,0,4]});f.data=moved.data;
  h.setTime(50);h.video.currentTime=.05;anchor.update();assert.equal(anchor._misses,1);
  const failed=h.drawCalls.at(-1),before=h.drawCalls.length;
  h.setTime(100);h.video.currentTime=.1;anchor.update();
  assert.ok(h.drawCalls[before].w>failed.w,'ROI expands after a miss');
  assert.ok(anchor._result.decoded,'reacquisition verifies payload');assert.equal(anchor._lastSeen,100);
  assert.ok(Math.abs(anchor._result.pose.position[0]-.9)<.05,'new acquisition does not blend the old location');
});

test('video resolution changes discard cached geometry and identity',async()=>{
  const f=fixture(),h=moduleHarness(f),anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video}).init();
  anchor.update();const previous=anchor._reference;
  Object.assign(f,fixture({width:1280,height:720,focal:1000}));
  Object.assign(h.video,{videoWidth:f.width,videoHeight:f.height,currentTime:.1});h.setTime(100);
  anchor.update();assert.equal(anchor.getLatest().frameWidth,1280);assert.equal(anchor.getLatest().frameHeight,720);
  assert.equal(anchor._result.decoded,true);assert.notEqual(anchor._reference,previous);
});


test('stable corner tracking still has a hard maximum identity reuse time',async()=>{
  const f=fixture(),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,maxReuseMs:1000}).init();
  let detections=0;anchor._core={...core,detect(...args){detections++;return core.detect(...args);}};
  anchor.update();
  for(let t=50;t<=1000;t+=50) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  assert.equal(detections,2,'one initial decode and one verification at the hard deadline');
  assert.ok(anchor._lastDecoded===1000,'strict comparison has a fixed reuse deadline');
});

test('corner flow follows translation and changing perspective across native ROI offsets',async()=>{
  const settings={width:960,height:720,focal:900,position:[.2,-.1,4],angles:[.3,-.25,.1]};
  const f=fixture(settings),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  anchor.update();let tracked=0;
  for(let i=1;i<=8;i++) {
    const next=fixture({...settings,position:[.2+i*.012,-.1+i*.006,4-i*.01],angles:[.3+i*.006,-.25+i*.004,.1+i*.008]});
    f.data=next.data;h.setTime(i*40);h.video.currentTime=i*.04;anchor.update();
    assert.equal(anchor._lastSeen,i*40,'pose refreshed on moving frames');
    if(!anchor._result.decoded) tracked++;
    const truth=core.project(next.pose,[0,0,.4],f.intrinsics);
    const p=anchor.projectPoint(0,0,.4,{x:0,y:0,width:f.width,height:f.height});
    assert.ok(Math.hypot(p.x-truth[0],p.y-truth[1])<8,'tracked pose follows true 3D movement');
  }
  assert.ok(tracked>=6,`most moving frames should use only corners, got ${tracked}`);
});

test('corner uncertainty triggers verification early; disappearance cannot extend identity',async()=>{
  const settings={width:640,height:480,angles:[.25,-.3,.1]},f=fixture(settings),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video}).init();
  let detections=0;anchor._core={...core,detect(...args){detections++;return core.detect(...args);}};
  anchor.update();
  for(let t=40;t<=400;t+=40) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  assert.equal(detections,1);
  // Fast rotation breaks local patch correspondence, while the QR remains decodable.
  f.data=fixture({...settings,angles:[.25,-.3,.5]}).data;
  h.setTime(440);h.video.currentTime=.44;anchor.update();
  assert.equal(detections,2);assert.equal(anchor._lastDecoded,440,'verify rather than guess identity');
  f.data.fill(255);h.setTime(480);h.video.currentTime=.48;anchor.update();
  assert.equal(anchor._lastSeen,440,'blank frame cannot earn reuse');
  h.setTime(650);h.video.currentTime=.65;anchor.update();assert.equal(anchor.getLatest().visible,false);
});


test('corner flow handles crop rescaling on a large marker',async()=>{
  const settings={width:1280,height:960,focal:1000,position:[.1,0,2.2],angles:[.15,-.2,.1]};
  const f=fixture(settings),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  anchor.update();let tracked=0;
  for(let i=1;i<=4;i++) {
    const next=fixture({...settings,position:[.1+i*.005,i*.004,2.2-i*.02]});
    f.data=next.data;h.setTime(i*40);h.video.currentTime=i*.04;anchor.update();
    assert.equal(anchor._lastSeen,i*40);
    if(!anchor._result.decoded) tracked++;
    assert.ok(anchor._result.crop.sx<1,'native ROI is downscaled');
    assert.ok(Math.abs(anchor._result.pose.position[2]-next.pose.position[2])<.08);
  }
  assert.ok(tracked>=3,`crop scale changes should not cause repeated decoding: ${tracked}`);
});

for(const spin of [0,.4,Math.PI/2,Math.PI]) test(`steep perspective keeps finder identity with spin ${spin.toFixed(1)}`,async()=>{
  const f=fixture({angles:[1.2,.15,spin]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  anchor.update();assert.equal(anchor.getLatest().text,'qr2');
  assert.ok(Math.abs(anchor._result.pose.position[2]-3)<.15);
  assert.equal(anchor._focalScale,1,'measured calibration must stay fixed');
  const truth=core.project(f.pose,[0,0,.4],f.intrinsics);
  const point=anchor.projectPoint(0,0,.4,{x:0,y:0,width:f.width,height:f.height});
  assert.ok(Math.hypot(point.x-truth[0],point.y-truth[1])<8,'correct corner roles preserve cube orientation');
});

test('tilted QR can refine a guessed FOV while keeping explicit calibration fixed',async()=>{
  const f=fixture({focal:900,angles:[.8,-.25,.3],position:[.2,-.1,3.5]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,smoothing:1}).init();
  anchor.update();assert.ok(anchor.getLatest().visible,'guessed FOV must not hide an otherwise valid QR');
  assert.ok(anchor._focalScale>1.2&&anchor._focalScale<=2);
  assert.ok(Math.abs(anchor.getLatest().intrinsics.fx-900)<90);
  const adjusted=anchor.getLatest().intrinsics.fx;
  h.setTime(40);h.video.currentTime=.04;anchor.update();
  assert.equal(anchor._lastSeen,40);assert.ok(Math.abs(anchor.getLatest().intrinsics.fx-adjusted)<1e-6);
  const k={fx:640/(2*Math.tan(Math.PI/6)),fy:640/(2*Math.tan(Math.PI/6)),cx:320,cy:240};
  assert.equal(core.detect(f.data,f.width,f.height,{intrinsics:k}),null,'explicit bad calibration is not silently changed');
  assert.equal(core.detect(f.data,f.width,f.height,{intrinsics:k,focalScaleRange:[.95,1.05]}),null,'focal correction must obey its bounds');
});

for(const spin of [0,Math.PI/2]) test(`near-edge-on finder proportions retain real detail at spin ${spin.toFixed(1)}`,async()=>{
  const f=fixture({angles:[1.3,.1,spin],position:[0,0,2.6]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,intrinsics:{...f.intrinsics,width:f.width,height:f.height},smoothing:1}).init();
  anchor.update();assert.equal(anchor.getLatest().text,'qr2');
  assert.ok(Math.abs(anchor._result.pose.position[2]-2.6)<.15);
});

// A bright reflection cuts the outer black ring of each finder. The central
// black squares and data remain visible; no synthetic detector results involved.
test('diagnostics distinguish finder geometry, payload and pose failures from a decoded anchor',async()=>{
  const f=fixture({angles:[.5,-.25,.2]}),diagnostics={};
  assert.ok(core.detect(f.data,f.width,f.height,{intrinsics:f.intrinsics,diagnostics}));
  assert.equal(diagnostics.finderCount,3);assert.equal(diagnostics.geometryFound,true);
  assert.equal(diagnostics.decodedText,'qr2');assert.equal(diagnostics.poseValid,true);
  const damaged=fixture(),dim=damaged.qr.size;
  const inverse=core.homography(damaged.corners,[[0,0],[dim,0],[dim,dim],[0,dim]]);
  for(let y=0;y<damaged.height;y++) for(let x=0;x<damaged.width;x++) {
    const [u,v]=core.transform(inverse,[x+.5,y+.5]);
    if((u>=0&&u<7&&v>=0&&v<7)||(u>=dim-7&&u<dim&&v>=0&&v<7)||(u>=0&&u<7&&v>=dim-7&&v<dim)) continue;
    const i=(y*damaged.width+x)*4;damaged.data[i]=damaged.data[i+1]=damaged.data[i+2]=240;
  }
  const d={};assert.equal(core.detect(damaged.data,damaged.width,damaged.height,{intrinsics:damaged.intrinsics,diagnostics:d}),null);
  assert.equal(d.finderCount,3);assert.equal(d.geometryFound,true);assert.equal(d.decodedText,undefined);
  const h=moduleHarness(damaged),anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video}).init();
  anchor.update();assert.match(anchor.getLatest().statusMessage,/outlines found · QR not decoded/);
  damaged.data=fixture({text:'qr3'}).data;h.setTime(40);h.video.currentTime=.04;anchor.update();
  assert.match(anchor.getLatest().statusMessage,/Decoded qr3 · waiting for qr2/);
  damaged.data.fill(255);h.setTime(80);h.video.currentTime=.08;anchor.update();
  assert.match(anchor.getLatest().statusMessage,/no finder patterns/);
  assert.equal(anchor.getLatest().diagnostics.decodedText,undefined,'old diagnostic stages must not persist into new frames');
  const poseFailure={};
  assert.equal(core.detect(f.data,f.width,f.height,{intrinsics:f.intrinsics,maxReprojectionError:.00001,diagnostics:poseFailure}),null);
  assert.equal(poseFailure.decodedText,'qr2');assert.ok(!poseFailure.poseValid);
});

test('render smoothing interpolates between detections without moving measured geometry',async()=>{
  const f=fixture(),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,smoothing:1,renderSmoothingMs:60}).init();
  anchor.update();const initial=anchor.getLatest().pose.position[0];
  f.data=fixture({position:[.03,0,3]}).data;
  h.setTime(40);h.video.currentTime=.04;anchor.update();
  const measured=anchor._result.pose.position[0],first=anchor.getLatest().pose.position[0];
  assert.ok(first>initial&&first<measured,'display eases toward new measurement');
  h.setTime(56);const second=anchor.getLatest().pose.position[0];
  assert.ok(second>first&&second<measured,'draw frames interpolate without another detection');
  assert.equal(anchor._result.pose.position[0],measured,'display smoothing never feeds back into tracker');
  assert.equal(anchor._lastSeen,40);
  anchor.stop();assert.equal(anchor._renderPose,null);
  h.setTime(300);h.video.currentTime=.3;anchor.update();
  assert.equal(anchor.getLatest().pose.position[0],anchor._result.pose.position[0],'reacquisition does not blend stale pose');
});

test('pattern score is an inexpensive match fraction and rejects flat or replaced QR data',()=>{
  const f=fixture(),r=core.detect(f.data,f.width,f.height,{intrinsics:f.intrinsics});
  const clean=core.patternMatch(core.prepareTrackingFrame(f.data,f.width,f.height)[0],r.homography,r.reference);
  assert.equal(clean.score,1);assert.equal(clean.total,36);assert.ok(clean.contrast>45);
  const different=fixture({text:'qr3'});
  const mismatch=core.patternMatch(core.prepareTrackingFrame(different.data,different.width,different.height)[0],r.homography,r.reference);
  assert.ok(mismatch.score<.95,'same finders do not imply the same payload');
  f.data.fill(128);
  const flat=core.patternMatch(core.prepareTrackingFrame(f.data,f.width,f.height)[0],r.homography,r.reference);
  assert.equal(flat.contrast,0,'contrast is separate from match fraction');
});

test('WebGL projection matches camera-cover coordinates using the actual p5 2.2 frustum',async()=>{
  // Execute the vendored p5 projection method, not a duplicate of Portal's math.
  const source=fs.readFileSync(path.join(root,'../experiments/vj1/vendor/p5/p5-2.2.0.min.js'),'utf8');
  const start=source.indexOf('    frustum(left, right, bottom, top, near, far) {');
  assert.ok(start>=0);
  const method=source.slice(start,source.indexOf('\n    }',start)+6);
  const camera=vm.runInNewContext('({'+method+'})',{Matrix:class{set(...values){this.values=values;}}});
  const mul4=(m,p)=>[0,1,2,3].map(row=>[0,1,2,3].reduce((sum,c)=>sum+m[c*4+row]*p[c],0));
  const f=fixture({angles:[.5,-.25,.2],position:[.2,-.1,3.5]}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,smoothing:1,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  anchor.update();
  for(const [width,height] of [[390,844],[960,540]]) {
    h.c.width=width;h.c.height=height;
    const rect={x:12,y:24,width:width-30,height:height-50};
    const cam={yScale:1,_isActive:()=>false};let matrix,sign,projection,boxes=0;
    const g={width,height,push(){},pop(){},resetMatrix(){},fill(){},stroke(){},strokeWeight(){},
      _renderer:{camera(...args){assert.deepEqual(args,[0,0,0,0,0,-1,0,1,0]);},
        frustum(...args){camera.frustum.call(cam,...args);projection=cam.projMatrix.values;}},
      scale(...args){sign=args;},applyMatrix(m){matrix=m;},translate(...args){assert.deepEqual(args,[0,0,.3]);},
      box(...args){boxes++;assert.deepEqual(args,[.6,.6,.6]);}};
    anchor.drawCubeWebGL({target:g,rect,size:.6,height:.6});assert.equal(boxes,1);
    for(const p of [[0,0,0],[-.3,-.3,0],[.3,.3,.6]]) {
      const world=mul4(matrix,[...p,1]);for(let i=0;i<3;i++)world[i]*=sign[i];
      const clip=mul4(projection,world),x=(clip[0]/clip[3]+1)*width/2,y=(1-clip[1]/clip[3])*height/2;
      const expected=anchor.projectPoint(...p,rect);
      assert.ok(Math.hypot(x-expected.x,y-expected.y)<.0001,'GPU projection and camera pixels stay aligned');
    }
  }
});

test('Kalman learns velocity, smooths noisy measurements and bounds unobserved motion',()=>{
  const filter=new core.PositionKalman(1);
  let rawError=0,filteredError=0;
  for(let i=0;i<30;i++) {
    const x=i*.02,noise=i%2?.012:-.012;
    filter.observe([x+noise,0,3],i*40);
    rawError+=noise**2;filteredError+=(filter.at(i*40).position[0]-x)**2;
  }
  assert.ok(filteredError<rawError*.7,'reduces alternating measurement noise');
  const measured=filter.at(1160),predicted=filter.at(1260),held=filter.at(1460);
  assert.ok(predicted.position[0]>measured.position[0]+.025,'continues measured motion');
  assert.equal(predicted.predicting,true);assert.equal(held.predicting,false);
  assert.deepEqual(Array.from(held.position),Array.from(filter.at(1810).position),'position freezes after prediction horizon');
  assert.ok(filter.at(1810).uncertainty>held.uncertainty,'uncertainty continues growing');
  assert.equal(filter.time,1160,'display reads never become observations');
  for(let i=1;i<=8;i++) filter.observe([.58,0,3],1160+i*40);
  assert.ok(Math.abs(filter.at(1580).position[0]-.58)<.015,'new measurements correct a stop');
  filter.observe([2,0,3],2200);
  assert.equal(filter.samples,1);assert.equal(filter.at(2250).predicting,false,'reacquisition warms up velocity');
});

function horizontalBlur(f,radius) {
  const data=new Uint8ClampedArray(f.data.length);
  for(let y=0;y<f.height;y++) for(let x=0;x<f.width;x++) {
    let value=0;
    for(let dx=-radius;dx<=radius;dx++) value+=f.data[(y*f.width+Math.max(0,Math.min(f.width-1,x+dx)))*4];
    const p=(y*f.width+x)*4;data[p]=data[p+1]=data[p+2]=value/(radius*2+1);data[p+3]=255;
  }
  return data;
}

test('recovery retains the last sharp frame through blurred frames and resumes corner flow',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',intrinsics:{...f.intrinsics,width:f.width,height:f.height},recoveryMs:350,roiPadding:.5,lostAfterMs:650}).init();
  anchor.update();assert.ok(anchor.getLatest().visible);
  const decodedAt=anchor._lastDecoded,reference=anchor._reference,reliable=anchor._reliableResult;
  f.data=horizontalBlur(fixture({text:'qr7',position:[.025,0,3]}),18);
  for(const t of [40,80,120,200]) {
    h.setTime(t);h.video.currentTime=t/1000;anchor.update();
    assert.equal(anchor._lastSeen,0,'unreliable blur must not refresh pose');
    assert.equal(anchor._reliableResult,reliable);assert.equal(anchor._reference,reference);
    assert.equal(anchor.getLatest().holding,true);assert.equal(anchor.getLatest().visible,true);
  }
  let detectionCalls=0;anchor._core={...core,detect(...args){detectionCalls++;return core.detect(...args);}};
  f.data=fixture({text:'qr7',position:[.035,0,3]}).data;
  h.setTime(280);h.video.currentTime=.28;anchor.update();
  assert.equal(anchor._lastSeen,280,'flow recovers from the retained sharp image');
  assert.equal(anchor._lastDecoded,decodedAt);assert.equal(detectionCalls,0,'recovery needs no payload decode');
  assert.equal(anchor.getLatest().diagnostics.mode,'corners');
});

test('Kalman display prediction survives a dropout but cannot refresh identity or visibility',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',intrinsics:{...f.intrinsics,width:f.width,height:f.height},recoveryMs:350,roiPadding:.5,lostAfterMs:650,kalmanFilter:true,predictionMs:150}).init();
  for(let i=0;i<6;i++) {
    f.data=fixture({text:'qr7',position:[i*.015,0,3]}).data;
    h.setTime(i*40);h.video.currentTime=i*.04;anchor.update();assert.equal(anchor._lastSeen,i*40);
  }
  const measured=anchor.getLatest(),decodedAt=anchor._lastDecoded;
  f.data.fill(255);h.setTime(240);h.video.currentTime=.24;anchor.update();
  const predicted=anchor.getLatest();
  assert.equal(predicted.predicting,true);assert.match(predicted.statusMessage,/Kalman/);
  assert.ok(predicted.pose.position[0]>measured.pose.position[0]);
  assert.equal(predicted.lastSeen,200);assert.equal(anchor._lastDecoded,decodedAt);
  h.setTime(450);const held=anchor.getLatest();
  assert.equal(held.visible,true);assert.equal(held.predicting,false);assert.equal(held.holding,true);
  h.setTime(800);assert.deepEqual(Array.from(anchor.getLatest().pose.position),Array.from(held.pose.position));
  h.setTime(851);assert.equal(anchor.getLatest().visible,false);
  anchor.setKalmanEnabled(false);assert.equal(anchor._kalman,null);
  anchor.stop();assert.equal(anchor.getLatest().visible,false);
});

test('recovery rejects a replacement QR and releases stale tracking references on schedule',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',recoveryMs:350,lostAfterMs:650,kalmanFilter:true}).init();
  anchor.update();assert.equal(anchor._lastDecoded,0);
  f.data=fixture({text:'qr3'}).data;
  for(const t of [40,100,200,300,400,700]) {
    h.setTime(t);h.video.currentTime=t/1000;anchor.update();
    assert.equal(anchor._lastSeen,0);assert.equal(anchor._lastDecoded,0);
    if(t>350) assert.equal(anchor._reliableResult,null,'do not retain stale flow frames indefinitely');
  }
  assert.equal(anchor.getLatest().visible,false);
  f.data=fixture({text:'qr7',position:[.1,0,3]}).data;
  h.setTime(750);h.video.currentTime=.75;anchor.update();
  assert.equal(anchor._lastDecoded,750,'full decode required after recovery window');
  assert.equal(anchor._kalman.samples,1,'reacquisition resets old velocity');
});

test('uncertainty-limited Kalman prediction advances monotonically to a fixed hold point',()=>{
  const filter=new core.PositionKalman();
  filter.observe([0,0,3],0);
  filter.samples=3;filter.axes[0].v=1;
  const horizon=filter.at(1).horizonMs;
  assert.ok(horizon>0&&horizon<150,'exercise uncertainty limit rather than configured time cap');
  let last=0;
  for(let t=1;t<=300;t++) {
    const state=filter.at(t);
    assert.ok(state.position[0]>=last-1e-12,'must never step backward at uncertainty boundaries');
    assert.equal(state.horizonMs,horizon);last=state.position[0];
  }
  assert.equal(filter.at(200).position[0],filter.at(300).position[0]);
});

test('fast movement reacquisition eases from the visible predicted pose without altering measurements',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',intrinsics:{...f.intrinsics,width:f.width,height:f.height},recoveryMs:150,roiPadding:.5,lostAfterMs:650,kalmanFilter:true,renderSmoothingMs:60}).init();
  for(let i=0;i<6;i++) {
    f.data=fixture({text:'qr7',position:[i*.015,0,3]}).data;
    h.setTime(i*40);h.video.currentTime=i*.04;anchor.update();
  }
  f.data.fill(255);
  for(const t of [240,280]) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  const oldReference=anchor._reference;
  h.setTime(440);const before=anchor.getLatest().pose;
  f.data=fixture({text:'qr7',position:[.8,0,3]}).data;
  h.video.currentTime=.44;anchor.update();
  assert.equal(anchor._lastSeen,440);assert.equal(anchor._lastDecoded,440);
  assert.notEqual(anchor._reference,oldReference,'new decode really reacquired the QR');
  assert.equal(anchor._kalman.samples,1,'reset velocity after the discontinuity');
  const measured=Array.from(anchor._result.pose.position),first=Array.from(anchor.getLatest().pose.position);
  assert.ok(Math.abs(measured[0]-.8)<.04,'raw measurement stays accurate');
  assert.ok(Math.abs(first[0]-before.position[0])<1e-9,'no instantaneous display position jump');
  h.setTime(500);const second=anchor.getLatest().pose.position[0];
  assert.ok(second>first[0]&&second<measured[0],'display approaches the newly measured position');
  h.setTime(680);assert.ok(Math.abs(anchor.getLatest().pose.position[0]-measured[0])<.02,'correction settles quickly');
  assert.deepEqual(Array.from(anchor._result.pose.position),measured);
  assert.equal(anchor._lastSeen,440,'display correction is not a new observation');
  anchor.stop();assert.equal(anchor._positionCorrection,null);
  h.setTime(1200);h.video.currentTime=1.2;anchor.update();
  assert.ok(Math.abs(anchor.getLatest().pose.position[0]-.8)<.04,'new session does not blend a stale position');
});

test('expanded recovery ROI preserves corner sampling scale instead of forcing a decode',async()=>{
  const settings={text:'qr7',width:960,height:720,focal:900,position:[0,0,2.5]};
  const f=fixture(settings),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',maxWidth:320,intrinsics:{...f.intrinsics,width:f.width,height:f.height},recoveryMs:350,roiPadding:.5,lostAfterMs:650}).init();
  anchor.update();h.setTime(40);h.video.currentTime=.04;anchor.update();
  const reliable=anchor._reliableResult;
  assert.ok(reliable.crop.sx<.5,'fixture requires downsampling before any failure');
  f.data.fill(255);h.setTime(80);h.video.currentTime=.08;anchor.update();
  assert.equal(anchor._lastSeen,40);
  let decodes=0;anchor._core={...core,detect(...args){decodes++;return core.detect(...args);}};
  f.data=fixture({...settings,position:[.01,0,2.5]}).data;
  h.setTime(120);h.video.currentTime=.12;anchor.update();
  assert.equal(anchor._lastSeen,120);
  assert.equal(decodes,0,'ROI expansion must not invalidate otherwise good optical flow');
  assert.equal(anchor._result.decoded,false);
  assert.ok(anchor._result.crop.rect.width>reliable.crop.rect.width);
  assert.ok(Math.abs(anchor._result.crop.sx/reliable.crop.sx-1)<.02);
  assert.ok(h.drawCalls.at(-1).width<=640,'expanded recovery still has a bounded processing cost');
});

test('tracking-first mode checks every four seconds with no timed full decode',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',patternIntervalMs:4000,recoveryMs:350}).init();
  let acquisitions=0,confirmations=0,checks=0;
  anchor._core={...core,detect(...args){acquisitions++;return core.detect(...args);},decodeTracked(...args){confirmations++;return core.decodeTracked(...args);}};
  for(let t=0;t<=8000;t+=100) {
    h.setTime(t);h.video.currentTime=t/1000;anchor.update();
    assert.equal(anchor._lastSeen,t);
    if(anchor.getLatest().diagnostics.patternAttempted) checks++;
  }
  assert.equal(checks,2,'one quick check at 4 seconds and another at 8 seconds');
  assert.equal(acquisitions,1,'only initial acquisition invokes the finder/decoder');
  assert.equal(confirmations,0);assert.equal(anchor._lastDecoded,0,'no automatic 3-second decode deadline');
});

function damageDataArea(f,invert=false) {
  const dim=f.qr.size,h=core.homography(f.corners,[[0,0],[dim,0],[dim,dim],[0,dim]]);
  for(let y=0;y<f.height;y++) for(let x=0;x<f.width;x++) {
    const [u,v]=core.transform(h,[x+.5,y+.5]);
    if(u<9||v<9||u>=dim||v>=dim)continue;
    const i=(y*f.width+x)*4,value=invert?255-f.data[i]:128;
    f.data[i]=f.data[i+1]=f.data[i+2]=value;
  }
  return f;
}

test('unclear scheduled pattern check is deferred while measured corners keep tracking',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',patternIntervalMs:4000,recoveryMs:350}).init();
  let decodes=0;anchor._core={...core,detect(...args){decodes++;return core.detect(...args);},decodeTracked(){throw new Error('unclear image must not trigger identity decoding');}};
  for(let t=0;t<4000;t+=100) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  f.data=damageDataArea(fixture({text:'qr7'})).data;
  for(let t=4000;t<=4400;t+=100) {
    h.setTime(t);h.video.currentTime=t/1000;anchor.update();
    assert.equal(anchor._lastSeen,t);assert.equal(anchor.getLatest().diagnostics.patternVerification,'deferred');
    assert.equal(anchor._patternSuspectSince,null);assert.equal(anchor._lastPatternVerified,0);
  }
  f.data=fixture({text:'qr7'}).data;
  for(let t=4500;t<=4700;t+=100) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  assert.equal(anchor._patternState,'verified');assert.ok(anchor._lastPatternVerified>=4500);
  assert.equal(decodes,1,'deferred sampling never reacquires an otherwise tracked QR');
});

test('below-30-percent match gets three seconds of tracked decoding attempts before restart',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',patternIntervalMs:4000,patternMatchThreshold:.3,patternConfirmMs:3000,recoveryMs:350,lostAfterMs:650}).init();
  let attempts=0;anchor._core={...core,decodeTracked(...args){attempts++;return core.decodeTracked(...args);}};
  for(let t=0;t<4000;t+=100) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  f.data=damageDataArea(fixture({text:'qr7'}),true).data;
  for(let t=4000;t<7000;t+=100) {
    h.setTime(t);h.video.currentTime=t/1000;anchor.update();
    assert.equal(anchor._lastSeen,t,'continue following corners during confirmation');
    assert.equal(anchor._patternSuspectSince,4000);assert.ok(anchor.getLatest().visible);
    assert.equal(anchor._lastDecoded,0,'failed attempts never verify the old ID');
  }
  assert.ok(anchor.getLatest().diagnostics.patternMatch.score<.3);
  h.setTime(7000);h.video.currentTime=7;anchor.update();
  assert.equal(attempts,7,'decode only every 500 ms, including the final attempt');
  assert.equal(anchor.getLatest().visible,false);assert.equal(anchor._reference,null);
  f.data=fixture({text:'qr7'}).data;h.setTime(7100);h.video.currentTime=7.1;anchor.update();
  assert.equal(anchor.getLatest().text,'qr7');assert.equal(anchor._lastDecoded,7100);
});

for(const angles of [[0,0,0],[.45,-.4,.25],[-.3,.4,1.8]]) test(`inner-square acquisition preserves full QR scale: ${angles}`,()=>{
  const f=fixture({text:'qr7',angles});
  const r=core.detect(f.data,f.width,f.height,{target:'qr7',innerFinders:true,intrinsics:f.intrinsics});
  assert.ok(r);assert.ok(Math.abs(r.pose.position[2]-3)<.12);
  for(let i=0;i<4;i++) assert.ok(Math.hypot(...r.corners[i].map((v,j)=>v-f.corners[i][j]))<4);
});

test('inner-square tracker follows sustained motion without repeated payload decoding',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',centreTracking:true,patternIntervalMs:4000,recoveryMs:350,roiPadding:.5,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  anchor.update();assert.equal(anchor._lastDecoded,0);
  const steps=[.12,.24,.36,.24,.12,0,-.12,-.24,-.12,0,.12,.24];
  for(let i=0;i<steps.length;i++) {
    const next=fixture({text:'qr7',position:[steps[i],.02*Math.sin(i),3],angles:[.015*i,-.01*i,.02*i]});
    f.data=next.data;h.setTime((i+1)*40);h.video.currentTime=(i+1)*.04;anchor.update();
    const state=anchor.getLatest();
    assert.equal(state.diagnostics.mode,'centres',JSON.stringify(state.diagnostics));
    assert.equal(anchor._lastDecoded,0,'movement must not trigger payload reacquisition');
    const dim=next.qr.size,truth=core.homography([[0,0],[dim,0],[dim,dim],[0,dim]],next.corners);
    const points=[[3.5,3.5],[dim-3.5,3.5],[3.5,dim-3.5]].map(p=>core.transform(truth,p));
    state.finderCentres.forEach((p,j)=>assert.ok(Math.hypot(...p.map((v,k)=>v-points[j][k]))<3,`centre ${j} frame ${i}: ${p} vs ${points[j]}`));
  }
  h.setTime(1000);assert.equal(anchor.getLatest().finderCentres,null,'held or expired markers are not presented as current measurements');
});

test('tracked tilt refinement measures inner squares without searching outer rings',()=>{
  const f=fixture({text:'qr7',angles:[.55,-.35,.2]});
  const r=core.detect(f.data,f.width,f.height,{target:'qr7',innerFinders:true,intrinsics:f.intrinsics});
  assert.ok(r);
  const dim=f.qr.size,inverse=core.homography(f.corners,[[0,0],[dim,0],[dim,dim],[0,dim]]);
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++) {
    const p=core.transform(inverse,[x+.5,y+.5]);
    // Erase all three outer black rings, retaining the central 3x3 islands.
    if([[0,0],[dim-7,0],[0,dim-7]].some(([u,v])=>{
      const a=p[0]-u,b=p[1]-v;
      return a>=0&&b>=0&&a<7&&b<7&&(a<1||b<1||a>=6||b>=6);
    })) {const i=(y*f.width+x)*4;f.data[i]=f.data[i+1]=f.data[i+2]=240;}
  }
  const refined=core.refineTrackedGeometry(f.data,f.width,f.height,r.reference,r.homography,{intrinsics:f.intrinsics});
  assert.ok(refined,'inner outline refinement does not require the outer finder rings');
  assert.ok(Math.abs(refined.pose.position[2]-3)<.12);
});

test('successful identity confirmation resumes four-second checks without reacquiring geometry',async()=>{
  const original=fixture({text:'qr7'}),f={...original},h=moduleHarness(f);
  const anchor=await new h.c.QrAnchor({...comparisonOptions,video:h.video,target:'qr7',centreTracking:true,patternIntervalMs:4000,recoveryMs:350}).init();
  anchor.update();
  for(let t=100;t<4000;t+=100) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  f.data=damageDataArea(fixture({text:'qr7'}),true).data;
  h.setTime(4000);h.video.currentTime=4;anchor.update();
  assert.equal(anchor.getLatest().diagnostics.identityVerification,'confirming');
  f.data=original.data;
  for(let t=4100;t<=4500;t+=100) {h.setTime(t);h.video.currentTime=t/1000;anchor.update();}
  assert.equal(anchor.getLatest().diagnostics.identityVerification,'confirmed');
  assert.equal(anchor.getLatest().diagnostics.mode,'centres');
  assert.equal(anchor._lastDecoded,4500);assert.equal(anchor._nextPatternCheck,8500);
});

test('default strategy recovers without decode cascades, then returns to the normal crop and cost path',async()=>{
  const original=fixture({text:'qr7',width:960,height:720,focal:900,position:[0,0,3]}),f={...original},h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7'}).init();
  assert.equal(a.centreTracking,true);assert.equal(a.patternIntervalMs,4000);
  let decodes=0,searches=0;
  a._core={...core,detect(...args){decodes++;return core.detect(...args);},locate(...args){searches++;return core.locate(...args);},track(){throw Error('centre mode must not cascade into corner mode');}};
  a.update();assert.equal(decodes,1);const initial=a._reference;
  f.data=new Uint8ClampedArray(original.data.length);f.data.fill(255);
  for(const t of [40,80,160,240,300]) {h.setTime(t);h.video.currentTime=t/1000;a.update();}
  assert.equal(searches,1);assert.equal(decodes,1,'brief missing squares do not start full decoding');
  assert.equal(a._reference,initial);assert.equal(a._lastSeen,0);
  f.data=original.data;h.setTime(340);h.video.currentTime=.34;a.update();
  assert.equal(a._lastSeen,340);assert.equal(a._lastDecoded,0);assert.equal(a._misses,0);
  h.setTime(380);h.video.currentTime=.38;a.update();
  assert.ok(a.getLatest().diagnostics.cropWidth<=a.maxWidth);
  assert.equal(a.getLatest().diagnostics.centreLocalSearches||0,0,'recovered clear image leaves the expensive local-search path');
  f.data=new Uint8ClampedArray(original.data.length);f.data.fill(255);
  for(let t=420;t<=1500;t+=40){h.setTime(t);h.video.currentTime=t/1000;a.update();}
  assert.equal(a.getLatest().visible,false);assert.equal(a._centreResult,null);
  const searchesBefore=searches;
  for(let t=1540;t<=1900;t+=40){h.setTime(t);h.video.currentTime=t/1000;a.update();}
  assert.ok(searches-searchesBefore<=4,'lost-state search is throttled, not performed at camera FPS');
  f.data=original.data;
  for(let t=1940;t<=2300;t+=40){h.setTime(t);h.video.currentTime=t/1000;a.update();}
  assert.equal(a.getLatest().diagnostics.mode,'centres');assert.equal(a._misses,0);
  assert.equal(a.getLatest().diagnostics.centreLocalSearches||0,0);
  assert.ok(a.getLatest().diagnostics.cropWidth<=a.maxWidth);
});

test('fast coherent translation is accepted beyond the former per-square motion limit',async()=>{
  const f=fixture({text:'qr7',position:[-.8,0,3]}),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  a.update();
  for(let i=1;i<=4;i++) {
    const next=fixture({text:'qr7',position:[-.8+i*.35,0,3]});f.data=next.data;
    h.setTime(i*40);h.video.currentTime=i*.04;a.update();
    assert.equal(a._lastSeen,i*40,JSON.stringify(a.getLatest().diagnostics));
    assert.equal(a._lastDecoded,0,'fast movement remains tracking');
    assert.ok(Math.abs(a._result.pose.position[0]-next.pose.position[0])<.3,'pose follows translation with configured smoothing');
  }
});

for(const spin of [0,.6,2.5]) test(`a damaged inner square cannot silently attach to data cells (${spin})`,async()=>{
  const f=fixture({text:'qr7',angles:[.25,-.2,spin]}),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();a.update();
  const dim=f.qr.size,H=core.homography(f.corners,[[0,0],[dim,0],[dim,dim],[0,dim]]);
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++) {
    const [u,v]=core.transform(H,[x+.5,y+.5]);
    if(u>=2&&u<5&&v>=2&&v<5) {
      const value=(Math.floor(u)+Math.floor(v))%2?240:15,i=(y*f.width+x)*4;
      f.data[i]=f.data[i+1]=f.data[i+2]=value;
    }
  }
  h.setTime(40);h.video.currentTime=.04;a.update();
  assert.equal(a._lastSeen,0,'data-like texture is rejected instead of refreshing the marker');
  assert.equal(a.getLatest().finderCentres,null,'no live dot is drawn at a false centre');
});

test('moving blurred squares keep measured centres without decoding again',async()=>{
  const config={text:'qr7',position:[0,0,4],angles:[.25,-.2,.15]};
  const f=fixture(config),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',smoothing:1,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  a.update();
  for(const [i,radius] of [1,2,3,4,5,4,3,2,1,0].entries()) {
    const next=fixture({...config,position:[(i+1)*.04,0,4]}),data=new Uint8ClampedArray(next.data.length);
    // A centred horizontal exposure smear has a known, unchanged true centre.
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++) {
      let sum=0;
      for(let dx=-radius;dx<=radius;dx++)sum+=next.data[(y*f.width+Math.max(0,Math.min(f.width-1,x+dx)))*4];
      const p=(y*f.width+x)*4;data[p]=data[p+1]=data[p+2]=sum/(2*radius+1);data[p+3]=255;
    }
    f.data=data;h.setTime((i+1)*40);h.video.currentTime=(i+1)*.04;a.update();
    assert.equal(a._lastSeen,(i+1)*40,`lost moving square at blur radius ${radius}`);
    assert.equal(a._lastDecoded,0,'soft edges must not cause reacquisition');
    const dim=next.qr.size,H=core.homography([[0,0],[dim,0],[dim,dim],[0,dim]],next.corners);
    const expected=[[3.5,3.5],[dim-3.5,3.5],[3.5,dim-3.5]].map(p=>core.transform(H,p));
    a.getLatest().finderCentres.forEach((p,j)=>assert.ok(Math.hypot(...p.map((v,k)=>v-expected[j][k]))<3,'centres follow the real square, not adjacent data'));
  }
});

test('fast tilt refreshes perspective before an approximate pose can drop the measurement',async()=>{
  const config={text:'qr7',angles:[.25,-.3,.1]},f=fixture(config),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',smoothing:1,maxReprojectionError:1,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  a.update();let refinements=0;
  a._core={...core,trackCentres(...args){const r=core.trackCentres(...args);if(r?.poseNeedsRefinement)refinements++;return r;}};
  for(let i=1;i<=7;i++) {
    const next=fixture({...config,angles:[.25+i*.06,-.3-i*.04,.1+i*.03],position:[i*.015,0,3]});
    f.data=next.data;h.setTime(i*34);h.video.currentTime=i*.034;a.update();
    assert.equal(a._lastSeen,i*34,'all three visible moving squares remain tracked');
    assert.equal(a._lastDecoded,0);
    const actual=a.projectPoint(0,0,.4,{x:0,y:0,width:f.width,height:f.height}),expected=core.project(next.pose,[0,0,.4],f.intrinsics);
    assert.ok(Math.hypot(actual.x-expected[0],actual.y-expected[1])<8,'refreshed perspective follows true 3D tilt');
  }
  assert.ok(refinements>0,'fixture exercises immediate refinement before the periodic deadline');
});

for(const spin of [0,.6,2.5]) test(`soft-edge tolerance still rejects a smaller 2x2 data island (${spin})`,async()=>{
  const f=fixture({text:'qr7',angles:[.25,-.2,spin]}),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();a.update();
  const dim=f.qr.size,H=core.homography(f.corners,[[0,0],[dim,0],[dim,dim],[0,dim]]);
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++) {
    const [u,v]=core.transform(H,[x+.5,y+.5]);
    if(u>=2&&u<5&&v>=2&&v<5) {
      const value=u>=2.5&&u<4.5&&v>=2.5&&v<4.5?15:240,p=(y*f.width+x)*4;
      f.data[p]=f.data[p+1]=f.data[p+2]=value;
    }
  }
  h.setTime(40);h.video.currentTime=.04;a.update();
  assert.equal(a._lastSeen,0,'a small solid data block must not impersonate a finder');
});

test('rejected 3D fits retain measured squares briefly without publishing invalid poses',async()=>{
  const config={text:'qr7',angles:[.25,-.3,.1]},f=fixture(config),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',smoothing:1,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  a.update();const accepted=a._result,reference=a._reference;
  let rejectPose=true;
  a._core={...core,trackCentres(...args){const r=core.trackCentres(...args);if(r&&rejectPose)r.poseNeedsRefinement=true;return r;},
    refineTrackedGeometry(...args){return rejectPose?null:core.refineTrackedGeometry(...args);}};
  for(let i=1;i<=4;i++) {
    const next=fixture({...config,position:[i*.05,0,3]});f.data=next.data;
    h.setTime(i*34);h.video.currentTime=i*.034;if(i===4)rejectPose=false;a.update();
    assert.equal(a._centreResult.time,i*34,'next flow starts from the new measured pixels');
    if(i<4){assert.equal(a._lastSeen,0);assert.strictEqual(a._result,accepted);assert.equal(a.getLatest().diagnostics.imageTracking,true);assert.equal(a.getLatest().holding,true);}
    else {assert.equal(a._lastSeen,i*34);assert.equal(a._lastDecoded,0);assert.strictEqual(a._reference,reference);}
    const dim=next.qr.size,H=core.homography([[0,0],[dim,0],[dim,dim],[0,dim]],next.corners);
    const centres=[[3.5,3.5],[dim-3.5,3.5],[3.5,dim-3.5]].map(p=>core.transform(H,p));
    a._centreResult.finderCentres.forEach((p,j)=>assert.ok(Math.hypot(...p.map((v,k)=>v-centres[j][k]))<3));
  }
});

test('2D continuation expires from the last valid pose, never from its own measurements',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7',recoveryMs:150,lostAfterMs:250}).init();a.update();
  let searches=0;
  a._core={...core,trackCentres(...args){const r=core.trackCentres(...args);if(r)r.poseNeedsRefinement=true;return r;},refineTrackedGeometry(){return null;}};
  a._search=()=>{searches++;return null;};
  for(let t=40;t<=320;t+=40){h.setTime(t);h.video.currentTime=t/1000;a.update();assert.equal(a._lastSeen,0);if(t>150)assert.notEqual(a._centreResult?.time,t);}
  assert.ok(searches>0);assert.equal(a.getLatest().visible,false);assert.equal(a._centreResult,null);
});

test('tracked inner edges can correct guessed calibration without relaxing the fit threshold',()=>{
  const f=fixture({text:'qr7',focal:900,angles:[.8,-.25,.3],position:[.2,-.1,3]});
  const r=core.detect(f.data,f.width,f.height,{target:'qr7',intrinsics:f.intrinsics,innerFinders:true});assert.ok(r);
  const k={...f.intrinsics,fx:554,fy:554},options={intrinsics:k,maxReprojectionError:1.5};
  assert.equal(core.refineTrackedGeometry(f.data,f.width,f.height,r.reference,r.homography,options),null,'explicit calibration cannot be changed');
  const corrected=core.refineTrackedGeometry(f.data,f.width,f.height,r.reference,r.homography,{...options,focalScaleRange:[.6,2]});
  assert.ok(corrected);assert.ok(corrected.pose.reprojectionError<=1.5);assert.ok(Math.abs(corrected.intrinsics.fx-900)<70);
  const expected=core.project(f.pose,[0,0,.4],f.intrinsics),actual=core.project(corrected.pose,[0,0,.4],corrected.intrinsics);
  assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<8,'pose fits known 3D geometry, not just the QR plane');
  assert.equal(core.refineTrackedGeometry(f.data,f.width,f.height,r.reference,r.homography,{...options,focalScaleRange:[.95,1.05]}),null,'correction obeys its bounds');
});

test('a calibration correction does not blend stale depth into the new projection',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f),a=await new h.c.QrAnchor({video:h.video,target:'qr7',smoothing:.4,kalmanFilter:true,renderSmoothingMs:60}).init();a.update();a.getLatest();
  const previous=a._result,k=previous.intrinsics;
  const pose={...previous.pose,position:previous.pose.position.map(v=>v*1.6)};
  const intrinsics={...k,fx:k.fx*1.6,fy:k.fy*1.6};
  h.setTime(40);a._acceptResult({...previous,pose,intrinsics,time:40},true,40);
  const actual=a.projectPoint(.4,.4,0,{x:0,y:0,width:f.width,height:f.height}),expected=core.project(pose,[.4,.4,0],intrinsics);
  assert.ok(Math.hypot(actual.x-expected[0],actual.y-expected[1])<.01,'no temporary magnification from old smoothed depth');
});

test('a drifting provisional warp retries the last accepted image without decoding',async()=>{
  const f=fixture({text:'qr7'}),h=moduleHarness(f);
  const a=await new h.c.QrAnchor({video:h.video,target:'qr7'}).init();a.update();let stage=1;
  a._core={...core,trackCentres(frame,options){
    if(stage===2&&options.previous.poseNeedsRefinement)return null;
    const r=core.trackCentres(frame,options);if(r&&stage===1)r.poseNeedsRefinement=true;return r;
  },refineTrackedGeometry(...args){return stage===1?null:core.refineTrackedGeometry(...args);}};
  h.setTime(40);h.video.currentTime=.04;a.update();assert.equal(a._lastSeen,0);assert.equal(a._centreResult.time,40);
  stage=2;h.setTime(80);h.video.currentTime=.08;a.update();
  assert.equal(a._lastSeen,80);assert.equal(a._lastDecoded,0);assert.equal(a.getLatest().diagnostics.stablePoseRecovery,true);
});
