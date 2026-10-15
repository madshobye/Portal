// One frame in flight. The display thread never waits for QR analysis.
(function(global) {
  class QrWorker {
    static async create(moduleUrl,options,onResult,onError) {
      const client=new QrWorker(onResult,onError);
      const url=new URL('qr-anchor/worker.js',moduleUrl);
      url.search=new URL(moduleUrl).search;
      let blobUrl=null;
      try {
        try {client.worker=new Worker(url);}
        catch(error) {
          // Cloud-editor sketches load Portal from a different origin. A local
          // bootstrap can import the public, absolute Portal script URLs.
          const response=await fetch(url);
          if(!response.ok)throw Error(`QR worker: HTTP ${response.status}`);
          blobUrl=URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'}));
          client.worker=new Worker(blobUrl);
        }
        await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(Error('QR worker did not start')),10000);
          client.worker.onerror=event=>{clearTimeout(timeout);reject(Error(event.message||'QR worker failed'));};
          client.worker.onmessage=({data})=>{
            if(data.type!=='ready'&&data.type!=='error')return;
            clearTimeout(timeout);
            if(data.type==='error')reject(Error(data.message));else resolve();
          };
          const coreUrl=new URL('qr-anchor/core.js',moduleUrl);coreUrl.search=url.search;
          client.worker.postMessage({type:'init',moduleUrl,coreUrl:coreUrl.href,options});
        });
        client.worker.onerror=event=>client.fail(Error(event.message||'QR worker failed'));
        client.worker.onmessage=({data})=>{
          if(data.type==='error'){client.fail(Error(data.message));return;}
          if(data.type!=='frame')return;
          client.busy=false;
          if(!client.disposed&&data.generation===client.generation)onResult(data);
        };
        return client;
      } catch(error) {client.dispose();throw error;}
      finally {if(blobUrl)URL.revokeObjectURL(blobUrl);}
    }
    constructor(onResult,onError) {
      this.onError=onError;this.busy=false;this.generation=0;this.disposed=false;
      this.canvas=null;this.context=null;this.bitmapSupported=true;
    }
    send(video,now,motion=null) {
      if(this.busy||this.disposed)return false;
      this.busy=true;
      const generation=this.generation,time=video.currentTime,width=video.videoWidth,height=video.videoHeight;
      // Reserve the slot before asynchronous bitmap creation: no second capture
      // or queued request is allowed while either capture or analysis is pending.
      this.capture(video,width,height).then(frame=>{
        if(this.disposed||generation!==this.generation){frame.bitmap?.close();this.busy=false;return;}
        try {this.worker.postMessage({type:'frame',generation,now,time,width,height,motion,...frame},frame.bitmap?[frame.bitmap]:[frame.rgba.buffer]);}
        catch(error){frame.bitmap?.close();throw error;}
      }).catch(error=>{this.busy=false;if(!this.disposed&&generation===this.generation)this.fail(error);});
      return true;
    }
    async capture(video,width,height) {
      if(this.bitmapSupported&&typeof createImageBitmap==='function') {
        try{return {bitmap:await createImageBitmap(video)};}
        catch(error){this.bitmapSupported=false;}
      }
      // Some browsers cannot create an ImageBitmap directly from a video. Only
      // capture/readback stays here; all detection, flow and decoding stay remote.
      if(!this.canvas) {
        this.canvas=document.createElement('canvas');
        this.context=this.canvas.getContext('2d',{willReadFrequently:true});
        if(!this.context)throw Error('QR frame capture unavailable');
      }
      if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
      this.context.drawImage(video,0,0,width,height);
      return {rgba:this.context.getImageData(0,0,width,height).data};
    }
    reset(centreTracking) {
      this.generation++;
      if(!this.disposed)this.worker.postMessage({type:'reset',centreTracking});
    }
    fail(error) {this.dispose();this.onError(error);}
    dispose() {
      this.disposed=true;this.generation++;this.busy=false;this.worker?.terminate();
      if(this.canvas){this.canvas.width=0;this.canvas.height=0;}
      this.canvas=null;this.context=null;
    }
  }
  global.PortalQrAnchorWorker=QrWorker;
})(globalThis);
