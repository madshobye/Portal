"""Fetch pinned public dependencies; preserve existing source snapshots."""
import argparse
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
pins = json.loads((HERE / 'dependencies.json').read_text())
urls = {
    'gd32': 'https://github.com/vanvught/GD32F303RC-DMX512-RDM.git',
    'lwip': 'https://github.com/lwip-tcpip/lwip.git',
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--allow-source-snapshot', action='store_true',
                    help='Reuse existing non-Git sources without verifying their revision')
args = parser.parse_args()

for name, revision in pins.items():
    path = HERE.parent / 'artifacts/deps' / name
    if path.exists() and not (path / '.git').exists():
        if not args.allow_source_snapshot:
            raise RuntimeError(
                f'{name}: {path} has no Git metadata. Preserve or move it before '
                'fetching a verified checkout, or explicitly reuse it with '
                '--allow-source-snapshot (revision will not be verified).')
        print(f'{name}: reusing source snapshot; revision NOT verified: {path}')
        continue
    if not path.exists():
        path.mkdir(parents=True)
        subprocess.run(['git', 'init', str(path)], check=True)
        subprocess.run(['git', '-C', str(path), 'fetch', '--depth', '1',
                        urls[name], revision], check=True)
        subprocess.run(['git', '-C', str(path), 'checkout', '--detach', 'FETCH_HEAD'],
                       check=True)
    # Only query a dependency with its own Git metadata; otherwise Git could
    # silently report the enclosing Portal repository's HEAD instead.
    actual = subprocess.check_output(
        ['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != revision:
        raise RuntimeError(f'{name}: revision {actual}, expected {revision}; preserve local work before replacing it')
    changed = subprocess.check_output(
        ['git', '-C', str(path), 'status', '--porcelain'], text=True).strip()
    if changed:
        raise RuntimeError(f'{name}: dependency has local changes; preserve them before fetching a clean copy')
    print(f'{name}: verified clean pinned dependency at {path}')
