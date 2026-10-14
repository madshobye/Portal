// Classic worker entry. Reuses the same tested analysis engine as the main-thread
// fallback, with OffscreenCanvas and a transferred frame instead of a camera.
let anchor,source,rgbaCanvas;
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      importScripts(data.coreUrl,data.moduleUrl);
      source={readyState:2,videoWidth:0,videoHeight:0,currentTime:-1,source:null};
      anchor=await new QrAnchor({...data.options,video:source,worker:false,smoothing:1,renderSmoothingMs:0,kalmanFilter:false}).init();
      self.postMessage({type:'ready'});return;
    }
    if(data.type==='reset') {
      anchor.stop();anchor._lastVideoTime=-1;
      if(typeof data.centreTracking==='boolean')anchor.setCentreTracking(data.centreTracking);
      return;
    }
    if(data.type!=='frame'||!anchor)return;
    const started=performance.now();
    try {
      if(data.bitmap)source.source=data.bitmap;
      else {
        if(!rgbaCanvas||rgbaCanvas.width!==data.width||rgbaCanvas.height!==data.height)rgbaCanvas=new OffscreenCanvas(data.width,data.height);
        rgbaCanvas.getContext('2d').putImageData(new ImageData(data.rgba,data.width,data.height),0,0);
        source.source=rgbaCanvas;
      }
      source.videoWidth=data.width;source.videoHeight=data.height;source.currentTime=data.time;
      anchor.update(data.now);
      if(anchor.error)throw anchor.error;
      const observed=anchor._lastSeen===data.now,r=observed?anchor._result:null;
      // Never clone image pyramids, previous frames or mutable tracking state.
      const result=r?{text:r.text,dimension:r.dimension,pose:r.pose,corners:r.corners,finderCentres:r.finderCentres,
        intrinsics:r.intrinsics,frameWidth:r.frameWidth,frameHeight:r.frameHeight,confidence:r.confidence,
        decoded:r.decoded,identityVerified:r.identityVerified,time:r.time}:null;
      const nextScanAt=Math.max(data.now+1000/anchor.fps-1,anchor.centreTracking&&!anchor._reference?anchor._lastRecoverySearch+120:0);
      self.postMessage({type:'frame',generation:data.generation,now:data.now,nextScanAt,observed,result,
        released:!anchor._result,status:anchor._status,diagnostics:{...anchor._diagnostics,processingMs:performance.now()-started}});
    } finally {data.bitmap?.close();source.source=null;}
  } catch(error) {self.postMessage({type:'error',message:error.message||String(error)});}
};
