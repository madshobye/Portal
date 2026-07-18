import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/stl/inferno-panoramas");
const TAU = Math.PI * 2;
const p = (x, y, z) => [x, y, z];

class Mesh {
  constructor(name) { this.name = name; this.triangles = []; }
  tri(a, b, c) { this.triangles.push([a, b, c]); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
}

function addBox(mesh, cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const q = [p(x0,y0,z0),p(x1,y0,z0),p(x1,y1,z0),p(x0,y1,z0),p(x0,y0,z1),p(x1,y0,z1),p(x1,y1,z1),p(x0,y1,z1)];
  mesh.quad(q[0],q[3],q[2],q[1]); mesh.quad(q[4],q[5],q[6],q[7]);
  mesh.quad(q[0],q[1],q[5],q[4]); mesh.quad(q[1],q[2],q[6],q[5]);
  mesh.quad(q[2],q[3],q[7],q[6]); mesh.quad(q[3],q[0],q[4],q[7]);
}

function addFrustum(mesh, cx, cy, z0, z1, r0, r1, segments = 7) {
  const bottom = p(cx, cy, z0), top = p(cx, cy, z1);
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * TAU, a1 = (i + 1) / segments * TAU;
    const b0 = p(cx + Math.cos(a0)*r0, cy + Math.sin(a0)*r0, z0);
    const b1 = p(cx + Math.cos(a1)*r0, cy + Math.sin(a1)*r0, z0);
    const t0 = p(cx + Math.cos(a0)*r1, cy + Math.sin(a0)*r1, z1);
    const t1 = p(cx + Math.cos(a1)*r1, cy + Math.sin(a1)*r1, z1);
    mesh.quad(b0,b1,t1,t0); mesh.tri(bottom,b1,b0); mesh.tri(top,t0,t1);
  }
}

function addEllipsoid(mesh, cx, cy, cz, rx, ry, rz, lat = 6, lon = 8) {
  const rings = [];
  for (let j = 1; j < lat; j++) {
    const polar = j / lat * Math.PI;
    rings.push(Array.from({ length: lon }, (_, i) => {
      const a = i / lon * TAU;
      return p(cx + Math.cos(a)*rx*Math.sin(polar), cy + Math.sin(a)*ry*Math.sin(polar), cz + Math.cos(polar)*rz);
    }));
  }
  const top = p(cx,cy,cz+rz), bottom = p(cx,cy,cz-rz);
  for (let i = 0; i < lon; i++) {
    const n = (i + 1) % lon;
    mesh.tri(top,rings[0][n],rings[0][i]);
    for (let j = 0; j < rings.length - 1; j++) mesh.quad(rings[j][i],rings[j][n],rings[j+1][n],rings[j+1][i]);
    mesh.tri(bottom,rings.at(-1)[i],rings.at(-1)[n]);
  }
}

function addCylinder(mesh, a, b, radius, segments = 6) {
  const axis = normalize(sub(b,a));
  const helper = Math.abs(axis[2]) < 0.9 ? p(0,0,1) : p(0,1,0);
  const u = normalize(cross(axis,helper)), v = cross(axis,u);
  for (let i = 0; i < segments; i++) {
    const a0=i/segments*TAU, a1=(i+1)/segments*TAU;
    const r0=add(scale(u,Math.cos(a0)*radius),scale(v,Math.sin(a0)*radius));
    const r1=add(scale(u,Math.cos(a1)*radius),scale(v,Math.sin(a1)*radius));
    const q0=add(a,r0), q1=add(a,r1), q2=add(b,r1), q3=add(b,r0);
    mesh.quad(q0,q1,q2,q3); mesh.tri(a,q1,q0); mesh.tri(b,q3,q2);
  }
}

function addTorus(mesh, cx, cy, cz, major, minor, majorSegments = 18, minorSegments = 5) {
  const at = (a,b) => p(cx + Math.cos(a)*(major + Math.cos(b)*minor), cy + Math.sin(a)*(major + Math.cos(b)*minor), cz + Math.sin(b)*minor);
  for (let i=0;i<majorSegments;i++) for (let j=0;j<minorSegments;j++) {
    const a0=i/majorSegments*TAU,a1=(i+1)/majorSegments*TAU,b0=j/minorSegments*TAU,b1=(j+1)/minorSegments*TAU;
    mesh.quad(at(a0,b0),at(a1,b0),at(a1,b1),at(a0,b1));
  }
}

