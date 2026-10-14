// Portal-owned finder-outline measurements and planar pose math.
// Points and matrices here are ordinary arrays. 3x3 matrices are row-major.
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const norm = a => Math.hypot(...a);
export const unit = a => a.map(v => v / norm(a));
export const mul = (a, b) => Array.from({length:9}, (_, i) => [0,1,2].reduce((s,k) => s+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
export const transform = (h, p) => {
  const z = h[6]*p[0]+h[7]*p[1]+h[8];
  return [(h[0]*p[0]+h[1]*p[1]+h[2])/z, (h[3]*p[0]+h[4]*p[1]+h[5])/z];
};
export function solve(a, b) {
  const n = b.length, m = a.map((r,i) => [...r,b[i]]);
  for(let k=0;k<n;k++) {
    let pivot=k;
    for(let i=k+1;i<n;i++) if(Math.abs(m[i][k])>Math.abs(m[pivot][k])) pivot=i;
    if(Math.abs(m[pivot][k])<1e-12) throw new Error('Degenerate geometry');
    [m[k],m[pivot]]=[m[pivot],m[k]];
    const d=m[k][k]; for(let j=k;j<=n;j++) m[k][j]/=d;
    for(let i=0;i<n;i++) if(i!==k) {
      const f=m[i][k]; for(let j=k;j<=n;j++) m[i][j]-=f*m[k][j];
    }
  }
  return m.map(r=>r[n]);
}
function leastSquares(rows, values, damping=0) {
  const n=rows[0].length;
  const a=Array.from({length:n},()=>Array(n).fill(0)), b=Array(n).fill(0);
  rows.forEach((r,i)=>{ for(let j=0;j<n;j++){ b[j]+=r[j]*values[i]; for(let k=0;k<n;k++) a[j][k]+=r[j]*r[k]; }});
  for(let j=0;j<n;j++) a[j][j]+=damping*(a[j][j]+1);
  return solve(a,b);
}
export function homography(src,dst) {
  const normalize = points => {
    const c=[0,1].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length);
    const scale=Math.SQRT2/(points.reduce((s,p)=>s+Math.hypot(p[0]-c[0],p[1]-c[1]),0)/points.length);
    return { points:points.map(p=>[(p[0]-c[0])*scale,(p[1]-c[1])*scale]),
      matrix:[scale,0,-c[0]*scale,0,scale,-c[1]*scale,0,0,1],
      inverse:[1/scale,0,c[0],0,1/scale,c[1],0,0,1] };
  };
  const s=normalize(src), d=normalize(dst), rows=[], values=[];
  s.points.forEach(([x,y],i)=>{
    const [u,v]=d.points[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]); values.push(u,v);
  });
  return mul(mul(d.inverse,[...leastSquares(rows,values),1]),s.matrix);
}
function hull(points) {
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=list=>{const out=[]; for(const p of list){while(out.length>1&&turn(out.at(-2),out.at(-1),p)<=0) out.pop(); out.push(p);} return out;};
  const a=half(points), b=half([...points].reverse()); a.pop(); b.pop(); return a.concat(b);
}
function fittedQuad(boundary) {
  const polygon=hull(boundary);
  while(polygon.length>4) {
    let best=Infinity,index=0;
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[(i+polygon.length-1)%polygon.length],b=polygon[i],c=polygon[(i+1)%polygon.length];
      const area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
      if(area<best){best=area;index=i;}
    }
    polygon.splice(index,1);
  }
  if(polygon.length!==4) throw new Error('Finder outline is not a quadrilateral');
  // Fit straight edges through boundary samples, rather than using staircase extrema.
  const lines=polygon.map((a,i)=>{
    const b=polygon[(i+1)%4], dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    const samples=boundary.filter(p=>{
      const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(len*len);
      return t>0.12&&t<0.88&&Math.abs(dx*(p[1]-a[1])-dy*(p[0]-a[0]))/len<1.6;
    });
    if(samples.length<4) return [dy/len,-dx/len,(dy*a[0]-dx*a[1])/len];
    const cx=samples.reduce((s,p)=>s+p[0],0)/samples.length,cy=samples.reduce((s,p)=>s+p[1],0)/samples.length;
    let xx=0,xy=0,yy=0;
    for(const [x,y] of samples){xx+=(x-cx)**2;xy+=(x-cx)*(y-cy);yy+=(y-cy)**2;}
    const angle=0.5*Math.atan2(2*xy,xx-yy),nx=-Math.sin(angle),ny=Math.cos(angle);
    return [nx,ny,nx*cx+ny*cy];
  });
  return lines.map((b,i)=>{
    const a=lines[(i+3)%4],det=a[0]*b[1]-a[1]*b[0];
    if(Math.abs(det)<0.05) throw new Error('Finder too oblique');
    return [(a[2]*b[1]-a[1]*b[2])/det,(a[0]*b[2]-a[2]*b[0])/det];
  });
}
export function finderQuad(image,center,moduleSize,centers,inner=false) {
  const w=image.getWidth(),h=image.getHeight();
  const black=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&image.get(x,y);
  // Move from the central black square across its white moat to the outer ring.
  let seed=inner?[Math.floor(center[0]),Math.floor(center[1])]:null;
  if(!inner) for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
    let white=false;
    for(let t=1;t<moduleSize*7;t++) {
      const x=Math.floor(center[0]+dx*t),y=Math.floor(center[1]+dy*t);
      if(!black(x,y)) white=true;
      else if(white){seed=[x,y];break;}
    }
    if(seed) break;
  }
  if(!seed) throw new Error('Finder ring missing');
  const seen=new Set(),stack=[seed], boundary=[];
  const maxPixels=Math.max(150,Math.min(w*h/4,moduleSize*moduleSize*(inner?30:180)));
  while(stack.length) {
    const [x,y]=stack.pop(),key=y*w+x;
    if(seen.has(key)||!black(x,y)) continue;
    seen.add(key);
    if(seen.size>maxPixels) throw new Error('Finder ring merged with background');
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if(black(x+dx,y+dy)) {if(!seen.has((y+dy)*w+x+dx)) stack.push([x+dx,y+dy]);}
      else boundary.push([x+0.5+dx*0.5,y+0.5+dy*0.5]);
    }
  }
  const q=fittedQuad(boundary);
  const [tl,tr,bl]=centers,ux=tr[0]-tl[0],uy=tr[1]-tl[1],vx=bl[0]-tl[0],vy=bl[1]-tl[1];
  const det=ux*vy-uy*vx;
  const coordinates=p=>{const x=p[0]-center[0],y=p[1]-center[1]; return [(x*vy-y*vx)/det,(ux*y-uy*x)/det];};
  // The hull is cyclic. Orient its corners using the three ordered QR finders.
  let first=0,min=Infinity;
  q.forEach((p,i)=>{const [u,v]=coordinates(p);if(u+v<min){min=u+v;first=i;}});
  const out=Array.from({length:4},(_,i)=>q[(first+i)%4]);
  if(coordinates(out[1])[0]<coordinates(out[3])[0]) return [out[0],out[3],out[2],out[1]];
  return out;
}
export function correspondences(quads,dimension,inner=false) {
  const src=[],dst=[];
  [[0,0],[dimension-7,0],[0,dimension-7]].forEach(([x,y],i)=>{
    const a=inner?2:0,b=inner?5:7;
    src.push([x+a,y+a],[x+b,y+a],[x+b,y+b],[x+a,y+b]); dst.push(...quads[i]);
  });
  return {src,dst};
}
export function project(pose,point,k) {
  const p=[0,1,2].map(i=>dot(pose.rotation.slice(i*3,i*3+3),point)+pose.position[i]);
  if(p[2]<=0) return null;
  return [k.fx*p[0]/p[2]+k.cx,k.fy*p[1]/p[2]+k.cy,p[2]];
}
function rotate(delta) {
  const angle=norm(delta);
  if(angle<1e-14) return [1,0,0,0,1,0,0,0,1];
  const [x,y,z]=delta.map(v=>v/angle),s=Math.sin(angle),c=Math.cos(angle),t=1-c;
  return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c];
}
function displaced(pose,delta) {
  return {rotation:mul(rotate(delta.slice(0,3)),pose.rotation),position:pose.position.map((v,i)=>v+delta[i+3])};
}
export function estimatePose(src,dst,k,size,dimension) {
  const world=src.map(([x,y])=>[(x/dimension-0.5)*size,(0.5-y/dimension)*size]);
  const rays=dst.map(([x,y])=>[(x-k.cx)/k.fx,(y-k.cy)/k.fy]);
  const h=homography(world,rays),a=[h[0],h[3],h[6]],b=[h[1],h[4],h[7]],c=[h[2],h[5],h[8]];
  const scale=2/(norm(a)+norm(b))*(c[2]<0?-1:1);
  const r1=unit(a.map(v=>v*scale)),bv=b.map(v=>v*scale);
  const r2=unit(bv.map((v,i)=>v-dot(bv,r1)*r1[i])),r3=cross(r1,r2);
  let pose={rotation:[r1[0],r2[0],r3[0],r1[1],r2[1],r3[1],r1[2],r2[2],r3[2]],position:c.map(v=>v*scale)};
  const residual=p=>world.flatMap((v,i)=>{const q=project(p,[...v,0],k);return q?[q[0]-dst[i][0],q[1]-dst[i][1]]:[1e6,1e6];});
  let errors=residual(pose),cost=dot(errors,errors),lambda=1e-3;
  // Refine a rigid pose against all 12 measured corners, not a sheared transform.
  for(let iteration=0;iteration<16;iteration++) {
    const jac=errors.map(()=>[]);
    for(let j=0;j<6;j++) {
      const epsilon=j<3?1e-5:size*1e-5,d=Array(6).fill(0);d[j]=epsilon;
      residual(displaced(pose,d)).forEach((v,i)=>jac[i][j]=(v-errors[i])/epsilon);
    }
    const delta=leastSquares(jac,errors.map(v=>-v),lambda),candidate=displaced(pose,delta),e=residual(candidate),next=dot(e,e);
    if(next<cost){pose=candidate;errors=e;cost=next;lambda/=3;if(norm(delta)<1e-7)break;}else lambda*=10;
  }
  pose.reprojectionError=Math.sqrt(cost/src.length);
  const normal=[pose.rotation[2],pose.rotation[5],pose.rotation[8]];
  if(!Number.isFinite(pose.reprojectionError)||pose.position[2]<=0||dot(normal,pose.position)>=0) throw new Error('Invalid pose');
  pose.matrix=[pose.rotation[0],pose.rotation[3],pose.rotation[6],0,pose.rotation[1],pose.rotation[4],pose.rotation[7],0,pose.rotation[2],pose.rotation[5],pose.rotation[8],0,...pose.position,1];
  return pose;
}

