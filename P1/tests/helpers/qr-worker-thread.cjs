// Node worker adapter for the browser worker entry. Canvas resampling is the same
// pixel fixture used by synchronous tests; analysis runs in a real separate thread.
const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {cropPixels}=require('./qr-anchor.cjs');
global.self=global;
global.postMessage=data=>parentPort.postMessage(data);
global.importScripts=(...urls)=>{for(const url of urls)vm.runInThisContext(fs.readFileSync(new URL(url),'utf8'),{filename:url});};
global.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
global.OffscreenCanvas=class {
  constructor(width,height){this.width=width;this.height=height;this.data=null;}
  getContext(){const canvas=this;return {
    putImageData(image){canvas.data=image.data;},
    drawImage(source,x,y,w,h,dx,dy,width,height){canvas.data=cropPixels(source,x,y,w,h,width,height);},
    getImageData(){return {data:canvas.data};},
  };}
};
vm.runInThisContext(fs.readFileSync(path.join(workerData.root,'portal/qr-anchor/worker.js'),'utf8'));
parentPort.on('message',data=>self.onmessage({data}));
