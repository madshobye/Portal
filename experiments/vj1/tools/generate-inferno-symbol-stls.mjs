import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/stl/inferno-symbols");
const TAU = Math.PI * 2;
const point = (x, y, z) => [x, y, z];

class Mesh {
  constructor(name) { this.name = name; this.triangles = []; }
  tri(a, b, c) { this.triangles.push([a, b, c]); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
}

function addBox(mesh, cx, cy, cz, sx, sy, sz) {
  const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
  const p=[point(x0,y0,z0),point(x1,y0,z0),point(x1,y1,z0),point(x0,y1,z0),point(x0,y0,z1),point(x1,y0,z1),point(x1,y1,z1),point(x0,y1,z1)];
  mesh.quad(p[0],p[3],p[2],p[1]); mesh.quad(p[4],p[5],p[6],p[7]);
  mesh.quad(p[0],p[1],p[5],p[4]); mesh.quad(p[1],p[2],p[6],p[5]);
  mesh.quad(p[2],p[3],p[7],p[6]); mesh.quad(p[3],p[0],p[4],p[7]);
}

function addCylinderBetween(mesh, a, b, radius, segments = 9) {
  const axis=normalize(sub(b,a));
  const helper=Math.abs(axis[2])<.9?point(0,0,1):point(0,1,0);
  const u=normalize(cross(axis,helper)),v=cross(axis,u);
  for(let i=0;i<segments;i++){
    const t0=i/segments*TAU,t1=(i+1)/segments*TAU;
    const r0=add(scale(u,Math.cos(t0)*radius),scale(v,Math.sin(t0)*radius));
    const r1=add(scale(u,Math.cos(t1)*radius),scale(v,Math.sin(t1)*radius));
    const a0=add(a,r0),a1=add(a,r1),b0=add(b,r0),b1=add(b,r1);
    mesh.quad(a0,b0,b1,a1); mesh.tri(a,a1,a0); mesh.tri(b,b0,b1);
  }
}

function addTorus(mesh, cx, cy, cz, major, minor, majorSegments = 48, minorSegments = 8) {
  const at=(a,b)=>point(cx+Math.cos(a)*(major+Math.cos(b)*minor),cy+Math.sin(a)*(major+Math.cos(b)*minor),cz+Math.sin(b)*minor);
  for(let i=0;i<majorSegments;i++)for(let j=0;j<minorSegments;j++){
    const a0=i/majorSegments*TAU,a1=(i+1)/majorSegments*TAU,b0=j/minorSegments*TAU,b1=(j+1)/minorSegments*TAU;
    mesh.quad(at(a0,b0),at(a1,b0),at(a1,b1),at(a0,b1));
  }
}

function addPolylineTube(mesh, points, radius, segments = 8, closed = false) {
  const count=closed?points.length:points.length-1;
  for(let i=0;i<count;i++)addCylinderBetween(mesh,points[i],points[(i+1)%points.length],radius,segments);
}

function addSquareFrame(mesh, size, thickness, depth, z = 0) {
  const half=size/2, bar=thickness;
  addBox(mesh,0,-half+bar/2,z+depth/2,size,bar,depth);
  addBox(mesh,0,half-bar/2,z+depth/2,size,bar,depth);
  addBox(mesh,-half+bar/2,0,z+depth/2,bar,size-2*bar,depth);
  addBox(mesh,half-bar/2,0,z+depth/2,bar,size-2*bar,depth);
}

function eternityCircles() {
  const mesh=new Mesh("Eternity circles");
  for(const [radius,z] of [[38,2.4],[27,4.2],[16,6]])addTorus(mesh,0,0,z,radius,2.4,52,8);
  addTorus(mesh,0,0,7.5,5,2.2,32,8);
  return mesh;
}

function descentSpiral() {
  const mesh=new Mesh("Spiral descent");
  const points=[];
  const turns=4.6,segments=110;
  for(let i=0;i<=segments;i++){
    const t=i/segments,angle=t*turns*TAU,radius=42*(1-t)+5*t;
    points.push(point(Math.cos(angle)*radius,Math.sin(angle)*radius,2.5+t*16));
  }
  addPolylineTube(mesh,points,2.2,7);
  for(let i=0;i<5;i++)addTorus(mesh,0,0,1.5+i*2.2,42-i*8,1.2,40,6);
  return mesh;
}

function faithCross() {
  const mesh=new Mesh("Faith cross");
  addBox(mesh,0,0,4,16,88,8);
  addBox(mesh,0,15,6,58,15,12);
  for(const x of [-8,8])addBox(mesh,x,0,9,2.3,88,2.5);
  for(const y of [7.5,22.5])addBox(mesh,0,y,11,58,2.3,2.5);
  return mesh;
}

function orderSquare() {
  const mesh=new Mesh("Order square");
  for(let i=0;i<5;i++)addSquareFrame(mesh,92-i*16,4.2,5+i*1.3,i*.8);
  addCylinderBetween(mesh,point(-44,-44,7),point(44,44,7),1.5,8);
  addCylinderBetween(mesh,point(-44,44,7),point(44,-44,7),1.5,8);
  return mesh;
}

function divineTriangle() {
  const mesh=new Mesh("Divine triangle");
  for(let ring=0;ring<4;ring++){
    const scaleValue=1-ring*.19;
    const vertices=[point(0,-48*scaleValue,3+ring*1.8),point(44*scaleValue,32*scaleValue,3+ring*1.8),point(-44*scaleValue,32*scaleValue,3+ring*1.8)];
    addPolylineTube(mesh,vertices,2.4-ring*.25,9,true);
  }
  for(let i=0;i<7;i++){
    const t=(i+1)/8;
    addCylinderBetween(mesh,point(-44*(1-t),32-80*t,2),point(44*(1-t),32-80*t,2),.75,7);
  }
  addCylinderBetween(mesh,point(0,-48,2),point(0,32,2),1.1,8);
  return mesh;
}

function normalizeMesh(mesh) {
  const vertices=mesh.triangles.flat();
  const min=[0,1,2].map(axis=>Math.min(...vertices.map(vertex=>vertex[axis])));
  const max=[0,1,2].map(axis=>Math.max(...vertices.map(vertex=>vertex[axis])));
  const center=[(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]];
  const size=Math.max(...max.map((value,axis)=>value-min[axis]));
  return mesh.triangles.map(triangle=>triangle.map(vertex=>vertex.map((value,axis)=>(value-center[axis])*100/size)));
}

function binaryStl(name, triangles) {
  const buffer=Buffer.alloc(84+triangles.length*50);
  buffer.write(`VJ1 symbol: ${name}`.slice(0,80),0,"ascii"); buffer.writeUInt32LE(triangles.length,80);
  let offset=84;
  for(const triangle of triangles){
    const normal=normalize(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0])));
    for(const value of normal){buffer.writeFloatLE(value,offset);offset+=4;}
    for(const vertex of triangle)for(const value of vertex){buffer.writeFloatLE(value,offset);offset+=4;}
    buffer.writeUInt16LE(0,offset);offset+=2;
  }
  return buffer;
}

