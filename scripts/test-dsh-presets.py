"""Verify 0.1.7 preset migration in a temporary home; no server or model calls."""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location('dsh_local', Path(__file__).with_name('dsh-local.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with TemporaryDirectory(prefix='jev-preset-migration-') as temporary:
    module.LOCAL = Path(temporary)
    module.HOME_DIR = module.LOCAL / 'home'
    module.WORKSPACE = module.LOCAL / 'workspace'
    module.LOG = module.LOCAL / 'logs/dsh.log'
    module.PRESET_PATCH = module.LOCAL / 'presets.patch.json'
    module.prepare()
    first = module.PRESET_PATCH.read_text()
    module.prepare()
    assert module.PRESET_PATCH.read_text() == first
    rows = json.loads(first)[0]['insert']
    presets = {row['config']['id']: row['config'] for row in rows}
    assert set(presets) == {'maternal-preview', 'baichuan-gynecology', 'baichuan-pediatrics', 'baichuan-office'}
    for row in rows:
        assert row['name'] == '@deepseek-ai/dsh-agent-preset'
        config = row['config']
        assert config['plugins'][0]['name'] == '@deepseek-ai/dsh-persona'
        assert config['plugins'][0]['config']['prefix']
        if config['id'].startswith('baichuan-'):
            assert any(plugin['name'].endswith('/runtime/medical-kb/dsh-plugin.mjs') for plugin in config['plugins'])
            assert '回答的语气与篇幅' in config['plugins'][0]['config']['prefix']
    assert len({row['id'] for row in rows}) == 4
print('DSH 0.1.7 declarative preset migration: passed (isolated temporary home)')
