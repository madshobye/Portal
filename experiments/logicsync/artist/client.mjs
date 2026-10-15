/** Small, bounded client for the controller's authenticated artist WebSocket. */
export class FacadeArtist extends EventTarget {
  constructor({fixtures=[1,0,0,0],WebSocketClass=globalThis.WebSocket,timeout=4000}={}) {
    super();this.WebSocketClass=WebSocketClass;this.timeout=timeout;this.ws=null;this.pending=null;this.claimed=false;this.heartbeat=null;
    this.configure(fixtures);
  }
  configure(fixtures) {
    if(!Array.isArray(fixtures)||fixtures.length!==4||fixtures.some(n=>!Number.isInteger(n)||n<0||n>4)||fixtures.reduce((a,b)=>a+b,0)<1)throw Error('Use four fixture counts, 0–4 each, with at least one fixture');
    this.fixtures=[...fixtures];this.pixelCount=fixtures.reduce((a,b)=>a+b,0)*28;
  }
  async connect(address,key) {
    if(this.ws)throw Error('Already connected or connecting');
    if(!/^[a-f0-9]{32}$/.test(key))throw Error('Artist key must be 32 lowercase hexadecimal characters');
    const url=new URL(address.includes('://')?address:'ws://'+address);
    if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Use a WebSocket host without credentials or query parameters');
    url.pathname='/ws';
    const ws=this.ws=new this.WebSocketClass(url.href);
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const fail=error=>{if(!settled){settled=true;reject(error);}};
      const openTimer=setTimeout(()=>{fail(Error('Connection timed out'));this.close();},this.timeout);
      ws.onopen=async()=>{
        if(this.ws!==ws)return;
        clearTimeout(openTimer);
        try {
          await this._request('claim '+key);this.claimed=true;settled=true;
          this.heartbeat=setInterval(()=>{if(this.claimed&&!this.pending)this._request('keepalive').catch(()=>this.close());},3000);
          this.dispatchEvent(new Event('connected'));resolve(this);
        }catch(error){fail(error);this.close();}
      };
      ws.onmessage=event=>{
        if(this.ws!==ws||!this.pending)return;
        let result;try{result=JSON.parse(event.data);}catch{this.close();return;}
        const pending=this.pending;this.pending=null;clearTimeout(pending.timer);
        if(result.ok===true)pending.resolve();else pending.reject(Error('Controller rejected the command or artist key'));
      };
      ws.onerror=()=>{fail(Error('WebSocket connection failed'));if(this.ws===ws)this.close();};
      ws.onclose=()=>{clearTimeout(openTimer);fail(Error('Connection closed'));if(this.ws===ws)this._closed();};
    });
  }
  _request(payload) {
    if(!this.ws||this.ws.readyState!==1)return Promise.reject(Error('Not connected'));
    if(this.pending)return Promise.reject(Error('A command is still awaiting acknowledgement'));
    if(this.ws.bufferedAmount>4096)return Promise.reject(Error('Connection is congested'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(this.pending){this.pending=null;reject(Error('Controller acknowledgement timed out'));this.close();}},this.timeout);
      this.pending={resolve,reject,timer};
      try{this.ws.send(payload);}catch(error){clearTimeout(timer);this.pending=null;reject(error);}
    });
  }
  _bytes(values) {
    if(!values||!Number.isInteger(values.length)||Array.from(values).some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('RGB and DMX values must be integer bytes');
    return Uint8Array.from(values);
  }
  async _artistRequest(payload) {if(!this.claimed)throw Error('Claim artist control first');return this._request(payload);}
  /** No queued frames: returns false when busy, so animation loops can drop a frame. */
  frame(rgb) {
    const bytes=this._bytes(rgb);if(bytes.length!==this.pixelCount*3)throw Error(`Expected ${this.pixelCount*3} RGB bytes`);
    if(!this.claimed||this.pending||this.ws.bufferedAmount>4096)return false;
    const packet=new Uint8Array(bytes.length+1);packet[0]=1;packet.set(bytes,1);
    this._request(packet).catch(()=>this.close());return true;
  }
  range(start,rgb) {
    const bytes=this._bytes(rgb);const count=bytes.length/3;
    if(!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<1||start+count>this.pixelCount)throw Error('Pixel range is outside the configured string');
    const packet=new Uint8Array(bytes.length+3);packet.set([2,start>>8,start&255]);packet.set(bytes,3);return this._artistRequest(packet);
  }
  pixel(index,r,g,b){return this.range(index,[r,g,b]);}
  fixture(output,index,rgb) {
    if(!Number.isInteger(output)||output<0||output>3||!Number.isInteger(index)||index<0||index>=this.fixtures[output])throw Error('Fixture is outside the configured output');
    const bytes=this._bytes(rgb);if(bytes.length!==84)throw Error('A fixture has 28 RGB pixels (84 bytes)');
    const start=(this.fixtures.slice(0,output).reduce((a,b)=>a+b,0)+index)*28;return this.range(start,bytes);
  }
  raw(output,start,values) {
    const bytes=this._bytes(values);
    if(!Number.isInteger(output)||output<0||output>3||!Number.isInteger(start)||start<1||!bytes.length||start+bytes.length>513)throw Error('Raw DMX range is outside the universe');
    const packet=new Uint8Array(bytes.length+4);packet.set([3,output,start>>8,start&255]);packet.set(bytes,4);return this._artistRequest(packet);
  }
  clear(){return this._artistRequest('/pixels/clear {}');}
  async disconnect(){try{if(this.claimed&&!this.pending)await this._request('release');}finally{this.close();}}
  _closed(){clearInterval(this.heartbeat);this.heartbeat=null;this.claimed=false;this.ws=null;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('Connection closed'));this.pending=null;}this.dispatchEvent(new Event('disconnected'));}
  close(){const ws=this.ws;this._closed();if(ws)ws.close();}
}
