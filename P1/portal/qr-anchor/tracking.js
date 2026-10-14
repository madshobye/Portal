// Portal-owned sparse optical flow. No finder search or QR decoding in this path.
// Pyramidal Lucas–Kanade with forward/backward validation of measured finder corners.
import {homography,transform,estimatePose} from './geometry.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function pixel(image,x,y) {
  if(x<0||y<0||x>=image.width-1||y>=image.height-1) return NaN;
  const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,i=iy*image.width+ix,d=image.data,w=image.width;
  return d[i]*(1-dx)*(1-dy)+d[i+1]*dx*(1-dy)+d[i+w]*(1-dx)*dy+d[i+w+1]*dx*dy;
}
export function prepareTrackingFrame(rgba,width,height) {
  const data=new Float32Array(width*height);
  for(let i=0;i<data.length;i++) data[i]=(rgba[i*4]+2*rgba[i*4+1]+rgba[i*4+2])/4;
  const levels=[{data,width,height}];
  for(let l=1;l<=3;l++) {
    const prev=levels[l-1],w=Math.floor(prev.width/2),h=Math.floor(prev.height/2),d=new Float32Array(w*h);
    if(w<16||h<16) break;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const i=2*y*prev.width+2*x;
      d[y*w+x]=(prev.data[i]+prev.data[i+1]+prev.data[i+prev.width]+prev.data[i+prev.width+1])/4;
    }
    levels.push({data:d,width:w,height:h});
  }
  return levels;
}
// Scratch buffers are shared only within this synchronous pixel core. Flow calls
// are not recursive. Avoid per-point/per-iteration arrays in the hottest loop.
const flowA=new Float32Array(49),flowB=new Float32Array(49);
export function flow(a,b,p,guess,ratio,level,normalizeContrast=false) {
  let qx=guess[0]/2**level,qy=guess[1]/2**level,residual=Infinity;
  for(let l=level;l>=0;l--) {
    if(l<level){qx*=2;qy*=2;}
    const scale=2**l,ox=p[0]/scale,oy=p[1]/scale;
    let sum=0,squares=0,i=0;
    for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++,i++) {
      const value=pixel(a[l],ox+x/ratio[0],oy+y/ratio[1]);
      if(!Number.isFinite(value))return null;
      flowA[i]=value;sum+=value;squares+=value*value;
    }
    const mean=sum/49,contrast=Math.sqrt(Math.max(0,squares/49-mean*mean));
    if(contrast<12)return null;
    for(let iteration=0;iteration<12;iteration++) {
      sum=0;squares=0;i=0;
      for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++,i++) {
        const value=pixel(b[l],qx+x,qy+y);
        if(!Number.isFinite(value))return null;
        flowB[i]=value;sum+=value;squares+=value*value;
      }
      const meanB=sum/49,contrastB=Math.sqrt(Math.max(0,squares/49-meanB*meanB));
      if(normalizeContrast&&contrastB<12)return null;
      const gain=normalizeContrast?contrast/contrastB:1;
      let xx=0,xy=0,yy=0,bx=0,by=0,error=0;i=0;
      for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++,i++) {
        const px=qx+x,py=qy+y;
        const gx=(pixel(b[l],px+1,py)-pixel(b[l],px-1,py))*.5*gain;
        const gy=(pixel(b[l],px,py+1)-pixel(b[l],px,py-1))*.5*gain;
        const diff=flowA[i]-mean-(flowB[i]-meanB)*gain;
        xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;bx+=gx*diff;by+=gy*diff;error+=diff*diff;
      }
      const det=xx*yy-xy*xy;
      if(!Number.isFinite(det)||det<1e-5||(xx+yy-Math.hypot(xx-yy,2*xy))/98<4)return null;
      const dx=(yy*bx-xy*by)/det,dy=(xx*by-xy*bx)/det;
      if(Math.hypot(dx,dy)>4)return null;
      qx+=dx;qy+=dy;residual=Math.sqrt(error/49)/contrast;
      if(Math.hypot(dx,dy)<.025)break;
    }
  }
  return {point:[qx,qy],residual};
}
export function seedTracking(frame,result) {
  const points=result.measurements.dst;
  const span=(distance(points[0],points[5])+distance(points[0],points[11]))/2;
  return {frame,points,src:result.measurements.src,moduleSize:span/result.dimension,goodFrames:0};
}
// Sparse appearance check: identical finder squares do not prove the payload is
// unchanged. Compare 36 data-area samples to the last decoded image, not the last
// tracked frame. This is not a grid read or payload decode, and cannot prove ID.
export function patternMatch(frame,h,reference) {
  const samples=[],dim=reference.dimension;
  for(let y=0;y<6;y++) for(let x=0;x<6;x++) {
    const u=9+Math.floor((dim-9)*(x+.5)/6),v=9+Math.floor((dim-9)*(y+.5)/6);
    const p=transform(h,[u+.5,v+.5]),value=pixel(frame,...p);
    if(!Number.isFinite(value)) return null;
    samples.push({value,black:reference.modules[v*dim+u]});
  }
  const sorted=samples.map(s=>s.value).sort((a,b)=>a-b),low=sorted[5],high=sorted[30];
  const threshold=(low+high)/2;
  const mismatches=samples.filter(s=>(s.value<threshold?1:0)!==s.black).length;
  const ambiguous=samples.filter(s=>Math.abs(s.value-threshold)<(high-low)*.18).length;
  const confidentMismatches=samples.filter(s=>Math.abs(s.value-threshold)>=(high-low)*.18&&(s.value<threshold?1:0)!==s.black).length;
  return {score:1-mismatches/samples.length,mismatches,total:samples.length,contrast:high-low,ambiguous,confidentMismatches};
}
// Geometry runs every frame; identity sampling can follow a separate clock.
export function verifyPattern(frame,h,reference,allowed,policy=null,diagnostics=null) {
  if(policy&&policy.mode!=='check') {
    if(diagnostics) diagnostics.patternVerification=policy.mode;
    return {state:policy.mode,match:null};
  }
  const match=patternMatch(frame,h,reference);
  const unclear=match&&(match.contrast<45||match.ambiguous>=4);
  let state='rejected';
  if(policy) {
    if(!match||unclear) state='deferred';
    else state=match.score<policy.threshold?'suspect':'verified';
  } else if(match&&match.contrast>=45&&match.mismatches<=allowed) state='verified';
  if(diagnostics) {diagnostics.patternAttempted=true;diagnostics.patternVerification=state;diagnostics.patternMatch=match;}
  return {state,match};
}
export function track(frame,{previous,mapping,reference,intrinsics,markerSize=1,maxReprojectionError=3,ageMs=0,gapMs=33,maxReuseMs=3000,diagnostics=null,maxGapMs=180,patternPolicy=null}={}) {
  const reject=reason=>{if(diagnostics)diagnostics.trackingReason=reason;return null;};
  if(!previous||!reference||gapMs>maxGapMs||gapMs<=0) return reject('frame gap');
  const [sx,sy,tx,ty]=mapping;
  if(Math.min(sx,sy)<.8||Math.max(sx,sy)>1.25) return reject('ROI scale change');
  const trust=Math.min(1,previous.goodFrames/8),age=clamp(ageMs/maxReuseMs,0,1);
  // A stable run earns modest tolerance; age and long frame gaps tighten it.
  // Hard caps remain in place, so noisy observations cannot train unlimited drift.
  const gapPenalty=clamp(50/gapMs,.5,1);
  const fbLimit=(.7+.35*trust+.2*Math.min(previous.moduleSize/8,1))*(1-.25*age)*gapPenalty;
  const photoLimit=.25+.08*trust-.08*age;
  const level=Math.min(previous.frame.length-1,frame.length-1,Math.max(0,Math.min(3,Math.floor(Math.log2(previous.moduleSize))-1)));
  const points=[];let fb=0,photo=0,motion=0;
  for(const p of previous.points) {
    const guess=[p[0]*sx+tx,p[1]*sy+ty];
    const forward=flow(previous.frame,frame,p,guess,[sx,sy],level);
    if(!forward) return reject('corner patch lost');
    const backward=flow(frame,previous.frame,forward.point,p,[1/sx,1/sy],level);
    if(!backward) return reject('backward corner check');
    fb=Math.max(fb,distance(p,backward.point)*Math.max(sx,sy));
    photo=Math.max(photo,forward.residual);
    motion=Math.max(motion,distance(guess,forward.point)/(previous.moduleSize*reference.dimension));
    points.push(forward.point);
  }
  if(fb>fbLimit||photo>photoLimit||motion>.15) return reject(fb>fbLimit?'corner consistency':photo>photoLimit?'patch appearance':'motion limit');
  try {
    const h=homography(previous.src,points);
    const fit=Math.sqrt(points.reduce((sum,p,i)=>sum+distance(p,transform(h,previous.src[i]))**2,0)/points.length);
    const fitLimit=Math.min(1.5,Math.max(.65,previous.moduleSize*.16))*(1-.2*age);
    if(fit>fitLimit) return reject('geometry fit');
    const check=verifyPattern(frame[0],h,reference,trust>.75?2:1,patternPolicy,diagnostics),match=check.match;
    if(check.state==='rejected') return reject('data pattern');
    const pose=estimatePose(previous.src,points,intrinsics,markerSize,reference.dimension);
    if(pose.reprojectionError>maxReprojectionError) return reject('pose fit');
    const confidence=clamp(1-.55*Math.max(fb/fbLimit,photo/photoLimit,fit/fitLimit,motion/.15),0,1)*(patternPolicy?1:(match?.score??1));
    const dim=reference.dimension,corners=[[0,0],[dim,0],[dim,dim],[0,dim]].map(p=>transform(h,p));
    const span=(distance(corners[0],corners[1])+distance(corners[0],corners[3]))/2;
    return {text:reference.text,dimension:dim,pose,homography:h,corners,reference,decoded:false,confidence,patternMatch:match,patternVerification:check.state,
      tracking:{frame,points,src:previous.src,moduleSize:span/dim,goodFrames:previous.goodFrames+1}};
  } catch(error) {
    if(/geometry|pose/.test(error.message)) return null;
    throw error;
  }
}
