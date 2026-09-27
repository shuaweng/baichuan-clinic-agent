#!/usr/bin/env python3
"""Build the public, read-only product showcase. Copies only allowlisted assets."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.local/showcase'
OUT.mkdir(parents=True, exist_ok=True)
assets = OUT / 'assets'
assets.mkdir(exist_ok=True)
for name in ('index.html', 'style.css'):
    shutil.copy2(ROOT / 'site' / name, OUT / name)
for source, target in {
    'assets/branding/baichuan-medical-logo-hd.png': 'logo.png',
    'assets/images-videos/百川Agent启动页.png': 'start.png',
    'assets/images-videos/百川Agent诊室档案.png': 'clinic.png',
    'assets/images-videos/百川Agent儿科带印证截图.png': 'citations.png',
    'assets/images-videos/百川Agent办公模式csv产物截图.png': 'office.png',
    'assets/demo/query-review.mp4': 'query-review.mp4',
    'assets/demo/dashboard.png': 'dashboard.png',
    'assets/demo/qr.png': 'qr.png',
}.items():
    shutil.copy2(ROOT / source, assets / target)
(OUT / '.nojekyll').touch()
print(f'Showcase built: {OUT}')