function addGround(mesh, height = 1) { addBox(mesh, 0, 0, height/2, 240, 34, height); }

function addFigure(mesh, x, y, z = 1, size = 1, lean = 0, arms = 0.4) {
  const hip=p(x,y,z+5*size), shoulder=p(x+lean*size,y,z+12*size), head=p(x+lean*1.25*size,y,z+16*size);
  addFrustum(mesh,x+lean*.5*size,y,z+4*size,z+13*size,2.2*size,1.5*size,6);
  addEllipsoid(mesh,head[0],head[1],head[2],1.8*size,1.5*size,2.1*size,5,7);
  addCylinder(mesh,hip,p(x-1.8*size,y,z),.7*size,5); addCylinder(mesh,hip,p(x+2*size,y,z),.7*size,5);
  addCylinder(mesh,shoulder,p(x-(3.5+arms)*size,y,z+(8+arms*2)*size),.58*size,5);
  addCylinder(mesh,shoulder,p(x+(3.5+arms)*size,y,z+(8-arms*2)*size),.58*size,5);
}

function addArch(mesh, x, y, z, width, height, depth = 4) {
  addBox(mesh,x-width*.42,y,z+height*.42,width*.16,depth,height*.84);
  addBox(mesh,x+width*.42,y,z+height*.42,width*.16,depth,height*.84);
  const segments=8;
  for(let i=0;i<segments;i++) {
    const a0=Math.PI-i/segments*Math.PI,a1=Math.PI-(i+1)/segments*Math.PI;
    const a=p(x+Math.cos(a0)*width*.42,y,z+height*.78+Math.sin(a0)*width*.42);
    const b=p(x+Math.cos(a1)*width*.42,y,z+height*.78+Math.sin(a1)*width*.42);
    addCylinder(mesh,a,b,width*.08,5);
  }
}

function addFlame(mesh,x,y,z,size=1) {
  addFrustum(mesh,x,y,z,z+8*size,2.2*size,.15*size,7);
  addFrustum(mesh,x+.7*size,y,z+2*size,z+6*size,1.3*size,.1*size,6);
}

function addTwistedTree(mesh,x,y,z,size=1) {
  let cursor=p(x,y,z);
  for(let i=0;i<4;i++) {
    const next=p(x+Math.sin(i*1.7+x)*2.5*size,y+Math.cos(i*1.3)*1.2*size,z+(i+1)*6*size);
    addCylinder(mesh,cursor,next,(1.8-i*.3)*size,6); cursor=next;
  }
  for(const direction of [-1,1]) {
    const branch=p(cursor[0]+direction*7*size,cursor[1]+direction*2*size,cursor[2]+5*size);
    addCylinder(mesh,cursor,branch,.8*size,5);
    addCylinder(mesh,branch,p(branch[0]+direction*3*size,branch[1],branch[2]+4*size),.45*size,5);
  }
}

function limbo() {
  const m=new Mesh("Circle I - Limbo colonnade panorama"); addGround(m);
  for(let i=0;i<9;i++) addArch(m,-105+i*26,8-(i%2)*4,1,18,24+(i%3)*5,4);
  for(let i=0;i<14;i++) addFigure(m,-100+i*15,-7+(i%3)*5,1,.55+(i%2)*.08,(i%3-1)*.3,.2);
  return m;
}

function stormOfSouls() {
  const m=new Mesh("Circle II - Storm of souls panorama"); addGround(m,.8);
  for(let i=0;i<18;i++) {
    const x=-110+i*13, z=10+Math.sin(i*.85)*10+(i%3)*3, y=Math.cos(i*.7)*8;
    addFigure(m,x,y,z,.55,Math.sin(i)*1.5,1.4);
    addCylinder(m,p(x-6,y,z+10),p(x+7,y+Math.sin(i)*4,z+13+Math.cos(i)*4),.32,5);
  }
  for(let i=0;i<7;i++) addTorus(m,-80+i*27,0,9+Math.sin(i)*5,7+i%2*3,.45,14,4);
  return m;
}

