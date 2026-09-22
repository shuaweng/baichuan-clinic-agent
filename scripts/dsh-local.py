#!/usr/bin/env python3
"""Manage this project's loopback-only DSH process; no model calls."""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import re
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
HOME_DIR = LOCAL / 'dsh-home'
WORKSPACE = LOCAL / 'dsh-workspace'
PID_FILE = LOCAL / 'dsh.pid'
LOG = LOCAL / 'logs/dsh.log'
BIN = ROOT / 'runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'
URL = 'http://127.0.0.1:3080'


def owned_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
        if str(BIN) in result.stdout and '--port 3080' in result.stdout:
            return pid
    except (ValueError, OSError):
        pass
    return None


def login_url():
    try:
        matches = re.findall(r'dsh web: (http://127\.0\.0\.1:3080/\?token=\S+)', LOG.read_text())
        return matches[-1] if matches else None
    except OSError:
        return None


def ready():
    try:
        # DSH's homepage requires its local startup-token cookie exchange.
        address = login_url()
        if not address:
            return False
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        with opener.open(address, timeout=2) as response:
            return response.status == 200 and b'<html' in response.read(4096).lower()
    except Exception:
        return False


def prepare():
    for path in (HOME_DIR, WORKSPACE, LOG.parent):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Keep the existing id so earlier sessions still resolve their preset.
    # Product persona and display metadata are managed by config/maternal-agent.
    preset = HOME_DIR / '.agent-presets/maternal-preview'
    if preset.exists():
        backup = LOCAL / 'backups/maternal-preset-before-lifecycle-update'
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(preset, backup)
    preset.mkdir(parents=True, exist_ok=True)
    prompt = (ROOT / 'config/maternal-agent/system-prompt.v0.1.md').read_text()
    composition_path = preset / 'agent.cordis.yml'
    composition = json.loads(composition_path.read_text()) if composition_path.exists() else []
    persona = next((row for row in composition if row.get('id') == 'persona'), None)
    if persona is None:
        persona = {'id': 'persona', 'name': '@deepseek-ai/dsh-persona'}
        composition.insert(0, persona)
    persona.setdefault('config', {}).update(prefix=prompt, complete=True, includeRuntimeContext=False)
    # JSON is a YAML subset. No executable YAML expressions are needed here.
    (preset / 'agent.cordis.yml').write_text(json.dumps(composition, ensure_ascii=False, indent=2) + '\n')
    metadata_path = preset / 'preset.yml'
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    metadata.update(json.loads((ROOT / 'config/maternal-agent/preset.json').read_text()))
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    (preset / '.jev-initialized').touch()


def start():
    if not BIN.exists():
        raise SystemExit('DSH not installed: run npm ci --prefix runtime/dsh')
    pid = owned_pid()
    if pid:
        print(f'DSH already running: PID {pid}, {URL}, HTTP ready={ready()}')
        return
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 3080)) == 0:
            raise SystemExit('Port 3080 is in use by another process; not changing it.')
    subprocess.run([sys.executable, str(ROOT / 'scripts/apply-dsh-branding.py')], check=True)
    prepare()
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required')
    env = os.environ.copy()
    env['DSH_HOME'] = str(HOME_DIR)
    env['DSH_TELEMETRY_MODE'] = 'DISABLED'
    # Do not inherit unrelated account secrets into this independent deployment.
    for key in list(env):
        if any(term in key.upper() for term in ('API_KEY', 'TOKEN', 'PASSWORD', 'SECRET')):
            env.pop(key, None)
    command = [node, str(BIN), 'web', '--patch', str(ROOT / 'config/dsh-local.patch.yml'),
               '--host', '127.0.0.1', '--port', '3080', '--no-open']
    with LOG.open('ab') as output:
        child = subprocess.Popen(command, cwd=WORKSPACE, env=env,
                                 stdin=subprocess.DEVNULL, stdout=output,
                                 stderr=subprocess.STDOUT, start_new_session=True)
    PID_FILE.write_text(str(child.pid) + '\n')
    for _ in range(80):
        if child.poll() is not None:
            PID_FILE.unlink(missing_ok=True)
            raise SystemExit(f'DSH exited ({child.returncode}). See {LOG}')
        if ready():
            print(f'DSH started: {URL}\nPID: {child.pid}\nLog: {LOG}')
            return
        time.sleep(0.25)
    raise SystemExit(f'DSH is still starting, PID {child.pid}. See {LOG}')


def stop():
    pid = owned_pid()
    if not pid:
        print('No matching project DSH process found; no process stopped.')
        return
    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        if not owned_pid():
            PID_FILE.unlink(missing_ok=True)
            print('DSH stopped.')
            return
        time.sleep(0.25)
    raise SystemExit('DSH did not stop within 10 seconds; no forced kill attempted.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status', 'url'])
    action = parser.parse_args().action
    if action == 'start':
        start()
    elif action == 'stop':
        stop()
    elif action == 'url':
        if not owned_pid():
            raise SystemExit('DSH is not running. Start it before requesting its login URL.')
        print(login_url() or 'Startup URL not available yet.')
    else:
        print(json.dumps({'pid': owned_pid(), 'url': URL, 'http_ready': ready(),
                          'log': str(LOG)}, ensure_ascii=False, indent=2))
