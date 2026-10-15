// Optional rear-camera gyro input; permission is requested only from a user tap.
(function(global){
  const multiply=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  class QrMotionSensor {
    constructor(){this.status=global.DeviceMotionEvent?'waiting':'unavailable';this.q=[0,0,0,1];this.time=null;this.angle=null;this.epoch=0;this.listening=false;this.disposed=false;this.onMotion=e=>this.observe(e);}
    start(){
      if(this.disposed||this.listening||!global.DeviceMotionEvent)return;
      if(typeof global.DeviceMotionEvent.requestPermission==='function'&&!this.permissionGranted){this.status='permission-needed';return;}
      global.addEventListener('devicemotion',this.onMotion);this.listening=true;
    }
    async requestPermission(){
      if(this.disposed)return false;
      try {
        const request=global.DeviceMotionEvent?.requestPermission;
        if(!global.DeviceMotionEvent)return false;
        const result=request?await request.call(global.DeviceMotionEvent):'granted';
        if(this.disposed)return false;
        this.permissionGranted=result==='granted';this.status=this.permissionGranted?'granted':'denied';
        if(result==='granted'){this.start();return true;}
      } catch {if(!this.disposed)this.status='denied';}
      return false;
    }
    observe(event){
      const r=event.rotationRate,now=performance.now(),angle=Number(global.screen?.orientation?.angle??global.orientation??0);
      if(!r||![r.alpha,r.beta,r.gamma].every(v=>typeof v==='number'&&Number.isFinite(v))){this.time=null;this.epoch++;this.status='no-data';return;}
      // Device x=right,y=up,z=out of screen; rear camera x=right,y=down,z=forward.
      const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),rad=Math.PI/180;
      const w=[(r.beta*c+r.gamma*s)*rad,(r.beta*s-r.gamma*c)*rad,-r.alpha*rad];
      const dt=this.time===null?0:(now-this.time)/1000;
      if(this.angle!==angle||dt<=0||dt>.1){this.q=[0,0,0,1];this.epoch++;}
      else {
        const length=Math.hypot(...w),theta=length*dt;
        if(theta>.35){this.q=[0,0,0,1];this.epoch++;}
        else if(length>1e-8){const s=Math.sin(theta/2)/length;this.q=multiply(this.q,[w[0]*s,w[1]*s,w[2]*s,Math.cos(theta/2)]);const n=Math.hypot(...this.q);this.q=this.q.map(v=>v/n);}
      }
      this.time=now;this.angle=angle;this.status='active';
    }
    sample(now=performance.now()){return this.time!==null&&now-this.time<=120?{q:this.q.slice(),time:this.time,epoch:this.epoch}:null;}
    stop(){if(this.listening)global.removeEventListener('devicemotion',this.onMotion);this.listening=false;this.time=null;this.epoch++;}
    dispose(){this.stop();this.disposed=true;}
  }
  global.PortalQrMotionSensor=QrMotionSensor;
})(globalThis);
