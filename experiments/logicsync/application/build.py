"""Build standalone firmware. Dependencies are pinned in dependencies.json."""
import json,subprocess,sys,hashlib,concurrent.futures,secrets
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parent;PRIVATE=Path.home()/'.codex/memories/logicsync-private';PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True);OUT=PRIVATE/'application';OUT.mkdir(parents=True,exist_ok=True)
key_path=PRIVATE/'access-keys.json'
if not key_path.exists():
 key_path.write_text(json.dumps({'artist':secrets.token_hex(16),'admin':secrets.token_hex(16)},indent=2)+'\n');key_path.chmod(0o600)
keys=json.loads(key_path.read_text())
assert all(len(keys[k])==32 and all(c in '0123456789abcdef' for c in keys[k]) for k in ['artist','admin'])
(OUT/'access_keys.h').write_text('#define ARTIST_KEY '+json.dumps(keys['artist'])+'\n#define ADMIN_KEY '+json.dumps(keys['admin'])+'\n')
DEPS=ROOT/'artifacts/deps';SDK=DEPS/'gd32/lib-gd32/gd32f30x';LWIP=DEPS/'lwip/src';PERIPH=SDK/'GD32F30x_standard_peripheral'
# RTL8201F reports negotiated speed/duplex in BMCR, whose speed bit is the
# inverse of the DP83848 status register expected by the vendor's generic code.
s=(PERIPH/'Source/gd32f30x_enet.c').read_text()
needle='if((uint16_t)RESET != (phy_value & PHY_SPEED_STATUS)) {'
assert s.count(needle)==1
s=s.replace(needle,'if((uint16_t)RESET == (phy_value & PHY_SPEED_STATUS)) {')
(OUT/'enet_rtl8201f.c').write_text(s)
mqtt_source=(LWIP/'apps/mqtt/mqtt.c').read_text()
needle='remaining_length == 0 ? MQTT_DATA_FLAG_LAST : 0);'
assert mqtt_source.count(needle)==1
mqtt_source=mqtt_source.replace(needle,'(remaining_length == 0 ? MQTT_DATA_FLAG_LAST : 0) | ((client->rx_buffer[0] & 1) ? 0x80 : 0));')
(OUT/'mqtt_retained.c').write_text(mqtt_source)
sources=list(HERE.glob('*.c'))+[SDK/'CMSIS/GD/GD32F30x/Source/system_gd32f30x.c']+[PERIPH/f'Source/gd32f30x_{name}.c' for name in ['rcu','gpio','usart','dma','fmc']]+[OUT/'enet_rtl8201f.c']+list((LWIP/'core').glob('*.c'))+list((LWIP/'core/ipv4').glob('*.c'))+[LWIP/'netif/ethernet.c',LWIP/'apps/sntp/sntp.c',OUT/'mqtt_retained.c']
(OUT/'webpage.h').write_text('static const char page[]='+json.dumps((HERE/'index.html').read_text())+';\n')
incs=[OUT,HERE/'include',DEPS/'gd32/CMSIS/Core/Include',SDK/'CMSIS/GD/GD32F30x/Include',PERIPH/'Include',LWIP/'include']
flags=['-mcpu=cortex-m4','-mthumb','-mfloat-abi=soft','-Os','-g','-ffreestanding','-fno-builtin','-ffunction-sections','-fdata-sections','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-Wall','-Wextra','-DGD32F30X_CL','-DUSE_STDPERIPH_DRIVER','-DPHY_TYPE=2','-DPHY_SR=0','-DPHY_SPEED_STATUS=0x2000','-DPHY_DUPLEX_STATUS=0x100','-DENET_RXBUF_NUM=4','-DENET_TXBUF_NUM=2']+['-I'+str(i) for i in incs]
def compile_one(item):
 i,src=item;obj=OUT/f'{i}_{src.stem}.o';subprocess.run(['arm-none-eabi-gcc',*flags,'-c',str(src),'-o',str(obj)],check=True);return obj
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:objects=list(pool.map(compile_one,enumerate(sources)))
elf=OUT/'custom.elf';binary=OUT/'custom.raw.bin'
subprocess.run(['arm-none-eabi-gcc','-mcpu=cortex-m4','-mthumb','-mfloat-abi=soft','-nostdlib','-Wl,--gc-sections','-Wl,-Map='+str(OUT/'custom.map'),'-T'+str(HERE/'linker.ld'),*[str(o) for o in objects],'-lgcc','-o',str(elf)],check=True)
subprocess.run(['arm-none-eabi-size',str(elf)],check=True)
subprocess.run(['arm-none-eabi-objcopy','-O','binary',str(elf),str(binary)],check=True)
raw=binary.read_bytes()
raw+=b'\xff'*((-len(raw))%4);binary.write_bytes(raw)
assert len(raw)<=0x33000, 'Application overlaps persistent settings pages'
report={'image':str(binary),'format':'raw application; not an upload package','sha256':hashlib.sha256(raw).hexdigest(),'application_bytes':len(raw),'app_base':'0x08008000','hardware_tested':False}
(OUT/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