const add=(a,b)=>a.map((value,index)=>value+b[index]);
const sub=(a,b)=>a.map((value,index)=>value-b[index]);
const scale=(a,value)=>a.map(item=>item*value);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=(a)=>{const length=Math.hypot(...a)||1;return a.map(value=>value/length);};

const symbols=[
  ["01_eternity_circles.stl",eternityCircles],
  ["02_spiral_descent.stl",descentSpiral],
  ["03_faith_cross.stl",faithCross],
  ["04_order_square.stl",orderSquare],
  ["05_divine_triangle.stl",divineTriangle],
];

await mkdir(outputDir,{recursive:true});
const manifest=[];
for(const [filename,create] of symbols){
  const mesh=create(),triangles=normalizeMesh(mesh),data=binaryStl(mesh.name,triangles);
  await writeFile(resolve(outputDir,filename),data);
  manifest.push({filename,name:mesh.name,triangles:triangles.length,bytes:data.byteLength});
}
await writeFile(resolve(outputDir,"manifest.json"),`${JSON.stringify(manifest,null,2)}\n`);
await writeFile(resolve(outputDir,"README.md"),`# Inferno symbolic STL collection\n\nFive shallow 3D emblems derived from the symbolic forms in the supplied moodboard: eternity circles, descent spiral, faith cross, order square, and divine triangle. Each asset is an independent overlapping-shell binary STL optimized for realtime visual rendering.\n\nRegenerate with:\n\n\`\`\`sh\nnode experiments/vj1/tools/generate-inferno-symbol-stls.mjs\n\`\`\`\n`);
console.log(`Generated ${manifest.length} symbolic STL files in ${outputDir}`);
for(const entry of manifest)console.log(`${entry.filename}: ${entry.triangles} triangles, ${entry.bytes} bytes`);
