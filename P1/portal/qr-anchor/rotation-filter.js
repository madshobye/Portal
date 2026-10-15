// Display-only rotation filter. A nearly frontal plane gives weak tilt evidence:
// subpixel corner noise can move an object high above the plane substantially.
import {project} from './geometry.js';

function quaternion(r) {
  const q=[0,0,0,0],trace=r[0]+r[4]+r[8];
  if(trace>0) {
    const s=2*Math.sqrt(trace+1);q[3]=s/4;q[0]=(r[7]-r[5])/s;q[1]=(r[2]-r[6])/s;q[2]=(r[3]-r[1])/s;
  } else {
    const i=r[0]>r[4]?(r[0]>r[8]?0:2):(r[4]>r[8]?1:2),j=(i+1)%3,k=(i+2)%3;
    const s=2*Math.sqrt(1+r[i*3+i]-r[j*3+j]-r[k*3+k]);
    q[i]=s/4;q[j]=(r[j*3+i]+r[i*3+j])/s;q[k]=(r[k*3+i]+r[i*3+k])/s;q[3]=(r[k*3+j]-r[j*3+k])/s;
  }
  return q;
}
function rotation([x,y,z,w]) {
  return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),
    2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),
    2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
}
function slerp(a,b,t) {
  let dot=a.reduce((s,v,i)=>s+v*b[i],0);
  if(dot<0){b=b.map(v=>-v);dot=-dot;}
  const angle=Math.acos(Math.min(1,dot)),s=Math.sin(angle);
  const u=s<1e-6?1-t:Math.sin((1-t)*angle)/s,v=s<1e-6?t:Math.sin(t*angle)/s;
  const q=a.map((x,i)=>u*x+v*b[i]),n=Math.hypot(...q);return q.map(x=>x/n);
}
export class RotationFilter {
  constructor(){this.time=null;this.rotation=null;this.evidencePx=0;}
  observe(pose,k,size,time,noisePixels=1.25) {
    const dt=this.time===null?0:time-this.time;
    if(!this.rotation||dt<=0||dt>500){this.rotation=pose.rotation.slice();this.time=time;return this.rotation;}
    const prior={rotation:this.rotation,position:pose.position};
    const points=[[-.5,.5,0],[.5,.5,0],[.5,-.5,0],[-.5,-.5,0]].map(p=>p.map(v=>v*size));
    const differences=points.map(p=>{
      const a=project(prior,p,k),b=project(pose,p,k);
      return a&&b?[a[0]-b[0],a[1]-b[1]]:null;
    });
    // Compare rotation at the SAME measured position: camera translation must
    // neither unlock tilt jitter nor be delayed by this rotation-only filter.
    this.evidencePx=differences.some(p=>!p)?Infinity:Math.sqrt(differences.reduce((s,p)=>s+p[0]**2+p[1]**2,0)/4);
    const response=Math.max(0,Math.min(1,(this.evidencePx/Math.max(.1,noisePixels)-1)/3));
    const tau=250*(1-response)+20*response;
    this.rotation=rotation(slerp(quaternion(this.rotation),quaternion(pose.rotation),1-Math.exp(-dt/tau)));
    this.time=time;return this.rotation;
  }
}
