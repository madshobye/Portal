const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nearestFrame,startViewer,reportHtml}=require('../../scripts/qr-anchor/report.cjs');

test('replay selects nearest presentation timestamp, not the preceding frame',()=>{
  const frames=[0,1/30,2/30].map(time=>({time}));
  assert.equal(nearestFrame(frames,.033),frames[1]);
  assert.equal(nearestFrame(frames,-1),frames[0]);
  assert.equal(nearestFrame(frames,4),frames[2]);
  assert.equal(nearestFrame([],0),undefined);
});
test('replay paints video and same-frame points together, including paused backward seeks',()=>{
  const calls=[],events={},callbacks=[];
  const node=()=>({style:{},append(){},value:0});
  const ctx={drawImage(){calls.push('video');},clearRect(){calls.push('clear');},
    arc(x){calls.push(x);},beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){}};
  const nodes=Object.fromEntries(['video','canvas','status','seek','play','previous','next','timeline','drops'].map(id=>[id,node()]));
  Object.assign(nodes.video,{readyState:2,seeking:false,currentTime:.09,paused:true,
    requestVideoFrameCallback(fn){callbacks.push(fn);},addEventListener(name,fn){events[name]=fn;},pause(){},play(){return Promise.resolve();}});
  nodes.canvas.getContext=()=>ctx;
  const report={video:{width:640,height:480,fps:30},dropouts:[],frames:[0,1/30,2/30].map((time,i)=>({time,measured:i!==2,points:[[i,0],[i,1],[i,2]],phase:'tracking',mode:'centres',processingMs:3,reason:''}))};
  startViewer(report,{getElementById:id=>nodes[id],createElement:node});
  const present=time=>{assert.equal(callbacks.length,1,'only one callback chain');callbacks.shift()(0,{mediaTime:time});};
  present(1/30);
  assert.deepEqual(calls,['video',1,1,1],'metadata wins over currentTime that is two frames ahead');
  calls.length=0;present(2/30);assert.deepEqual(calls,['video'],'unmeasured frame replaces all old overlay pixels');
  nodes.video.seeking=true;events.seeking();assert.equal(calls.at(-1),'clear');
  calls.length=0;present(0);assert.deepEqual(calls,[]);
  nodes.video.currentTime=0;nodes.video.seeking=false;events.seeked();
  assert.deepEqual(calls,['video',0,0,0],'seek callback can precede seeked while paused');
  calls.length=0;present(9);assert.deepEqual(calls,['video'],'never reuse a distant observation');
  assert.match(nodes.status.textContent,/no matching observation/);
});
test('standalone report escapes embedded metadata and retains original video path',()=>{
  const html=reportHtml({video:{path:'/tmp/a movie.mov',duration:1},summary:{note:'</script><script>bad()</script>'},frames:[],dropouts:[]});
  assert.match(html,/file:\/\/\/tmp\/a%20movie.mov/);
  assert.doesNotMatch(html,/<script>bad\(\)/);
  assert.match(html,/requestVideoFrameCallback/);
});
