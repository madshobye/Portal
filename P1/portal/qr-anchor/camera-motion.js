// Conservative scene-motion classifier. This is not SLAM: no world map or anchor.
import {flow} from './tracking.js';
import {solve} from './geometry.js';
const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const apply=(m,p)=>[m[0]*p[0]+m[1]*p[1]+m[2],m[3]*p[0]+m[4]*p[1]+m[5]];
function fit(pairs) {
  const a=[[0,0,0],[0,0,0],[0,0,0]],bx=[0,0,0],by=[0,0,0];
  for(const {from:[x,y],to} of pairs) {
    const row=[x,y,1];
    for(let i=0;i<3;i++){bx[i]+=row[i]*to[0];by[i]+=row[i]*to[1];for(let j=0;j<3;j++)a[i][j]+=row[i]*row[j];}
  }
  try{return [...solve(a,bx),...solve(a,by)];}catch{return null;}
}
function robustFit(pairs) {
  if(pairs.length<8)return null;
  let best=[];
  // Fixed deterministic sample budget, independent of the number of video frames.
  let seed=12345;
  const index=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%pairs.length;};
  for(let i=0;i<64;i++) {
    const m=fit([pairs[index()],pairs[index()],pairs[index()]]);if(!m)continue;
    const inliers=pairs.filter(p=>distance(apply(m,p.from),p.to)<1.5);
    if(inliers.length>best.length)best=inliers;
  }
  if(best.length<8||best.length/pairs.length<.7)return null;
  const m=fit(best);if(!m||m.some(v=>!Number.isFinite(v)))return null;
  const det=m[0]*m[4]-m[1]*m[3];
  if(det<.7||det>1.4)return null;
  return {matrix:m,pairs:best};
}
// Feature selection excludes the marker and samples across the image, rather
// than letting a hand or a single moving object dominate all observations.
export function sceneFeatures(frame,corners,inside=false) {
  const im=frame[0],w=im.width,h=im.height,d=im.data;
  const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
  const box=[Math.min(...xs)-10,Math.min(...ys)-10,Math.max(...xs)+10,Math.max(...ys)+10];
  const points=[],columns=inside?5:7;
  const left=inside?Math.min(...xs):0,top=inside?Math.min(...ys):0;
  const right=inside?Math.max(...xs):w,bottom=inside?Math.max(...ys):h;
  const inMarker=(x,y)=>{
    const cross=corners.map((p,i)=>{const q=corners[(i+1)%4];return (q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);});
    return cross.every(v=>v>0)||cross.every(v=>v<0);
  };
  for(let gy=0;gy<5;gy++)for(let gx=0;gx<columns;gx++) {
    let best=null,score=12;
    for(let y=Math.max(18,Math.floor(top+gy*(bottom-top)/5));y<Math.min(h-18,top+(gy+1)*(bottom-top)/5);y+=4)
      for(let x=Math.max(18,Math.floor(left+gx*(right-left)/columns));x<Math.min(w-18,left+(gx+1)*(right-left)/columns);x+=4) {
        if(inside?!inMarker(x,y):(x>box[0]&&x<box[2]&&y>box[1]&&y<box[3]))continue;
        let xx=0,yy=0,xy=0;
        for(let v=-2;v<=2;v++)for(let u=-2;u<=2;u++) {
          const k=(y+v)*w+x+u,dx=(d[k+1]-d[k-1])/2,dy=(d[k+w]-d[k-w])/2;
          xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;
        }
        const value=(xx+yy-Math.hypot(xx-yy,2*xy))/50;
        if(value>score){score=value;best=[x,y];}
      }
    if(best)points.push(best);
  }
  return points;
}
export function sceneFlow(before,after,points) {
  const level=Math.min(2,before.length-1,after.length-1),pairs=[];
  for(const p of points) {
    const next=flow(before,after,p,p,[1,1],level,true);
    if(!next||next.residual>.5)continue;
    const back=flow(after,before,next.point,p,[1,1],level,true);
    if(back&&distance(back.point,p)<1)pairs.push({from:p,to:next.point});
  }
  return pairs;
}
export class SceneMotion {
  constructor(){this.reset();}
  reset(){this.evidence=0;this.lastTime=null;this.state={mode:'uncertain',confidence:0,reason:'waiting for scene motion',gyroConsistent:false};}
  update({pairs,markerPairs,width,height,now,gyroPredict=null}) {
    const dt=this.lastTime===null?0:now-this.lastTime;this.lastTime=now;
    const unknown=reason=>{this.evidence=0;return this.state={mode:'uncertain',confidence:0,reason,gyroConsistent:false};};
    if(dt>250||dt<0)return unknown('frame gap');
    const markerFit=robustFit(markerPairs||[]);
    if(!markerFit)return unknown('insufficient QR-region flow');
    const fit=robustFit(pairs);
    if(!fit)return unknown('insufficient coherent background');
    const regions=new Set(fit.pairs.map(p=>(p.from[0]>width/2?1:0)+(p.from[1]>height/2?2:0)));
    if(regions.size<3)return unknown('background concentrated in one region');
    const error=median(markerFit.pairs.map(p=>distance(p.to,apply(fit.matrix,p.from))));
    const motion=median(fit.pairs.map(p=>distance(p.from,p.to)));
    let gyroError=null;
    if(gyroPredict) {
      // Translation/parallax cannot be predicted by a gyro. A poor match disables
      // assistance even when the visual evidence suggests a stationary marker.
      const errors=fit.pairs.map(p=>{const q=gyroPredict(p.from);return q?distance(q,p.to):Infinity;});
      gyroError=median(errors);
    }
    const gyroConsistent=gyroError!==null&&gyroError<1.8;
    if(error>3.5) {
      this.evidence=0;
      return this.state={mode:'marker-moving',confidence:Math.min(1,error/8),reason:'QR differs from background (or parallax)',error,motion,gyroError,gyroConsistent:false};
    }
    if(error>1.8)return unknown('ambiguous relative movement');
    if(motion<.6){this.evidence=0;return this.state={mode:'still',confidence:0,reason:'too little movement to distinguish',error,motion,gyroError,gyroConsistent:false};}
    this.evidence+=Math.min(150,Math.max(0,dt));
    const confidence=Math.min(1,this.evidence/600)*(1-error/3.6);
    return this.state={mode:this.evidence>=600?'camera-moving':'uncertain',confidence,
      reason:this.evidence>=600?'QR-region flow agrees with scene':'checking scene agreement',error,motion,gyroError,gyroConsistent,backgroundPoints:fit.pairs.length,markerPoints:markerFit.pairs.length};
  }
}
// Quaternion snapshots are camera-to-reference rotations. R_current^-1 R_old
// predicts how a stationary scene ray moves in the camera image.
const multiply=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
export function gyroDelta(previous,current,now) {
  if(!previous||!current||![previous.time,current.time,now].every(Number.isFinite)||previous.epoch!==current.epoch||current.time-previous.time<0||
    current.time-previous.time>250||now-current.time>120||now-current.time< -20)return null;
  const a=current.q,b=previous.q;
  if(!a||!b||a.length!==4||b.length!==4||[...a,...b].some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...a)-1)>.01||Math.abs(Math.hypot(...b)-1)>.01)return null;
  return multiply([-a[0],-a[1],-a[2],a[3]],b);
}
export function gyroProject(p,q,k) {
  const v=[(p[0]-k.cx)/k.fx,(p[1]-k.cy)/k.fy,1,0];
  const r=multiply(multiply(q,v),[-q[0],-q[1],-q[2],q[3]]);
  return r[2]>.1?[k.fx*r[0]/r[2]+k.cx,k.fy*r[1]/r[2]+k.cy]:null;
}
