/** Reuses Portal's bundled QR encoder; no remote QR service receives the URL. */
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const target='https://madshobye.github.io/Portal/experiments/logicsync/public/';
const context=vm.createContext({});
vm.runInContext(await readFile(new URL('../../rtcchat_v3/runtime/qrcodegen-local.js',import.meta.url),'utf8'),context);
const qr=vm.runInContext(`createQRCode(${JSON.stringify(target)})`,context);
const size=qr.size+8;let path='';
for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))path+=`M${x+4},${y+4}h1v1h-1z`;
// Independently decode the actual module grid with the repository's ZXing package.
const require=createRequire(new URL('../../../scripts/qr-anchor/package.json',import.meta.url));
const {QRCodeReader,BitMatrix}=require('@zxing/library');
const matrix=new BitMatrix(size*8,size*8);
for(let y=0;y<size*8;y++)for(let x=0;x<size*8;x++)if(qr.getModule(Math.floor(x/8)-4,Math.floor(y/8)-4))matrix.set(x,y);
const decoded=new QRCodeReader().decode({getBlackMatrix:()=>matrix});
if(decoded.getText()!==target)throw Error('QR decode did not match target');
await writeFile(new URL('facade-qr.svg',import.meta.url),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Scan to control the Illutron facade"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>\n`);
console.log(`Generated and independently decoded QR: ${target}`);
