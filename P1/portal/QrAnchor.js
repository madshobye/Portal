// QR-based 3D anchor prototype. Receives a Portal camera; never acquires/stops it.
// Local core is isolated from window.ZXing and the existing QrReader module.
(function (global) {
  const moduleUrl=global.document?.currentScript?.src||null;
  let corePromise;
  async function loadCore() {
    if (global.PortalQrAnchorCore) return global.PortalQrAnchorCore;
    if (!corePromise) {
      corePromise = loadScript('portal/qr-anchor/core.js').then(() => {
        if (!global.PortalQrAnchorCore) throw new Error('QrAnchor core failed to load');
        return global.PortalQrAnchorCore;
      }).catch(error => { corePromise = null; throw error; });
    }
    return corePromise;
  }
  function matrix(pose) {
    const r=pose.rotation,t=pose.position;
    return [r[0],r[3],r[6],0,r[1],r[4],r[7],0,r[2],r[5],r[8],0,...t,1];
  }
  function smoothPose(previous,current,alpha) {
    if (!previous || alpha===1) return current;
    const blend=current.rotation.map((v,i)=>previous.rotation[i]*(1-alpha)+v*alpha);
    const normalize=a=>{const n=Math.hypot(...a);return n>1e-6?a.map(v=>v/n):null;};
    const x=normalize([blend[0],blend[3],blend[6]]),y0=[blend[1],blend[4],blend[7]];
    if(!x) return current;
    const dot=x.reduce((s,v,i)=>s+v*y0[i],0),y=normalize(y0.map((v,i)=>v-dot*x[i]));
    if(!y) return current;
    const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
    const pose={...current,rotation:[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]],
      position:current.position.map((v,i)=>previous.position[i]*(1-alpha)+v*alpha)};
    pose.matrix=matrix(pose);
    return pose;
  }
  class QrAnchor {
    constructor({video,target='qr2',markerSize=1,horizontalFov=60,intrinsics=null,maxWidth=640,fps=30,smoothing=0.55,lostAfterMs=650,maxReprojectionError=3,maxReuseMs=3000,highResSearchIntervalMs=1000,renderSmoothingMs=0,recoveryMs=350,roiPadding=.5,kalmanFilter=false,predictionMs=150,patternIntervalMs=4000,patternMatchThreshold=.3,patternConfirmMs=3000,centreTracking=true,worker=true}={}) {
      if(!Number.isFinite(markerSize)||markerSize<=0) throw new Error('markerSize must be positive');
      if(!Number.isFinite(horizontalFov)||horizontalFov<=10||horizontalFov>=150) throw new Error('horizontalFov must be between 10 and 150 degrees');
      if(!Number.isFinite(smoothing)||smoothing<=0||smoothing>1) throw new Error('smoothing must be > 0 and <= 1');
      if(!Number.isFinite(maxWidth)||maxWidth<64||!Number.isFinite(fps)||fps<=0||!Number.isFinite(lostAfterMs)||lostAfterMs<0||!Number.isFinite(maxReprojectionError)||maxReprojectionError<=0) throw new Error('Invalid QrAnchor tracking options');
      if(!Number.isFinite(maxReuseMs)||maxReuseMs<=0||!Number.isFinite(highResSearchIntervalMs)||highResSearchIntervalMs<=0) throw new Error('Invalid QrAnchor search intervals');
      if(!Number.isFinite(renderSmoothingMs)||renderSmoothingMs<0) throw new Error('renderSmoothingMs must be nonnegative');
      if(!Number.isFinite(recoveryMs)||recoveryMs<0||recoveryMs>1000||!Number.isFinite(roiPadding)||roiPadding<.2||roiPadding>1||typeof kalmanFilter!=='boolean'||!Number.isFinite(predictionMs)||predictionMs<0||predictionMs>250) throw new Error('Invalid recovery/prediction options');
      if(!Number.isFinite(patternIntervalMs)||patternIntervalMs<0||patternIntervalMs>60000||!Number.isFinite(patternMatchThreshold)||patternMatchThreshold<0||patternMatchThreshold>1||!Number.isFinite(patternConfirmMs)||patternConfirmMs<0||patternConfirmMs>10000) throw new Error('Invalid pattern verification intervals');
      if(typeof worker!=='boolean')throw new Error('worker must be boolean');
      this.useWorker=worker;this._worker=null;
      if(typeof centreTracking!=='boolean') throw new Error('centreTracking must be boolean');
      if(target!==null&&typeof target!=='string') throw new Error('target must be a string or null');
      if(intrinsics&&(!['fx','fy','width','height'].every(k=>Number.isFinite(intrinsics[k])&&intrinsics[k]>0)||!['cx','cy'].every(k=>Number.isFinite(intrinsics[k])))) throw new Error('intrinsics requires fx, fy, cx, cy, width and height');
      this.video=video;this.videoElement=video?.elt||video;this.target=target;this.markerSize=markerSize;
      this.horizontalFov=horizontalFov;this.intrinsics=intrinsics;this.maxWidth=maxWidth;this.fps=fps;
      this.smoothing=smoothing;this.lostAfterMs=lostAfterMs;this.maxReprojectionError=maxReprojectionError;
      this.maxReuseMs=maxReuseMs;this.highResSearchIntervalMs=highResSearchIntervalMs;
      this.renderSmoothingMs=renderSmoothingMs;this._renderPose=null;this._positionCorrection=null;this._lastRender=-Infinity;
      this.centreTracking=centreTracking;
      this.patternIntervalMs=patternIntervalMs;this.patternMatchThreshold=patternMatchThreshold;this.patternConfirmMs=patternConfirmMs;
      this.recoveryMs=recoveryMs;this.roiPadding=roiPadding;this.kalmanFilter=kalmanFilter;this.predictionMs=predictionMs;
      this._diagnostics={};this._lastRender=-Infinity;
      this._sourceWidth=0;this._sourceHeight=0;this._focalScale=1;
      this.ready=false;this.running=false;this.error=null;this._disposed=false;this._timer=null;
      this._lastVideoTime=-1;this._lastScan=-Infinity;this._status='idle';
      this._resetTracking();
    }
    _resetTracking() {
      this._result=null;this._renderPose=null;this._positionCorrection=null;this._kalman=null;this._nextWorkerFrame=0;
      this._reference=null;this._reliableResult=null;this._centreResult=null;
      this._lastSeen=-Infinity;this._lastDecoded=-Infinity;this._lastCentreRefine=-Infinity;
      this._lastRecoverySearch=-Infinity;this._lastHighSearch=-Infinity;this._misses=0;
      this._lastPatternVerified=-Infinity;this._nextPatternCheck=0;this._patternState=null;
      this._patternSuspectSince=null;this._nextPatternDecode=0;
    }
    async init() {
      if(this._disposed) throw new Error('QrAnchor has been disposed');
      if(this.ready) return this;
      if(!this.videoElement||typeof this.videoElement.readyState!=='number') throw new Error('QrAnchor requires an existing video or p5 capture in { video }');
      this._core=await loadCore();
      if(this._disposed) throw new Error('QrAnchor has been disposed');
      this._canvas=typeof document==='undefined'?new OffscreenCanvas(1,1):document.createElement('canvas');
      this._context=this._canvas.getContext('2d',{willReadFrequently:true});
      if(!this._context) throw new Error('QrAnchor could not create a frame canvas');
      if(this.useWorker&&moduleUrl&&typeof Worker==='function'&&typeof OffscreenCanvas==='function') {
        try {
          await loadScript('portal/qr-anchor/worker-client.js');
          const options={};
          for(const key of ['target','markerSize','horizontalFov','intrinsics','maxWidth','fps','lostAfterMs','maxReprojectionError','maxReuseMs','highResSearchIntervalMs','recoveryMs','roiPadding','patternIntervalMs','patternMatchThreshold','patternConfirmMs','centreTracking'])options[key]=this[key];
          const client=await global.PortalQrAnchorWorker.create(moduleUrl,options,data=>this._receiveWorker(data),error=>{
            this.error=error;this._resetTracking();this._status='error';this.running=false;clearTimeout(this._timer);
          });
          if(this._disposed){client.dispose();throw Error('QrAnchor has been disposed');}
          this._worker=client;
        } catch(error) {
          if(this._disposed)throw error;
          this._workerUnavailable=error.message; // Explicit fallback diagnostic.
        }
      }
      if(this._disposed)throw Error('QrAnchor has been disposed');
      this.ready=true;this._status='searching';return this;
    }
    start() {
      if(!this.ready||this._disposed) throw new Error('Call await QrAnchor.init() first');
      if(this.running) return this;
      this.running=true;this.error=null;this._lastVideoTime=-1;this._lastScan=-Infinity;
      const tick=()=>{
        if(!this.running) return;
        const started=performance.now();
        this.update(started);
        // The interval is measured start-to-start; processing is part of it.
        const remaining=1000/this.fps-(performance.now()-started);
        if(this.running) this._timer=setTimeout(tick,Math.max(0,remaining));
      };
      tick();return this;
    }
    stop() {
      this.running=false;clearTimeout(this._timer);this._timer=null;
      this._worker?.reset();
      this._resetTracking();
      this._misses=0;this._lastHighSearch=-Infinity;this._status='stopped';this._diagnostics={};return this;
    }
    dispose() {
      this.stop();this.ready=false;this._disposed=true;this._worker?.dispose();this._worker=null;
      if(this._canvas){this._canvas.width=0;this._canvas.height=0;}
      this._canvas=null;this._context=null;
      // Camera belongs to the sketch. Do not pause it or stop its MediaStream tracks.
    }
    _readFrame(rect,limit=this.maxWidth) {
      const scale=Math.min(1,limit/Math.max(rect.width,rect.height));
      const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
      if(this._canvas.width!==width||this._canvas.height!==height) {
        this._canvas.width=width;this._canvas.height=height;
      }
      // Always crop from the native video, never enlarge the coarse search image.
      this._context.drawImage(this.videoElement.source||this.videoElement,rect.x,rect.y,rect.width,rect.height,0,0,width,height);
      return {data:this._context.getImageData(0,0,width,height).data,width,height,
        scaleX:width/rect.width,scaleY:height/rect.height,rect};
    }
    _bounds(points,padding) {
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys);
      // Minimum padding helps small targets; include quiet zone and room for motion.
      const pad=Math.max(16,Math.max(x1-x0,y1-y0)*padding);
      const x=Math.max(0,Math.floor(x0-pad)),y=Math.max(0,Math.floor(y0-pad));
      const right=Math.min(this._sourceWidth,Math.ceil(x1+pad)),bottom=Math.min(this._sourceHeight,Math.ceil(y1+pad));
      return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};
    }
    _trackingBounds(now) {
      const points=this._result.corners.slice(),last=this._centreResult;
      if(this.centreTracking&&last?.centreTracking) {
        const motion=last.centreTracking,dt=Math.min(3,(now-last.time)/Math.max(16,motion.gapMs||1000/this.fps));
        const median=axis=>motion.velocity.map(p=>p[axis]).sort((a,b)=>a-b)[1];
        const span=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]));
        const dx=Math.max(-span*.75,Math.min(span*.75,median(0)/last.crop.sx*dt));
        const dy=Math.max(-span*.75,Math.min(span*.75,median(1)/last.crop.sy*dt));
        points.push(...points.map(([x,y])=>[x+dx,y+dy]));
      }
      return this._bounds(points,Math.min(1,this.roiPadding+this._misses*.35));
    }
    _intrinsics(width,height) {
      const c=this.intrinsics,f=this._focalScale*width/(2*Math.tan(this.horizontalFov*Math.PI/360));
      return c?{fx:c.fx*width/c.width,fy:c.fy*height/c.height,cx:c.cx*width/c.width,cy:c.cy*height/c.height}:
        {fx:f,fy:f,cx:width/2,cy:height/2};
    }
    _patternPolicy(now) {
      if(!this.patternIntervalMs) return null;
      const mode=this._patternSuspectSince!==null?'suspect':now>=this._nextPatternCheck?'check':this._patternState==='deferred'?'deferred':'cached';
      return {mode,threshold:this.patternMatchThreshold};
    }
    _verifyTrackedIdentity(result,frame,now) {
      if(!this.patternIntervalMs) return true;
      if(result.decoded) {
        this._lastPatternVerified=now;this._nextPatternCheck=now+this.patternIntervalMs;
        this._patternState='verified';this._patternSuspectSince=null;
        return true;
      }
      if(this._diagnostics.patternAttempted) {
        this._patternState=result.patternVerification;
        this._nextPatternCheck=now+(result.patternVerification==='deferred'?250:this.patternIntervalMs);
        if(result.patternVerification==='verified') this._lastPatternVerified=now;
        if(result.patternVerification==='suspect'&&this._patternSuspectSince===null) {
          this._patternSuspectSince=now;this._nextPatternDecode=now;
        }
      }
      if(this._patternSuspectSince===null) return true;
      this._diagnostics.identityVerification='confirming';
      if(now>=this._nextPatternDecode) {
        this._nextPatternDecode=now+500;
        const text=this._core.decodeTracked(frame.data,frame.width,frame.height,result.homography,result.reference);
        this._diagnostics.identityDecodedText=text;
        if(text===result.reference.text) {
          result.identityVerified=true;result.patternVerification='verified';
          this._lastPatternVerified=now;this._nextPatternCheck=now+this.patternIntervalMs;
          this._patternState='verified';this._patternSuspectSince=null;
          this._diagnostics.identityVerification='confirmed';
          return true;
        }
      }
      if(now-this._patternSuspectSince<this.patternConfirmMs) return true;
      // Confirmation failed over the whole window: release the old anchor and
      // require normal acquisition, rather than carrying its identity forward.
      this._diagnostics.identityVerification='restart';
      this._diagnostics.trackingReason='identity confirmation timed out';
      this._reference=null;this._reliableResult=null;this._centreResult=null;this._result=null;this._lastSeen=-Infinity;
      this._renderPose=null;this._positionCorrection=null;this._kalman=null;
      this._patternSuspectSince=null;this._nextPatternCheck=0;this._patternState=null;this._misses=2;
      return false;
    }
    _detectCrop(rect,k,reference,decode,now) {
      const previous=(this.centreTracking&&this._centreResult)||this._reliableResult;
      let limit=this.maxWidth;
      if(this.recoveryMs&&this._misses>0&&reference&&!decode&&previous?.crop) {
        // Widen the field of view without abruptly shrinking the tracked patches.
        // Extra pixels are bounded and used only during recovery, never upscaled.
        const required=Math.ceil(Math.max(rect.width*previous.crop.sx,rect.height*previous.crop.sy));
        limit=Math.min(this.maxWidth*2,Math.max(this.maxWidth,required));
      }
      const frame=this._readFrame(rect,limit),sx=frame.scaleX,sy=frame.scaleY;
      this._diagnostics.cropWidth=frame.width;this._diagnostics.cropHeight=frame.height;
      const intrinsics={fx:k.fx*sx,fy:k.fy*sy,cx:(k.cx-rect.x)*sx,cy:(k.cy-rect.y)*sy};
      const pixels=this._core.prepareTrackingFrame(frame.data,frame.width,frame.height);
      let result=null;
      const patternPolicy=this._patternPolicy(now);
      if(!decode&&reference&&this.centreTracking&&previous?.centreTracking) {
        const old=previous.crop;
        result=this._core.trackCentres(pixels,{previous,reference,intrinsics,markerSize:this.markerSize,
          gapMs:now-previous.time,maxReprojectionError:this.maxReprojectionError,patternPolicy,diagnostics:this._diagnostics,
          mapping:[sx/old.sx,sy/old.sy,(old.rect.x-rect.x)*sx,(old.rect.y-rect.y)*sy]});
        if(result&&(result.poseNeedsRefinement||now-this._lastCentreRefine>=200)) {
          this._lastCentreRefine=now;
          const refined=this._core.refineTrackedGeometry(frame.data,frame.width,frame.height,reference,result.homography,
            {intrinsics,markerSize:this.markerSize,maxReprojectionError:this.maxReprojectionError});
          if(refined) {
            const {velocity,gapMs}=result.centreTracking;
            Object.assign(result,refined);

            result.centreTracking=this._core.seedCentres(pixels,result);
            result.centreTracking.velocity=velocity;result.centreTracking.gapMs=gapMs;
            this._diagnostics.outlinesRefined=true;result.poseNeedsRefinement=false;
          }
        }
        if(result?.poseNeedsRefinement){this._diagnostics.centreReason='pose fit';result=null;}
      }
      if(!this.centreTracking&&!result&&!decode&&reference&&previous?.tracking) {
        const old=previous.crop;
        result=this._core.track(pixels,{
          previous:previous.tracking,reference,intrinsics,markerSize:this.markerSize,
          maxReprojectionError:this.maxReprojectionError,ageMs:now-this._lastDecoded,
          gapMs:now-previous.time,maxReuseMs:this.maxReuseMs,diagnostics:this._diagnostics,
          maxGapMs:this.recoveryMs?Math.min(350,this.recoveryMs):180,patternPolicy,
          mapping:[sx/old.sx,sy/old.sy,(old.rect.x-rect.x)*sx,(old.rect.y-rect.y)*sy],
        });
        if(result&&!this.patternIntervalMs&&now-this._lastDecoded>=this.maxReuseMs) result=null;
      }
      // A missed centre is a tracking miss, not permission to decode. update()
      // keeps the last measured frame through a bounded recovery window.
      if(!result&&!decode&&this.centreTracking)return null;
      if(!result) {
        // Corner uncertainty must be resolved by a real decode, never by carrying
        // the old text onto a newly found group of similar finder squares.
        const options={target:this.target,innerFinders:this.centreTracking,markerSize:this.markerSize,maxReprojectionError:this.maxReprojectionError,intrinsics,diagnostics:this._diagnostics,
          focalScaleRange:this.intrinsics?null:[.6/this._focalScale,2/this._focalScale]};
        result=this._core.detect(frame.data,frame.width,frame.height,options);
        if(result) {
          if(!this.centreTracking)result.tracking=this._core.seedTracking(pixels,result);
          result.confidence=1;
        }
      }
      if(!result) return null;
      if(!this._verifyTrackedIdentity(result,frame,now)) return null;
      if(result.decoded) result.patternVerification='verified';
      if(!result.patternMatch&&result.patternVerification!=='cached'&&result.patternVerification!=='deferred'&&result.patternVerification!=='suspect') result.patternMatch=this._core.patternMatch(pixels[0],result.homography,result.reference);
      if(!result.patternMatch) result.patternMatch=this._result?.patternMatch||null;
      this._diagnostics.patternVerification=result.patternVerification||'verified';
      this._diagnostics.patternMatch=result.patternMatch;
      this._diagnostics.confidence=result.confidence;
      if(this.centreTracking&&!result.centreTracking) result.centreTracking=this._core.seedCentres(pixels,result);
      this._diagnostics.mode=result.decoded?'decoded':result.centreTracked?'centres':'corners';
      const resolved=result.intrinsics||intrinsics;
      const nativeK={fx:resolved.fx/sx,fy:resolved.fy/sy,cx:resolved.cx/sx+rect.x,cy:resolved.cy/sy+rect.y};
      if(!this.intrinsics) this._focalScale*=nativeK.fx/k.fx;
      // Published points/intrinsics are always in native video coordinates, so
      // changing ROI or processing resolution cannot move the rendered anchor.
      const dim=result.dimension;
      result.finderCentres=(result.centreTracking?.centres||[[3.5,3.5],[dim-3.5,3.5],[3.5,dim-3.5]].map(p=>this._core.transform(result.homography,p))).map(([x,y])=>[x/sx+rect.x,y/sy+rect.y]);
      result.corners=result.corners.map(([x,y])=>[x/sx+rect.x,y/sy+rect.y]);
      return {...result,time:now,crop:{rect,sx,sy},intrinsics:nativeK,frameWidth:this._sourceWidth,frameHeight:this._sourceHeight};
    }
    _search(k,limit,now) {
      const rect={x:0,y:0,width:this._sourceWidth,height:this._sourceHeight};
      const frame=this._readFrame(rect,limit);
      const candidate=this._core.locate(frame.data,frame.width,frame.height,{diagnostics:this._diagnostics});
      if(!candidate) return null;
      // Try the usual compact crop first; steep perspective may require the
      // union of all corner assignments to avoid cutting off the QR data area.
      for(const candidates of [candidate.points,candidate.expandedPoints]) {
        const points=candidates.map(([x,y])=>[x/frame.scaleX,y/frame.scaleY]);
        const result=this._detectCrop(this._bounds(points,0.55),k,null,true,now);
        if(result) return result;
      }
      return null;
    }
    _acceptResult(result,tracked,now,displayNow=now) {
      // Keep the visible pose continuous across reacquisition/filter resets.
      // This is display-only: a full search still resets the velocity estimate.
      const continuous=(this.kalmanFilter||!tracked)&&this.renderSmoothingMs>0&&this._result?.text===result.text&&now-this._lastSeen<=this.lostAfterMs;
      const displayedBefore=continuous?this._displayPose(displayNow):null;
      const previous=tracked&&this._result?.text===result.text?this._result.pose:null;
      if(!previous) {
        if(!continuous) {this._renderPose=null;this._positionCorrection=null;}
        this._kalman=null;
      }
      if(this.kalmanFilter) {
        if(!this._kalman) this._kalman=new this._core.PositionKalman(this.markerSize);
        this._kalman.observe(result.pose.position,now,result.confidence);
      }
      result.pose=smoothPose(previous,result.pose,this.smoothing);
      this._reference=result.reference;
      if(result.decoded||result.identityVerified) this._lastDecoded=now;
      if(result.tracking) this._reliableResult=result;
      if(result.centreTracking) this._centreResult=result;
      this._result=result;this._lastSeen=now;this._misses=0;this._status='tracking';this.error=null;
      if(displayedBefore) {
        const target=this._prediction(displayNow)?.position||result.pose.position;
        this._positionCorrection={time:displayNow,offset:displayedBefore.position.map((v,i)=>v-target[i])};
      }
    }
    _receiveWorker(data) {
      if(this._disposed)return;
      this._diagnostics={...data.diagnostics,backend:'worker'};
      if(data.released)this._resetTracking();
      if(data.observed) {
        const result=data.result;
        const resized=this._sourceWidth!==result.frameWidth||this._sourceHeight!==result.frameHeight;
        if(resized)this._resetTracking();
        this._sourceWidth=result.frameWidth;this._sourceHeight=result.frameHeight;
        this._acceptResult(result,!resized&&!result.decoded,data.now,performance.now());
      } else this._status=data.status;
      this._nextWorkerFrame=data.nextScanAt||0;
    }
    update(now=performance.now()) {
      if(!this.ready||this._disposed) return this.getLatest(now);
      const v=this.videoElement;
      if(v.readyState<2||!v.videoWidth||!v.videoHeight) return this.getLatest(now);
      if(v.currentTime===this._lastVideoTime||now-this._lastScan<1000/this.fps-1) return this.getLatest(now);
      if(this._worker) {
        if(now<this._nextWorkerFrame)return this.getLatest(now);
        if(this._worker.send(v,now)){this._lastVideoTime=v.currentTime;this._lastScan=now;}
        return this.getLatest(now);
      }
      const processingStarted=performance.now();
      this._lastVideoTime=v.currentTime;this._lastScan=now;
      this._diagnostics={finderCandidates:0,finderCount:0,geometryFound:false,poseValid:false};
      if(v.videoWidth!==this._sourceWidth||v.videoHeight!==this._sourceHeight) {
        this._sourceWidth=v.videoWidth;this._sourceHeight=v.videoHeight;this._focalScale=1;
        this._resetTracking();
        this._misses=0;this._lastHighSearch=-Infinity;
      }
      if(now-this._lastSeen>this.lostAfterMs) {this._reference=null;this._reliableResult=null;this._centreResult=null;}
      const k=this._intrinsics(v.videoWidth,v.videoHeight);
      try {
        let result=null,tracked=false;
        this._diagnostics.phase=this._reference?'track':'search';
        const recoveryReference=(this.centreTracking&&this._centreResult)||this._reliableResult;
        const recovering=this.recoveryMs>0&&recoveryReference&&now-recoveryReference.time<=this.recoveryMs;
        const tracking=!!this._reference&&!!this._result&&(this._misses<2||recovering);
        if(tracking) {
          const rect=this._trackingBounds(now);
          const decode=!this.patternIntervalMs&&((!recovering&&this._misses>0)||now-this._lastDecoded>=this.maxReuseMs);
          result=this._detectCrop(rect,k,this._reference,decode,now);
          tracked=!!result;
          if(!result){this._misses++;this._diagnostics.phase='recover';}
        }
        if(!result&&(!tracking||this._misses>=2)&&(!this.centreTracking||!recovering)&&(!this.centreTracking||now-this._lastRecoverySearch>=120)) {
          this._diagnostics.phase='search';this._diagnostics.searchAttempted=true;
          this._lastRecoverySearch=now;
          if(!recovering) {this._reference=null;this._reliableResult=null;this._centreResult=null;}
          result=this._search(k,this.maxWidth,now);
          // A small QR may disappear in the coarse image. Occasionally search
          // at higher resolution, but still refine/decode only its native ROI.
          if(!result&&Math.max(v.videoWidth,v.videoHeight)>this.maxWidth&&now-this._lastHighSearch>=this.highResSearchIntervalMs) {
            this._lastHighSearch=now;
            result=this._search(k,Math.min(this.maxWidth*2,Math.max(v.videoWidth,v.videoHeight)),now);
          }
        }
        if(result) {
          this._acceptResult(result,tracked,now);
        } else this._status='searching';
      } catch(error) {
        this.error=error;this._resetTracking();this._status='error';
        this.running=false;clearTimeout(this._timer);
      }
      this._diagnostics.processingMs=performance.now()-processingStarted;
      return this.getLatest(now);
    }
    _statusMessage(now,visible) {
      if(this.error) return this.error.message;
      if(this._status==='stopped') return 'Stopped';
      if(!this.ready) return 'Starting QR tracker…';
      if(this.videoElement.readyState<2||!this.videoElement.videoWidth) return 'Waiting for camera frames…';
      const d=this._diagnostics;
      if(now-this._lastScan>Math.max(250,2000/this.fps)) return 'Waiting for a fresh camera frame…';
      if(this._status==='tracking'&&visible) {
        const label=d.mode==='decoded'?'decoded · pose OK':d.mode==='centres'?'tracking 3 black squares':'tracking corners';
        return `${this._result.text}: ${label}${d.identityVerification==='confirming'?' · confirming identity':d.patternVerification==='deferred'?' · pattern check deferred (unclear frame)':''}`;
      }
      let message;
      if(d.decodedText!==undefined) message=d.targetMatches?'QR decoded · pose rejected':`Decoded ${d.decodedText} · waiting for ${this.target}`;
      else if(d.centreReason&&!d.finderCount) message='Recovering tracked squares';
      else if(d.geometryFound) message='3 finder outlines found · QR not decoded';
      else if(d.finderCount===3) message='3 finder centres found · outlines rejected';
      else if(d.finderCandidates) message=`${d.finderCandidates} finder candidates · no valid group of 3`;
      else message='Searching · no finder patterns';
      if(d.centreReason) message+=` · centres: ${d.centreReason}`;
      if(d.trackingReason) message+=` · flow: ${d.trackingReason}`;
      return visible?`Holding last pose · ${message}`:message;
    }
    setCentreTracking(enabled) {
      if(this.centreTracking===!!enabled)return this;
      this.centreTracking=!!enabled;
      this._worker?.reset(this.centreTracking);
      this._centreResult=null;this._reliableResult=null;this._reference=null;
      this._lastRecoverySearch=-Infinity;this._nextWorkerFrame=0;
      return this;
    }
    setKalmanEnabled(enabled) {
      this.kalmanFilter=!!enabled;this._kalman=null;this._renderPose=null;this._positionCorrection=null;
      return this;
    }
    _prediction(now) {
      return this.kalmanFilter&&this._kalman?this._kalman.at(now,this.predictionMs):null;
    }
    _displayPose(now) {
      let pose=this._result.pose;
      const prediction=this._prediction(now);
      if(prediction) {pose={...pose,position:prediction.position};pose.matrix=matrix(pose);}
      if(!this.renderSmoothingMs) return pose;
      if(!this._renderPose||now-this._lastRender>Math.max(180,this.lostAfterMs)) this._renderPose=pose;
      else this._renderPose=smoothPose(this._renderPose,pose,1-Math.exp(-Math.max(0,now-this._lastRender)/this.renderSmoothingMs));
      if(prediction||this._positionCorrection) {
        // Ease only measurement corrections, preserving predicted motion between
        // camera frames instead of adding another low-pass delay to that motion.
        const target=prediction?.position||pose.position,c=this._positionCorrection;
        const weight=c?Math.exp(-Math.max(0,now-c.time)/this.renderSmoothingMs):0;
        this._renderPose={...this._renderPose,position:target.map((v,i)=>v+(c?c.offset[i]*weight:0))};
        this._renderPose.matrix=matrix(this._renderPose);
      }
      this._lastRender=now;
      return this._renderPose;
    }
    getLatest(now=performance.now()) {
      const visible=!!this._result&&now-this._lastSeen<=this.lostAfterMs;
      const ageMs=now-this._lastSeen;
      const holding=visible&&(this._status!=='tracking'||ageMs>Math.max(100,2000/this.fps));
      const prediction=visible?this._prediction(now):null;
      const predicting=holding&&!!prediction?.predicting;
      let statusMessage=this._statusMessage(now,visible);
      if(holding) {
        const detail=statusMessage.replace(/^Holding last pose · /,'');
        statusMessage=`${predicting?'Predicting briefly (Kalman)':'Holding last pose'} · ${detail}`;
      }
      return {visible,holding,predicting,poseAgeMs:ageMs,predictionUncertainty:prediction?.uncertainty??null,statusMessage,diagnostics:{...this._diagnostics,backend:this._worker?'worker':'main',workerUnavailable:this._workerUnavailable},status:visible?'tracking':this._status==='tracking'?'lost':this._status,
        text:visible?this._result.text:null,pose:visible?this._displayPose(now):null,
        corners:visible?this._result.corners:null,
        finderCentres:visible&&!holding?this._result.finderCentres:null,
        intrinsics:visible?this._result.intrinsics:null,
        frameWidth:this._result?.frameWidth??0,frameHeight:this._result?.frameHeight??0,
        lastSeen:this._lastSeen,error:this.error};
    }
    // Rect coordinates are in the drawing canvas; detection stays in raw video pixels.
    _rect(rect={}) {return {x:rect.x??0,y:rect.y??0,width:rect.width??global.width,height:rect.height??global.height};}
    drawCamera(rect={},g=global) {
      const v=this.videoElement;
      if(!v?.videoWidth||!v.videoHeight) return;
      const r=this._rect(rect),scale=Math.max(r.width/v.videoWidth,r.height/v.videoHeight);
      // Native video avoids p5 capture's optional display flip; tracking uses raw pixels.
      const ctx=g.drawingContext;
      ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
      ctx.drawImage(v,r.x+(r.width-v.videoWidth*scale)/2,r.y+(r.height-v.videoHeight*scale)/2,v.videoWidth*scale,v.videoHeight*scale);
      ctx.restore();
    }
    drawFinderMarkers({rect={},target=global}={}) {
      const state=this.getLatest();
      if(!state.finderCentres)return;
      const r=this._rect(rect),scale=Math.max(r.width/state.frameWidth,r.height/state.frameHeight),ctx=target.drawingContext;
      ctx.save();ctx.font='bold 13px system-ui';ctx.lineWidth=2;
      state.finderCentres.forEach(([px,py],i)=>{
        const x=r.x+(r.width-state.frameWidth*scale)/2+px*scale,y=r.y+(r.height-state.frameHeight*scale)/2+py*scale;
        ctx.strokeStyle=ctx.fillStyle=['#ff5b70','#48f0a0','#55cfff'][i];
        ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.moveTo(x-16,y);ctx.lineTo(x+16,y);ctx.moveTo(x,y-16);ctx.lineTo(x,y+16);ctx.stroke();ctx.fillText(String(i+1),x+15,y-15);
      });
      ctx.restore();
    }
    projectPoint(x,y,z=0,rect={}) {
      const state=this.getLatest();
      if(!state.visible) return null;
      const result=this._result,p=this._core.project(state.pose,[x,y,z],result.intrinsics);
      if(!p) return null;
      const r=this._rect(rect),scale=Math.max(r.width/result.frameWidth,r.height/result.frameHeight);
      return {x:r.x+(r.width-result.frameWidth*scale)/2+p[0]*scale,y:r.y+(r.height-result.frameHeight*scale)/2+p[1]*scale,depth:p[2]};
    }
    // Render actual 3D geometry into a p5 WEBGL graphics layer. Projection uses
    // the same native intrinsics and cover crop as drawCamera/projectPoint.
    drawWebGL({target,rect={}}={},draw) {
      const state=this.getLatest();
      if(!state.visible) return;
      // p5 2.2 Graphics omits camera/frustum wrappers; its renderer has them.
      const cameraTarget=typeof target?.frustum==='function'?target:target?._renderer;
      if(!cameraTarget||typeof cameraTarget.frustum!=='function'||typeof cameraTarget.camera!=='function') throw new Error('drawWebGL needs a p5 WEBGL target');
      const r=this._rect(rect),w=target.width,h=target.height;
      const scale=Math.max(r.width/state.frameWidth,r.height/state.frameHeight),k=state.intrinsics;
      const fx=k.fx*scale,fy=k.fy*scale;
      const cx=r.x+(r.width-state.frameWidth*scale)/2+k.cx*scale;
      const cy=r.y+(r.height-state.frameHeight*scale)/2+k.cy*scale;
      const near=this.markerSize*.01,far=Math.max(this.markerSize*100,state.pose.position[2]+this.markerSize*10);
      target.push();
      try {
        target.resetMatrix();
        cameraTarget.camera(0,0,0,0,0,-1,0,1,0);
        cameraTarget.linePerspective?.(false);
        // p5's frustum flips the projection Y coefficient; camera-space Y stays down.
        cameraTarget.frustum(-cx*near/fx,(w-cx)*near/fx,-(h-cy)*near/fy,cy*near/fy,near,far);
        target.scale(1,1,-1);
        target.applyMatrix(state.pose.matrix);
        draw?.(target,state);
      } finally { target.pop(); }
    }
    drawCubeWebGL({target,size=this.markerSize*.6,height=size,rect={},wireframe=false}={}) {
      this.drawWebGL({target,rect},g=>{
        g.translate(0,0,height/2);
        if(wireframe) g.noFill();else g.fill('#20c5eb');g.stroke(255);g.strokeWeight(1.5);
        g.box(size,size,height);
      });
    }
    drawCube({size=this.markerSize*0.6,height=size,rect={},target=global}={}) {
      if(!this.getLatest().visible) return;
      const half=size/2;
      const vertices=[[-half,-half,0],[half,-half,0],[half,half,0],[-half,half,0],[-half,-half,height],[half,-half,height],[half,half,height],[-half,half,height]];
      const points=vertices.map(p=>this.projectPoint(...p,rect));
      if(points.some(p=>!p)) return;
      const faces=[[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]];
      faces.sort((a,b)=>b.reduce((s,i)=>s+points[i].depth,0)-a.reduce((s,i)=>s+points[i].depth,0));
      target.push();target.stroke(255);target.strokeWeight(2);
      for(const face of faces) {
        target.fill(face.includes(0)?'#ff575f80':face.includes(2)?'#20c5eb80':'#ffd34f99');
        target.beginShape();face.forEach(i=>target.vertex(points[i].x,points[i].y));target.endShape(target.CLOSE);
      }
      target.pop();
    }
  }
  global.QrAnchor=QrAnchor;
})(globalThis);
