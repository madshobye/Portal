import RGBLuminanceSource from '@zxing/library/es2015/core/RGBLuminanceSource.js';
import HybridBinarizer from '@zxing/library/es2015/core/common/HybridBinarizer.js';
import BitMatrix from '@zxing/library/es2015/core/common/BitMatrix.js';
import Decoder from '@zxing/library/es2015/core/qrcode/decoder/Decoder.js';
import DecodeHintType from '@zxing/library/es2015/core/DecodeHintType.js';
import NotFoundException from '@zxing/library/es2015/core/NotFoundException.js';
import ChecksumException from '@zxing/library/es2015/core/ChecksumException.js';
import FormatException from '@zxing/library/es2015/core/FormatException.js';
import Detector from './Detector.js';
import { homography, transform, correspondences, resolvePose, finderQuad } from './geometry.js';
export { homography, transform, estimatePose, project } from './geometry.js';
export { prepareTrackingFrame, seedTracking, track, patternMatch, verifyPattern } from './tracking.js';
export { seedCentres, trackCentres } from './centre-tracking.js';
export { PositionKalman } from './kalman.js';
export { RotationFilter } from './rotation-filter.js';
export { SceneMotion, sceneFeatures, sceneFlow, gyroDelta, gyroProject } from './camera-motion.js';
const decoder = new Decoder();
const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
function sample(image,h,dimension) {
  const bits=new BitMatrix(dimension);
  for(let y=0;y<dimension;y++) for(let x=0;x<dimension;x++) {
    const [u,v]=transform(h,[x+0.5,y+0.5]),ix=Math.floor(u),iy=Math.floor(v);
    if(ix<0||iy<0||ix>=image.getWidth()||iy>=image.getHeight()) throw new Error('QR outside image');
    if(image.get(ix,iy)) bits.set(x,y);
  }
  return bits;
}
function binarize(rgba,width,height) {
  const luminance=new Uint8ClampedArray(width*height);
  for(let i=0;i<luminance.length;i++) luminance[i]=(rgba[i*4]+2*rgba[i*4+1]+rgba[i*4+2])/4;
  return new HybridBinarizer(new RGBLuminanceSource(luminance,width,height)).getBlackMatrix();
}
function expectedFailure(error) {
  return error instanceof NotFoundException || error instanceof FormatException ||
    error instanceof ChecksumException || /Finder|Degenerate|geometry|pose|QR outside/.test(error.message);
}
// Confirm an already tracked QR through its measured homography. This does not
// run finder detection or acquire a new pose; the caller decides when to retry.
export function decodeTracked(rgba,width,height,h,reference) {
  try {
    const result=decoder.decodeBitMatrix(sample(binarize(rgba,width,height),h,reference.dimension),hints);
    return result.getOther()?.isMirrored()?null:result.getText();
  } catch(error) {if(expectedFailure(error))return null;throw error;}
}
// Optional local outline refinement restores perspective while centre tracking
// continues. The known QR dimension/orientation are retained; no payload decode.
export function refineTrackedGeometry(rgba,width,height,reference,priorH,{intrinsics,markerSize=1,maxReprojectionError=3,diagnostics=null,focalScaleRange=null}={}) {
  try {
    const dim=reference.dimension,centres=[[3.5,3.5],[dim-3.5,3.5],[3.5,dim-3.5]],expected=centres.map(p=>transform(priorH,p));
    // The tracked centres already tell us which islands to inspect. Flood only
    // those three inner squares; no finder-pattern scan or outer-ring dependency.
    const image=binarize(rgba,width,height);
    const quads=centres.map((p,i)=>{
      const next=transform(priorH,[p[0]+1,p[1]]);
      const module=Math.hypot(...next.map((v,j)=>v-expected[i][j]));
      return finderQuad(image,expected[i],module,expected,true);
    });
    const {src,dst}=correspondences(quads,dim,true),h=homography(src,dst);
    const error=Math.max(...centres.map((p,i)=>Math.hypot(...transform(h,p).map((v,j)=>v-expected[i][j]))));
    const span=Math.hypot(...expected[0].map((v,j)=>v-expected[1][j]));
    if(error>Math.max(2,span*.08)){if(diagnostics)diagnostics.refineReason='centre disagreement';return null;}
    const solution=resolvePose(src,dst,intrinsics,markerSize,dim,{maxReprojectionError,focalScaleRange});
    if(diagnostics)diagnostics.refineReason=solution?'accepted':'rigid fit';
    if(solution)return {...solution,homography:h,measurements:{src,dst},corners:[[0,0],[dim,0],[dim,dim],[0,dim]].map(p=>transform(h,p))};
  } catch(error) {if(!expectedFailure(error))throw error;if(diagnostics)diagnostics.refineReason=error.message;}
  return null;
}
// Cheap acquisition pass: find pattern centres only, without outlines, decoding or pose.
// The fourth point here is only a generous ROI guess, never a 3D measurement.
export function locate(rgba,width,height,{diagnostics=null}={}) {
  try {
    const info=new Detector(binarize(rgba,width,height)).findPatterns(hints,diagnostics);
    const [tl,tr,bl]=[info.getTopLeft(),info.getTopRight(),info.getBottomLeft()].map(p=>[p.getX(),p.getY()]);
    // Include all possible missing-corner guesses: the centre ordering itself
    // is ambiguous under foreshortening. These only bound the search ROI.
    const points=[tl,tr,bl];
    return {points:[tl,tr,[tr[0]+bl[0]-tl[0],tr[1]+bl[1]-tl[1]],bl],
      expandedPoints:[...points,...points.map((p,i)=>[0,1].map(axis=>points[(i+1)%3][axis]+points[(i+2)%3][axis]-p[axis]))]};
  } catch(error) { if(expectedFailure(error)) return null; throw error; }
}
function signature(bits,dimension) {
  return Uint8Array.from({length:dimension*dimension},(_,i)=>bits.get(i%dimension,Math.floor(i/dimension))?1:0);
}
// Pixel-only entry point. No DOM, MediaStream, BrowserQRCodeReader, or global ZXing.
// This acquisition/verification path always decodes. Corner tracking is separate.
// Only a successful decode can create a new identity reference.
export function detect(rgba,width,height,{target='qr2',markerSize=1,intrinsics,maxReprojectionError=3,focalScaleRange=null,diagnostics=null,innerFinders=false}={}) {
  try {
    const image=binarize(rgba,width,height);
    for(const geometry of new Detector(image,innerFinders).detectCandidates(hints,diagnostics)) {
      if(diagnostics) diagnostics.geometryFound=true;
      // Tracking keeps the known version; acquisition tries nearby dimensions.
      const dimensions=[0,-4,4,-8,8].map(delta=>geometry.dimension+delta);
      for(const dimension of dimensions) {
        if(dimension<21||dimension>177) continue;
        try {
          const {src,dst}=correspondences(geometry.quads,dimension,innerFinders),h=homography(src,dst);
          const bits=sample(image,h,dimension),modules=signature(bits,dimension);
          const result=decoder.decodeBitMatrix(bits,hints);
          if(result.getOther()?.isMirrored()) continue;
          const text=result.getText(),verifiedReference={text,dimension,modules};
          if(diagnostics){diagnostics.decodedText=text;diagnostics.targetMatches=target===null||text===target;}
          if(target!==null&&text!==target) return null;
          const solution=resolvePose(src,dst,intrinsics,markerSize,dimension,{maxReprojectionError,focalScaleRange});
          if(!solution) continue;
          if(diagnostics) diagnostics.poseValid=true;
          return {text,dimension,...solution,homography:h,reference:verifiedReference,decoded:true,measurements:{src,dst},
            corners:[[0,0],[dimension,0],[dimension,dimension],[0,dimension]].map(p=>transform(h,p))};
        } catch(error) { if(expectedFailure(error)) continue; throw error; }
      }
    }
  } catch(error) { if(!expectedFailure(error)) throw error; }
  return null;
}
