// Constant-velocity Kalman filter: independent [position, velocity] states for
// camera-space X/Y/Z. Reads predict without advancing or training the filter.
export class PositionKalman {
  constructor(scale=1) {this.scale=scale;this.time=null;this.axes=null;this.samples=0;}
  observe(position,time,confidence=1) {
    const dt=this.time===null?0:(time-this.time)/1000,s=this.scale;
    const variance=(s*(.004+.012*(1-Math.max(0,Math.min(1,confidence)))))**2;
    if(!this.axes||dt<=0||dt>.5||Math.hypot(...position.map((x,i)=>x-this.axes[i].x))>s*.6) {
      this.axes=position.map(x=>({x,v:0,a:variance,b:0,c:s*s*4}));this.samples=1;
    } else {
      this.axes=this.axes.map((axis,i)=>{
        const p=this._predict(axis,dt),r=variance*(i===2?4:1),innovation=position[i]-p.x;
        const kx=p.a/(p.a+r),kv=p.b/(p.a+r);
        return {x:p.x+kx*innovation,v:Math.max(-4*s,Math.min(4*s,p.v+kv*innovation)),
          a:(1-kx)*p.a,b:(1-kx)*p.b,c:Math.max(0,p.c-kv*p.b)};
      });
      this.samples++;
    }
    this.time=time;
  }
  _predict(p,dt) {
    const q=(this.scale*6)**2;
    return {x:p.x+p.v*dt,v:p.v,a:p.a+2*dt*p.b+dt*dt*p.c+q*dt**4/4,
      b:p.b+dt*p.c+q*dt**3/2,c:p.c+q*dt*dt};
  }
  at(time,maxPredictionMs=150) {
    if(!this.axes) return null;
    const age=Math.max(0,time-this.time);
    // Compute a fixed horizon from the observation, then advance toward it.
    // Shrinking the current age in steps can otherwise move a prediction backward
    // whenever it crosses an uncertainty limit, creating a visible jump.
    let horizon=maxPredictionMs/1000;
    if(this.samples<3) horizon=0;
    const speed=Math.hypot(...this.axes.map(p=>p.v));
    if(speed*horizon>this.scale*.3) horizon=this.scale*.3/speed;
    const safe=dt=>Math.sqrt(Math.max(...this.axes.map(p=>this._predict(p,dt).a)))*3<=this.scale*.3&&this._predict(this.axes[2],dt).x>this.scale*.01;
    if(!safe(horizon)) {
      let lo=0,hi=horizon;
      for(let i=0;i<16;i++) {const mid=(lo+hi)/2;if(safe(mid))lo=mid;else hi=mid;}
      horizon=lo;
    }
    const dt=Math.min(age/1000,horizon);
    const predicted=this.axes.map(p=>this._predict(p,dt));
    return {position:predicted.map(p=>p.x),uncertainty:Math.sqrt(Math.max(...this.axes.map(p=>this._predict(p,age/1000).a))),
      predicting:dt>0&&age<=dt*1000+.1,ageMs:age,horizonMs:horizon*1000};
  }
}
