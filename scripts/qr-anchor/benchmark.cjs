// Reproducible CPU pipeline comparison; fixture construction is outside timings.
// Run from any directory: node scripts/qr-anchor/benchmark.cjs
const {performance}=require('node:perf_hooks');
const {fixture,moduleHarness,core}=require('../../P1/tests/helpers/qr-anchor.cjs');
const config={text:'qr7',width:960,height:720,focal:900,position:[0,0,4],angles:[.3,-.25,.1]};
const frames=Array.from({length:30},(_,i)=>fixture({...config,
  position:[.2*Math.sin(i*.18),.08*Math.sin(i*.13),4-.1*Math.sin(i*.15)],
  angles:[.3+.06*Math.sin(i*.15),-.25+.04*Math.sin(i*.13),.1+.08*Math.sin(i*.12)]}));
(async()=>{
  const f={...frames[0]},h=moduleHarness(f),a=await new h.c.QrAnchor({video:h.video,target:'qr7',centreTracking:true,patternIntervalMs:4000,recoveryMs:350,roiPadding:.5,intrinsics:{...f.intrinsics,width:f.width,height:f.height}}).init();
  const calls={detect:0,locate:0,decodeTracked:0,refineTrackedGeometry:0,track:0,trackCentres:0};
  a._core={...core};
  for(const key of Object.keys(calls)) a._core[key]=(...args)=>{calls[key]++;return core[key](...args);};
  const phases={},blank=new Uint8ClampedArray(f.data.length);blank.fill(255);
  for(let i=0;i<200;i++) {
    const phase=i<90?'beforeLoss':i<110?'lost':'afterRecovery';
    const stats=phases[phase]??=( {times:[],measured:0,decoded:0,searches:0,localSearches:0,maxCrop:0} );
    const n=i<90?i:i-110,j=Math.max(0,n)%60,index=j<30?j:59-j;
    f.data=phase==='lost'?blank:frames[index].data;
    h.setTime(i*40);h.video.currentTime=i*.04;
    const start=performance.now();a.update();const elapsed=performance.now()-start;
    if(i>=10&&(phase!=='afterRecovery'||i>=120))stats.times.push(elapsed);
    if(a._lastSeen===i*40)stats.measured++;
    if(a._lastSeen===i*40&&a._result?.decoded)stats.decoded++;
    const d=a.getLatest().diagnostics;
    stats.searches+=d.searchAttempted?1:0;stats.localSearches+=d.centreLocalSearches||0;
    stats.maxCrop=Math.max(stats.maxCrop,d.cropWidth||0,d.cropHeight||0);
  }
  const summary={};
  for(const [name,s] of Object.entries(phases)) {
    s.times.sort((a,b)=>a-b);
    summary[name]={measured:s.measured,decoded:s.decoded,searches:s.searches,localSearches:s.localSearches,maxCrop:s.maxCrop,
      medianMs:s.times[Math.floor(s.times.length*.5)],p95Ms:s.times[Math.floor(s.times.length*.95)]};
  }
  console.log(JSON.stringify({frames:200,phases:summary,calls},null,2));
})();