// A guessed FOV is not a calibrated camera. Recover a bounded focal correction
// from the orthogonality/equal length of the two axes of a decoded square QR.
// Keep explicit calibration fixed; only try this after the initial rigid fit fails.
export function resolvePose(src,dst,k,size,dimension,{maxReprojectionError=3,focalScaleRange=null}={}) {
  const h=homography(src,dst);
  const planarError=Math.sqrt(dst.reduce((sum,p,i)=>{
    const q=transform(h,src[i]);return sum+(p[0]-q[0])**2+(p[1]-q[1])**2;
  },0)/src.length);
  if(!Number.isFinite(planarError)||planarError>maxReprojectionError) return null;
  const pose=estimatePose(src,dst,k,size,dimension);
  if(pose.reprojectionError<=maxReprojectionError) return {pose,intrinsics:k};
  if(!focalScaleRange) return null;
  const n=homography(src,dst.map(([x,y])=>[(x-k.cx)/k.fx,(y-k.cy)/k.fy]));
  const [ux,vx,,uy,vy,,uz,vz]=n;
  const a=[ux*vx+uy*vy,ux*ux+uy*uy-vx*vx-vy*vy],b=[uz*vz,uz*uz-vz*vz];
  // Near-front-on views cannot reliably determine focal length from one plane.
  if(Math.hypot(...b)<.02*(ux*ux+uy*uy+vx*vx+vy*vy)) return null;
  const scale=Math.sqrt(-dot(a,b)/dot(b,b));
  if(!Number.isFinite(scale)||scale<focalScaleRange[0]||scale>focalScaleRange[1]) return null;
  const intrinsics={...k,fx:k.fx*scale,fy:k.fy*scale};
  const corrected=estimatePose(src,dst,intrinsics,size,dimension);
  if(corrected.reprojectionError>maxReprojectionError||corrected.reprojectionError>pose.reprojectionError*.75) return null;
  return {pose:corrected,intrinsics};
}
