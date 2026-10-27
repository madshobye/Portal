"""Run portable facade tests with memory and undefined-behavior sanitizers."""
from pathlib import Path
import subprocess,tempfile
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='facade-tests-') as work:
 for name,extras in [('astro',['astro']),('facade',[]),('settings',['settings']),('protocol',['protocol','settings'])]:
  target=Path(work)/name
  subprocess.run(['clang','-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-fno-sanitize-recover=all','-g','-iquote',str(root/'application/include'),str(root/'application/facade.c'),*[str(root/'application'/f'{extra}.c') for extra in extras],str(root/'tests'/f'{name}_test.c'),'-o',str(target)],check=True)
  subprocess.run([str(target)],check=True)
