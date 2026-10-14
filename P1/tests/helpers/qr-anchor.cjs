const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../..');
const context=vm.createContext({console,TextDecoder,TextEncoder,Uint8ClampedArray,Uint8Array,Int32Array,Float64Array,performance});
vm.runInContext(fs.readFileSync(path.join(root,'portal/qr-anchor/core.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'portal/qrCodeGen.js'),'utf8'),context);
const core=context.PortalQrAnchorCore;
const mul=(a,b)=>Array.from({length:9},(_,i)=>[0,1,2].reduce((s,k)=>s+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
function fixture({text='qr2',angles=[0,0,0],position=[0,0,3],width=640,height=480,version=1,noise=0,focal=600}={}) {
  context.fixtureText=text;context.fixtureVersion=version;
  const qr=vm.runInContext('qrcodegenSetup(); qrcodegen.QrCode.encodeSegments(qrcodegen.QrSegment.makeSegments(fixtureText), qrcodegen.QrCode.Ecc.MEDIUM, fixtureVersion, fixtureVersion)',context);
  const [a,b,c]=angles;
  const rx=[1,0,0,0,Math.cos(a),-Math.sin(a),0,Math.sin(a),Math.cos(a)];
  const ry=[Math.cos(b),0,Math.sin(b),0,1,0,-Math.sin(b),0,Math.cos(b)];
  const rz=[Math.cos(c),-Math.sin(c),0,Math.sin(c),Math.cos(c),0,0,0,1];
  const pose={rotation:mul(mul(mul(rz,ry),rx),[1,0,0,0,-1,0,0,0,-1]),position};
  const intrinsics={fx:focal,fy:focal,cx:width/2,cy:height/2};
  const coords=[[-.5,.5,0],[.5,.5,0],[.5,-.5,0],[-.5,-.5,0]];
  const corners=coords.map(p=>core.project(pose,p,intrinsics).slice(0,2));
  const inverse=core.homography(corners,[[0,0],[qr.size,0],[qr.size,qr.size],[0,qr.size]]);
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let value=0;
    for(const [dx,dy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]) {
      const [u,v]=core.transform(inverse,[x+dx,y+dy]);
      value+=qr.getModule(Math.floor(u),Math.floor(v))?15:240;
    }
    value=value/4+noise*Math.sin(x*37+y*61);
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  return {data,width,height,intrinsics,pose,corners,qr};
}
// Simulate canvas crop/resampling so tests exercise real pixels in native ROIs.
function cropPixels(f,x,y,w,h,width,height) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let j=0;j<height;j++) for(let i=0;i<width;i++) {
    const px=Math.max(0,Math.min(f.width-1,x+(i+.5)*w/width-.5));
    const py=Math.max(0,Math.min(f.height-1,y+(j+.5)*h/height-.5));
    const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(f.width-1,x0+1),y1=Math.min(f.height-1,y0+1);
    const dx=px-x0,dy=py-y0;
    for(let c=0;c<4;c++) data[(j*width+i)*4+c]=
      f.data[(y0*f.width+x0)*4+c]*(1-dx)*(1-dy)+f.data[(y0*f.width+x1)*4+c]*dx*(1-dy)+
      f.data[(y1*f.width+x0)*4+c]*(1-dx)*dy+f.data[(y1*f.width+x1)*4+c]*dx*dy;
  }
  return data;
}
function htmlNode(tag) {
  return {tag,style:{},children:[],textContent:'',
    append(...nodes){for(const n of nodes){this.children.push(n);if(typeof n==='object') n.parent=this;}},
    prepend(n){this.children.unshift(n);n.parent=this;},
    setAttribute(){},remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);},
    get lastElementChild(){return this.children.at(-1);},
  };
}
function moduleHarness(f,environment={}) {
  let now=0,nextTimer=1;
  const timers=new Map(),delays=new Map(),drawCalls=[];
  const video={readyState:2,videoWidth:f.width,videoHeight:f.height,currentTime:0,
    pause(){throw new Error('must not pause supplied camera');},
    get srcObject(){throw new Error('must not access camera tracks');}};
  const c=vm.createContext({console,URLSearchParams,location:{search:''},performance:{now:()=>now},width:390,height:844,
    PortalQrAnchorCore:core,ZXing:{unchanged:true},
    navigator:{mediaDevices:{getUserMedia(){throw new Error('must not acquire camera');}}},
    document:{body:htmlNode('body'),createElement(type){
      if(type!=='canvas') return htmlNode(type);
      let rect;
      const canvas={width:0,height:0,getContext(){return {
        drawImage(source,x,y,w,h,dx,dy,width,height){
          assert.equal(source,video);
          if(arguments.length===5){width=w;height=h;w=f.width;h=f.height;dx=dy=0;}
          assert.equal(dx,0);assert.equal(dy,0);
          rect={x,y,w,h,width,height};drawCalls.push(rect);
        },
        getImageData(){return {data:cropPixels(f,rect.x,rect.y,rect.w,rect.h,canvas.width,canvas.height)};}
      };}};
      return canvas;
    }},
    setTimeout(fn,delay){const id=nextTimer++;timers.set(id,fn);delays.set(id,delay);return id;},
    clearTimeout(id){timers.delete(id);delays.delete(id);},
  });
  Object.assign(c,environment);
  if(environment.moduleUrl)c.document.currentScript={src:environment.moduleUrl};
  vm.runInContext(fs.readFileSync(path.join(root,'portal/QrAnchor.js'),'utf8'),c);
  return {c,video,timers,delays,drawCalls,setTime(t){now=t;},advanceTime(t){now+=t;},
    runTimer(){const [id,fn]=timers.entries().next().value;now+=delays.get(id);timers.delete(id);delays.delete(id);fn();}};
}

module.exports={core,context,fixture,root,cropPixels,htmlNode,moduleHarness};