function gluttony() {
  const m=new Mesh("Circle III - Mire and Cerberus panorama"); addGround(m,2);
  for(let i=0;i<16;i++) addEllipsoid(m,-110+i*15,-6+(i%4)*4,3,6+(i%3),4,2+(i%2),5,7);
  for(let i=0;i<8;i++) addFigure(m,-90+i*24,5-(i%3)*4,2,.55,Math.sin(i)*.8,.8);
  addFrustum(m,70,5,2,22,10,7,8);
  for(const [dx,dy] of [[-8,0],[0,2],[8,0]]) {
    addCylinder(m,p(70,5,19),p(70+dx,5+dy,28),3.2,7);
    addEllipsoid(m,70+dx,5+dy,30,6,5,5,6,9);
    addFrustum(m,70+dx,1+dy,27,32,4.5,2,7);
  }
  return m;
}

function hoarders() {
  const m=new Mesh("Circle IV - Hoarders collision panorama"); addGround(m);
  for(let i=0;i<14;i++) {
    const side=i<7?-1:1, lane=i%7, x=side*(18+lane*14), y=side*4+(lane%2)*3;
    addFigure(m,x,y,1,.62,-side*.7,1.2);
    addEllipsoid(m,x-side*8,y,7,6.5,5.5,6.5,6,8);
    addCylinder(m,p(x,y,10),p(x-side*7,y,8),.7,5);
  }
  addArch(m,0,8,1,24,30,6);
  return m;
}

function styx() {
  const m=new Mesh("Circle V - Styx and the city of Dis panorama"); addGround(m,1);
  for(let i=0;i<11;i++) {
    const x=-105+i*20;
    addEllipsoid(m,x,-7+(i%3)*4,4,8,5,2.2,4,8);
    addFigure(m,x,-7+(i%3)*4,3,.55,(i%2?-.8:.8),1.4);
  }
  for(let i=0;i<9;i++) {
    const x=-100+i*25, h=20+(i%4)*8;
    addBox(m,x,11,h/2+1,14,7,h); addFrustum(m,x,11,h+1,h+10,8,0,6);
  }
  addArch(m,0,7,1,34,34,7);
  return m;
}

function flamingTombs() {
  const m=new Mesh("Circle VI - Flaming tombs panorama"); addGround(m);
  for(let i=0;i<15;i++) {
    const x=-108+i*15.5,y=-7+(i%3)*7;
    addBox(m,x,y,4,12,6,6); addBox(m,x,y-1,8,11,5,1.1);
    addFlame(m,x,y,8,.55+(i%3)*.12);
  }
  for(let i=0;i<6;i++) addArch(m,-95+i*38,11,1,17,25+(i%2)*8,4);
  return m;
}

function violence() {
  const m=new Mesh("Circle VII - River forest and burning desert panorama"); addGround(m);
  for(let i=0;i<8;i++) {
    const x=-110+i*15; addEllipsoid(m,x,-5+(i%2)*6,3,8,5,2,4,7); addFigure(m,x,-5+(i%2)*6,2,.5,.6,1.2);
  }
  for(let i=0;i<7;i++) addTwistedTree(m,-35+i*13,4-(i%2)*7,1,.65+(i%3)*.1);
  for(let i=0;i<8;i++) { const x=62+i*7; addFigure(m,x,-6+(i%3)*5,1,.48,Math.sin(i),.4); addFlame(m,x+3,5,1,.45); }
  addArch(m,-55,9,1,20,22,4); addArch(m,48,9,1,20,22,4);
  return m;
}

function malebolge() {
  const m=new Mesh("Circle VIII - Malebolge bridges panorama"); addGround(m);
  for(let i=0;i<10;i++) {
    const x=-108+i*24;
    addTorus(m,x,0,3,9,1.8,16,5);
    addFrustum(m,x,0,0,3,8.5,8.5,12);
    if(i<9) addArch(m,x+12,6,5,22,18+(i%2)*5,3.2);
    addFigure(m,x,-1,4,.42,(i%2?-.8:.8),.8);
  }
  return m;
}

