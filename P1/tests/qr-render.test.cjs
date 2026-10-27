const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture,moduleHarness,root}=require('./helpers/qr-anchor.cjs');

function harness() {
  const f=fixture(),h=moduleHarness(f),events=new Map(),hooks={},layers=[],calls=[];
  let density=2,owner={},addons=0;
  Object.assign(h.c,{
    p5:{get instance(){return owner;},registerAddon(fn){addons++;fn(this,{},hooks);}},
    addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
    removeEventListener(name,fn){events.get(name)?.delete(fn);},
    width:640,height:480,WEBGL:'webgl',CORNER:'corner',BLEND:'blend',LEFT:'left',TOP:'top',
    push(){calls.push('push');},pop(){calls.push('pop');},resetMatrix(){},imageMode(){},noTint(){},blendMode(){},
    background(){calls.push('background');},pixelDensity:()=>density,
    noStroke(){},fill(){},rectMode(){},rect(){},textSize(){},textAlign(){},text(message){calls.push(message);},
    image(layer,x,y,w,hh){assert.equal(layer.width,w);assert.equal(layer.height,hh);calls.push('image');},
    drawingContext:{save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){calls.push('camera');}},
    createGraphics(w,hh,type){
      assert.equal(type,'webgl');let d=1;
      const layer={width:w,height:hh,removed:0,resizes:0,densityChanges:0,
        pixelDensity(value){if(value!==undefined){d=value;this.densityChanges++;}return d;},
        resizeCanvas(w,hh){this.width=w;this.height=hh;this.resizes++;},
        reset(){calls.push('reset layer');},clear(){calls.push('clear layer');},remove(){this.removed++;},
        push(){},pop(){calls.push('pop layer');},resetMatrix(){},scale(){},applyMatrix(){},
        _renderer:{camera(){},frustum(...args){layer.projection=args;}},
        noStroke(){},ambientLight(){},directionalLight(){},translate(){},rotateZ(){},fill(){},box(){calls.push('box');},sphere(){calls.push('sphere');}};
      layers.push(layer);return layer;
    },
  });
  return {f,h,layers,calls,events,hooks,get addons(){return addons;},get owner(){return owner;},
    setOwner(value){owner=value;},setDensity(value){density=value;}};
}
test('create starts with stable defaults, preserves constructor defaults, and cleans failed initialization',async()=>{
  const t=harness(),{h}=t;
  const old=new h.c.QrAnchor({video:h.video});
  assert.equal(old.kalmanFilter,false);assert.equal(old.rotationStabilization,false);assert.equal(old.smoothing,.55);
  const a=await h.c.QrAnchor.create({video:h.video});
  assert.equal(a.running,true);assert.equal(a.rotationStabilization,true);assert.equal(a.kalmanFilter,true);assert.equal(a.smoothing,1);
  assert.equal(t.layers.length,0,'no GPU allocation until render');
  const b=await h.c.QrAnchor.create({video:h.video,kalmanFilter:false,smoothing:.7});
  assert.equal(b.kalmanFilter,false);assert.equal(b.smoothing,.7);assert.equal(t.addons,1);
  await assert.rejects(h.c.QrAnchor.create(),/existing video/);
  assert.equal(t.events.get('pagehide').size,2,'failed init removes its listener');
  a.dispose();b.dispose();old.dispose();assert.equal(h.timers.size,0);
});
test('render aligns camera and layer after main-canvas-only resize and density changes',async()=>{
  const t=harness(),{h,layers,calls}=t,a=await h.c.QrAnchor.create({video:h.video});
  let callbacks=0;
  const scene=g=>{assert.equal(g,layers[0]);callbacks++;calls.push('scene');};
  a.render(scene);const layer=layers[0],before=layer.projection;
  assert.equal(layer.pixelDensity(),2);assert.equal(layer.densityChanges,1);
  assert.ok(calls.indexOf('clear layer')<calls.indexOf('scene'));assert.ok(calls.indexOf('camera')<calls.indexOf('image'));
  a.render(scene);assert.equal(layer.resizes,0);assert.equal(layer.densityChanges,1);assert.equal(layers.length,1);
  // Portal fullscreen and delayed viewport resizing do not notify this graphics layer.
  h.c.width=960;h.c.height=540;a.render(scene);
  assert.equal(layer.resizes,1);assert.equal(layer.width,960);assert.equal(layer.height,540);
  assert.notDeepEqual(layer.projection,before,'frustum follows the resized viewport');
  h.c.width=390;h.c.height=844;t.setDensity(1);a.render(scene);
  assert.equal(layer.resizes,2);assert.equal(layer.pixelDensity(),1);assert.equal(callbacks,4);
  a.stop();assert.equal(layer.removed,1);a.start();a.render(()=>{});
  assert.equal(layers.length,2,'restart can create a fresh owned layer');a.dispose();assert.equal(layers[1].removed,1);
});
test('render clears stale models, reports search/errors, respects debug and restores state on exceptions',async()=>{
  const t=harness(),{h,calls}=t,a=await h.c.QrAnchor.create({video:h.video});
  let models=0,markers=0;a.drawFinderMarkers=()=>{markers++;};
  a.render(()=>models++);assert.equal(models,1);assert.equal(markers,0);
  a.render(()=>models++,{debug:true});assert.equal(markers,1);
  h.setTime(1000);calls.length=0;a.render(()=>models++);
  assert.equal(models,2,'expired poses do not invoke the scene');assert.ok(calls.includes('clear layer'));assert.ok(calls.includes('Show qr2'));
  a.error=new Error('capture failed');calls.length=0;a.render(()=>{});assert.ok(calls.includes('QR error: capture failed'));
  calls.length=0;a.render(()=>{},{status:false});assert.ok(!calls.includes('QR error: capture failed'));
  h.setTime(0);a.error=null;
  assert.throws(()=>a.render(()=>{throw Error('scene failure');}),/scene failure/);
  assert.equal(calls.at(-1),'pop');assert.ok(calls.includes('pop layer'));
  a.dispose();const count=calls.length;a.render(()=>models++);assert.equal(calls.length,count);
});
test('p5 remove cleans only its own anchors; pagehide and repeated disposal are safe',async()=>{
  const t=harness(),{h,layers}=t,firstOwner=t.owner;
  const a=await h.c.QrAnchor.create({video:h.video});a.render(()=>{});
  t.setOwner({});const b=await h.c.QrAnchor.create({video:h.video});b.render(()=>{});
  t.hooks.remove.call(firstOwner);
  assert.equal(a._disposed,true);assert.equal(b._disposed,false);assert.equal(layers[0].removed,1);
  for(const fn of [...t.events.get('pagehide')])fn();
  assert.equal(b._disposed,true);assert.equal(layers[1].removed,1);assert.equal(h.timers.size,0);
  a.dispose();b.dispose();assert.equal(layers[0].removed,1);assert.equal(t.events.get('pagehide').size,0);
});
test('beginner sketch boots and draws p5 shapes without managing a graphics layer',async()=>{
  const t=harness(),{h,calls}=t;
  Object.assign(h.c,{windowWidth:640,windowHeight:480,createCanvas(){},loadScript:async()=>{},setupWebcamera:async()=>h.video,millis:()=>100});
  vm.runInContext(fs.readFileSync(path.join(root,'sketches/qr-anchor-basic/sketch.js'),'utf8'),h.c);
  await vm.runInContext('setup()',h.c);vm.runInContext('draw()',h.c);
  assert.ok(calls.includes('box'));assert.ok(calls.includes('sphere'));
  h.c.width=800;vm.runInContext('draw()',h.c);assert.equal(t.layers[0].width,800);
  for(const fn of [...t.events.get('pagehide')])fn();
});
