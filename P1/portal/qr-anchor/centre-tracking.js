// Track the three central black finder squares. QR data is not read here.
// Optical flow predicts direction; a dark-pixel centroid refines each square.
import {flow,verifyPattern} from './tracking.js';
import {homography,transform,estimatePose,solve} from './geometry.js';
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function pixel(im,x,y) {
  if(x<0||y<0||x>=im.width-1||y>=im.height-1)return NaN;
  const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,i=iy*im.width+ix,w=im.width,d=im.data;
  return d[i]*(1-dx)*(1-dy)+d[i+1]*dx*(1-dy)+d[i+w]*(1-dx)*dy+d[i+w+1]*dx*dy;
}
const positions=dim=>[[3.5,3.5],[dim-3.5,3.5],[3.5,dim-3.5]];
export function seedCentres(frame,result) {
  const centres=positions(result.dimension).map(p=>transform(result.homography,p));
  return {frame,centres,velocity:centres.map(()=>[0,0])};
}
function basis(h,p) {
  const c=transform(h,p),x=transform(h,[p[0]+1,p[1]]),y=transform(h,[p[0],p[1]+1]);
  return [x.map((v,i)=>v-c[i]),y.map((v,i)=>v-c[i])];
}
// Only the black centre and surrounding white ring, excluding the outer black ring.
// Fixed sample layouts and histogram storage avoid sorting/allocating hundreds
// of tiny objects for every centroid iteration. Calls are synchronous.
const layouts=[{radius:8,step:.265},{radius:2,step:1.05}].map(({radius,step})=>{
  const points=[];
  for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)points.push([x*step,y*step,Math.exp(-((x*step)**2+(y*step)**2)/(2*1.1**2))]);
  return points;
});
const values=new Float32Array(289),histogram=new Uint16Array(256);
function measure(im,c,axes,coarse=false,validate=false,diagnostic=null) {
  const points=layouts[coarse?1:0],count=points.length;
  histogram.fill(0);
  let inner=0,outer=0,ni=0,no=0;
  for(let i=0;i<count;i++) {
    const [u,v]=points[i],value=pixel(im,c[0]+u*axes[0][0]+v*axes[1][0],c[1]+u*axes[0][1]+v*axes[1][1]);
    if(!Number.isFinite(value)){if(diagnostic)diagnostic.reason='outside image';return null;}
    values[i]=value;histogram[Math.max(0,Math.min(255,Math.round(value)))]++;
    const radius=Math.max(Math.abs(u),Math.abs(v));
    if(radius<1.1){inner+=value;ni++;}
    if(radius>1.85){outer+=value;no++;}
  }
  const lowIndex=Math.floor(count*.1),highIndex=Math.floor(count*.85);
  let cumulative=0,black=-1,white=255;
  for(let i=0;i<256;i++) {
    cumulative+=histogram[i];
    if(black<0&&cumulative>lowIndex)black=i;
    if(cumulative>highIndex){white=i;break;}
  }
  const contrast=white-black,separation=outer/no-inner/ni;
  if(diagnostic)Object.assign(diagnostic,{contrast,separation});
  if(contrast<30||separation<contrast*.2){if(diagnostic)diagnostic.reason='contrast';return null;}
  let mass=0,centreMass=0,x=0,y=0,innerBlack=0,solidCount=0,outerWhite=0;
  const whiteSides=[0,0,0,0],sideCounts=[0,0,0,0];
  for(let i=0;i<count;i++) {
    const weight=Math.max(0,Math.min(1,(white-values[i])/contrast));
    const [u,v,kernel]=points[i];
    // Suppress dark outer-ring/data pixels near the edge of a displaced window.
    mass+=weight;centreMass+=weight*kernel;x+=weight*kernel*u;y+=weight*kernel*v;
    if(validate) {
      const radius=Math.max(Math.abs(u),Math.abs(v));
      if(radius<.85){innerBlack+=weight;solidCount++;}
      if(radius>1.85)outerWhite+=1-weight;
      if(u>1.85){whiteSides[0]+=1-weight;sideCounts[0]++;}
      if(u< -1.85){whiteSides[1]+=1-weight;sideCounts[1]++;}
      if(v>1.85){whiteSides[2]+=1-weight;sideCounts[2]++;}
      if(v< -1.85){whiteSides[3]+=1-weight;sideCounts[3]++;}
    }
  }
  if(mass<count*.19||mass>count*.71){if(diagnostic)diagnostic.reason='mass';return null;}
  // Blur softens the square edges before it erases its centre. Require a dark
  // core and sufficient total dark area, rather than uniformly black edge pixels.
  // The area test excludes smaller data blocks; the white moat excludes borders.
  if(validate&&diagnostic)Object.assign(diagnostic,{mass:mass/count,solid:innerBlack/solidCount,white:outerWhite/no,sides:whiteSides.map((sum,i)=>sum/sideCounts[i])});
  if(validate) {
    const sides=whiteSides.map((sum,i)=>sum/sideCounts[i]);
    // Directional exposure blur spills dark pixels into two opposing white gaps.
    // Allow that only with a solid core and two clean perpendicular gaps. A
    // one-sided border/data intrusion still fails the opposing-gap checks.
    const blurredAxis=(a,b,c,d)=>sides[a]>=.4&&sides[b]>=.4&&
      (sides[a]+sides[b])/2>=.55&&sides[c]>=.85&&sides[d]>=.85;
    const directionalBlur=innerBlack/solidCount>=.88&&
      (blurredAxis(0,1,2,3)||blurredAxis(2,3,0,1));
    if(mass<count*.28||innerBlack/solidCount<.82||outerWhite/no<.65||
      (sides.some(value=>value<.55)&&!directionalBlur)) {
      if(diagnostic)diagnostic.reason='shape';return null;
    }
  }
  return {offset:[axes[0][0]*x/centreMass+axes[1][0]*y/centreMass,axes[0][1]*x/centreMass+axes[1][1]*y/centreMass],score:separation,contrast,mass};
}
function refine(im,start,axes,diagnostic=null) {
  let centre=start.slice(),m;
  for(let i=0;i<8;i++) {
    m=measure(im,centre,axes,false,false,diagnostic);if(!m)return null;
    centre=centre.map((v,j)=>v+m.offset[j]);
    if(Math.hypot(...m.offset)<.06)break;
  }
  m=measure(im,centre,axes,false,true,diagnostic);
  return m?{centre,...m}:null;
}
export function trackCentres(frame,{previous,mapping,reference,intrinsics,markerSize=1,maxReprojectionError=3,gapMs=33,patternPolicy=null,diagnostics=null}={}) {
  const reject=reason=>{if(diagnostics)diagnostics.centreReason=reason;return null;};
  const last=previous?.centreTracking;
  if(!last||!reference||gapMs<=0||gapMs>500)return reject('frame gap');
  const [sx,sy,tx,ty]=mapping,map=p=>[p[0]*sx+tx,p[1]*sy+ty];
  const dim=reference.dimension,src=[[0,0],[dim,0],[dim,dim],[0,dim]],oldH=previous.homography;
  const h=homography(src,src.map(p=>map(transform(oldH,p))));
  const starts=last.centres.map(map),ends=[],motions=[],observations=[],allDirections=[],flowSrc=[],flowDst=[];
  let quality=1,flowCount=0;
  for(let i=0;i<3;i++) {
    const local=positions(dim)[i],axes=basis(h,local),module=Math.sqrt(Math.abs(axes[0][0]*axes[1][1]-axes[0][1]*axes[1][0]));
    const level=Math.min(last.frame.length-1,frame.length-1,3,Math.max(0,Math.floor(Math.log2(module))));
    const directions=[];
    // Inner corners constrain motion in two axes; straight edge midpoints do not.
    // Two agreeing diagonal corners are enough to predict a centroid search.
    for(const [u,v] of [[-1.5,-1.5],[1.5,1.5],[1.5,-1.5],[-1.5,1.5]]) {
      const p=transform(oldH,[local[0]+u,local[1]+v]),guess=map(p);
      const prediction=last.velocity[i].map((v,j)=>v*(j?sy:sx)*Math.min(2,gapMs/Math.max(1,last.gapMs||gapMs)));
      const forward=flow(last.frame,frame,p,guess.map((v,j)=>v+prediction[j]),[sx,sy],level,true);
      if(!forward||forward.residual>.65)continue;
      const back=flow(frame,last.frame,forward.point,p,[1/sx,1/sy],level,true);
      if(!back||dist(back.point,p)*Math.max(sx,sy)>1.5)continue;
      flowSrc.push([local[0]+u,local[1]+v]);flowDst.push(forward.point);
      directions.push(forward.point.map((v,j)=>v-guess[j]));
      if(directions.length===2&&dist(directions[0],directions[1])<Math.max(1,module*.3))break;
    }
    const motion=directions.length?[0,1].map(j=>directions.map(p=>p[j]).sort((a,b)=>a-b)[Math.floor(directions.length/2)]):null;
    flowCount+=directions.length;allDirections.push(...directions);
    observations.push({axes,module,motion,count:directions.length});
  }
  const shared=allDirections.length?[0,1].map(j=>allDirections.map(p=>p[j]).sort((a,b)=>a-b)[Math.floor(allDirections.length/2)]):null;
  let flowH=null;
  // Flow also measures the changing square orientation/foreshortening. Fit one
  // shared projective update so the centroid windows follow tilt, not just position.
  if(observations.every(o=>o.count>=2)&&flowSrc.length>=6) {
    try {
      const candidate=homography(flowSrc,flowDst);
      const error=Math.max(...flowSrc.map((p,i)=>dist(transform(candidate,p),flowDst[i])));
      if(error<2) {
        const axes=positions(dim).map(p=>basis(candidate,p));
        if(axes.every((a,i)=>{
          const old=observations[i].axes,ratio=(a[0][0]*a[1][1]-a[0][1]*a[1][0])/(old[0][0]*old[1][1]-old[0][1]*old[1][0]);
          return ratio>.6&&ratio<1.6&&a.every((v,j)=>dist(v,old[j])<observations[i].module*.5);
        })) {
          flowH=candidate;axes.forEach((a,i)=>observations[i].axes=a);
        }
      }
    } catch(error) {if(!/geometry/.test(error.message))throw error;}
  }
  if(diagnostics){diagnostics.flowPerspective=!!flowH;diagnostics.centreChecks=[];}
  for(let i=0;i<3;i++) {
    const {axes,module}=observations[i];
    let motion=observations[i].motion;
    // The three squares share most translation. An isolated mismatched patch
    // should not drag one finder onto a data block when direction reverses.
    if(shared&&(!motion||dist(motion,shared)>module*2.5))motion=shared;
    if(!motion)motion=last.velocity[i].map((v,j)=>v*(j?sy:sx));
    const predicted=starts[i].map((v,j)=>v+motion[j]);
    const diagnostic={};if(diagnostics)diagnostics.centreChecks.push(diagnostic);
    let found=refine(frame[0],predicted,axes,diagnostic);
    if(!found&&motions.some(Boolean)) {
      const valid=motions.filter(Boolean);
      const measured=[0,1].map(j=>valid.map(p=>p[j]).sort((a,b)=>a-b)[Math.floor(valid.length/2)]);
      found=refine(frame[0],starts[i].map((v,j)=>v+measured[j]),axes);
    }
    ends.push(found?.centre||null);
    motions.push(found?found.centre.map((v,j)=>v-starts[i][j]):null);
    if(found)quality=Math.min(quality,Math.min(1,found.score/120));
  }
  const span=(dist(starts[0],starts[1])+dist(starts[0],starts[2]))/2;
  const limit=i=>Math.max(observations[i].module*2,span*.15*Math.min(3,gapMs/40));
  const measured=motions.filter(Boolean);
  const common=measured.length?[0,1].map(j=>measured.map(p=>p[j]).sort((a,b)=>a-b)[Math.floor(measured.length/2)]):null;
  if(measured.length<3||motions.some((m,i)=>dist(m,common)>limit(i))) {
    // Recovery must match the three-square group. Choosing the darkest local
    // patch independently can attach one finder to QR data after a reversal.
    const tryMotion=motion=>{
      const found=starts.map((start,i)=>refine(frame[0],start.map((v,j)=>v+motion[j]),observations[i].axes));
      if(found.some((f,i)=>!f||dist(f.centre,starts[i].map((v,j)=>v+motion[j]))>observations[i].module*2))return null;
      return found;
    };
    let recovered=null;
    for(const motion of [shared,...measured,[0,0]].filter(Boolean)) {
      recovered=tryMotion(motion);if(recovered)break;
    }
    if(!recovered) {
      const candidates=[];
      for(let i=0;i<3;i++) {
        const {axes,module}=observations[i],local=[];
        const motion=observations[i].motion||last.velocity[i].map((v,j)=>v*(j?sy:sx));
        // Include the last measured position as well as the prediction. A blank
        // frame can hide a reversal, so velocity alone must not set the search ROI.
        for(const offset of [[0,0],motion])for(let y=-8;y<=8;y++)for(let x=-8;x<=8;x++) {
          const c=[starts[i][0]+offset[0]+x*module,starts[i][1]+offset[1]+y*module];
          const m=measure(frame[0],c,axes,true);if(m)local.push({c,score:m.score,i});
        }
        local.sort((a,b)=>b.score-a.score);
        const unique=[];
        for(const candidate of local) {
          if(unique.some(other=>dist(other.c,candidate.c)<module))continue;
          unique.push(candidate);if(unique.length===4)break;
        }
        candidates.push(...unique);
      }
      if(diagnostics)diagnostics.centreLocalSearches=3;
      candidates.sort((a,b)=>b.score-a.score);
      for(const {c,i} of candidates) {
        const candidate=refine(frame[0],c,observations[i].axes);
        if(!candidate)continue;
        recovered=tryMotion(candidate.centre.map((v,j)=>v-starts[i][j]));
        if(recovered)break;
      }
    }
    if(!recovered)return reject('three black squares unclear');
    for(let i=0;i<3;i++) {
      ends[i]=recovered[i].centre;motions[i]=ends[i].map((v,j)=>v-starts[i][j]);
      quality=Math.min(quality,Math.min(1,recovered[i].score/120));
    }
  }
  if(diagnostics)diagnostics.centresFound=3;
  try {
    const rows=starts.map(([x,y])=>[x,y,1]),ax=solve(rows,ends.map(p=>p[0])),ay=solve(rows,ends.map(p=>p[1]));
    const det=ax[0]*ay[1]-ax[1]*ay[0];
    if(det<.55||det>1.8||Math.hypot(ax[0]-1,ax[1],ay[0],ay[1]-1)>.45)return reject('square layout inconsistent');
    let shapeH=h,bx=ax,by=ay;
    if(flowH) {
      shapeH=flowH;
      const predicted=positions(dim).map(p=>[...transform(flowH,p),1]);
      bx=solve(predicted,ends.map(p=>p[0]));by=solve(predicted,ends.map(p=>p[1]));
    }
    const apply=([x,y])=>[bx[0]*x+bx[1]*y+bx[2],by[0]*x+by[1]*y+by[2]];
    const corners=src.map(p=>apply(transform(shapeH,p))),current=homography(src,corners);
    const check=verifyPattern(frame[0],current,reference,2,patternPolicy,diagnostics);
    if(check.state==='rejected')return reject('data pattern');
    // Centre corrections preserve the measured flow perspective when available.
    // Request immediate island-edge refinement if its pose is not accurate enough.
    const pose=estimatePose(src,corners,intrinsics,markerSize,dim);
    if(!Number.isFinite(pose.position[2])||pose.position[2]<=0)return reject('pose fit');
    const poseNeedsRefinement=pose.reprojectionError>maxReprojectionError;
    if(diagnostics){diagnostics.centreFlowPoints=flowCount;diagnostics.centreReason=null;}
    return {text:reference.text,dimension:dim,reference,decoded:false,centreTracked:true,pose,corners,homography:current,
      confidence:quality,poseNeedsRefinement,patternMatch:check.match,patternVerification:check.state,
      centreTracking:{frame,centres:ends,velocity:motions,gapMs}};
  } catch(error) {
    if(/geometry|pose/.test(error.message))return reject('pose fit');
    throw error;
  }
}