function cocytus() {
  const m=new Mesh("Circle IX - Frozen Cocytus and Lucifer panorama"); addGround(m,1.2);
  for(let i=0;i<18;i++) {
    const x=-112+i*13,y=-8+(i%4)*5;
    addFigure(m,x,y,0,.48,Math.sin(i*.8)*.5,.1);
    addBox(m,x,y,4,5,4,8);
  }
  addFrustum(m,0,7,1,30,11,7,9);
  for(const dx of [-8,0,8]) addEllipsoid(m,dx,7,34,6,5,6,6,9);
  for(const side of [-1,1]) {
    const root=p(side*7,7,25), tip=p(side*35,4,42), low=p(side*31,7,12);
    addCylinder(m,root,tip,1.2,6); addCylinder(m,root,low,1.2,6);
    for(let i=0;i<5;i++) addCylinder(m,add(root,scale(sub(tip,root),i/5)),add(root,scale(sub(low,root),i/5)),.55,5);
  }
  for(let i=0;i<15;i++) addCylinder(m,p(-115+i*16,-14,1),p(-105+i*16,14,1.3),.28,4);
  return m;
}

function normalizedPanorama(mesh) {
  const vertices=mesh.triangles.flat();
  const min=[0,1,2].map(axis=>Math.min(...vertices.map(v=>v[axis])));
  const max=[0,1,2].map(axis=>Math.max(...vertices.map(v=>v[axis])));
  const center=[(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]];
  const scaleValue=100/Math.max(1,max[0]-min[0]);
  return mesh.triangles.map(triangle=>triangle.map(v=>[(v[0]-center[0])*scaleValue,(v[1]-center[1])*scaleValue,(v[2]-center[2])*scaleValue]));
}

function binaryStl(name,triangles) {
  const buffer=Buffer.alloc(84+triangles.length*50); buffer.write(`VJ1 panorama: ${name}`.slice(0,80),0,"ascii"); buffer.writeUInt32LE(triangles.length,80);
  let offset=84;
  for(const triangle of triangles) {
    const normal=normalize(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0])));
    for(const value of normal){buffer.writeFloatLE(value,offset);offset+=4;}
    for(const vertex of triangle)for(const value of vertex){buffer.writeFloatLE(value,offset);offset+=4;}
    buffer.writeUInt16LE(0,offset);offset+=2;
  }
  return buffer;
}

const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const scale=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=(a)=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};

const scenes=[
  ["01_limbo_colonnade.stl",limbo], ["02_storm_of_souls.stl",stormOfSouls],
  ["03_gluttony_mire.stl",gluttony], ["04_hoarders_collision.stl",hoarders],
  ["05_styx_city_of_dis.stl",styx], ["06_flaming_tombs.stl",flamingTombs],
  ["07_violence_triptych.stl",violence], ["08_malebolge_bridges.stl",malebolge],
  ["09_frozen_cocytus.stl",cocytus],
];

await mkdir(outputDir,{recursive:true});
const manifest=[];
for(const [filename,create] of scenes){
  const mesh=create(),triangles=normalizedPanorama(mesh),data=binaryStl(mesh.name,triangles);
  await writeFile(resolve(outputDir,filename),data);
  manifest.push({filename,name:mesh.name,triangles:triangles.length,bytes:data.byteLength});
}
await writeFile(resolve(outputDir,"manifest.json"),`${JSON.stringify(manifest,null,2)}\n`);
await writeFile(resolve(outputDir,"README.md"),`# Inferno panorama STL collection\n\nNine wide, low-poly performance scenes inspired by the circles of Dante's Inferno. Each binary STL combines many overlapping closed-shell elements into one shallow panoramic composition. They are visual assets, not fabrication-ready solids.\n\nThe X dimension is normalized to 100 units, Z rests on 0, and depth remains deliberately shallow. Triangle budgets are capped for layering multiple scenes in VJ1.\n\nRegenerate with:\n\n\`\`\`sh\nnode experiments/vj1/tools/generate-inferno-panorama-stls.mjs\n\`\`\`\n`);
console.log(`Generated ${manifest.length} panorama STL files in ${outputDir}`);
for(const entry of manifest)console.log(`${entry.filename}: ${entry.triangles} triangles, ${entry.bytes} bytes`);
