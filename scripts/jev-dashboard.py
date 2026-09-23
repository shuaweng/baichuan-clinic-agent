#!/usr/bin/env python3
"""Start/stop this project's loopback-only Jev dashboard without model calls."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local/jev-dashboard'
PID_FILE = LOCAL / 'server.pid'
LOG = LOCAL / 'server.log'
SERVER = ROOT / 'runtime/jev/dashboard/server.mjs'
URL = 'http://127.0.0.1:3081'


def owned_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
        if str(SERVER) in result.stdout:
            return pid
    except (OSError, ValueError):
        pass
    return None


def ready():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(URL, timeout=2) as response:
            return response.status == 200 and 'id="judgments"' in response.read().decode()
    except Exception:
        return False


def start():
    if owned_pid():
        print(f'Dashboard already running: {URL}, ready={ready()}')
        return
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 3081)) == 0:
            raise SystemExit('Port 3081 belongs to another process; no changes made.')
    LOCAL.mkdir(parents=True, exist_ok=True, mode=0o700)
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required')
    env = os.environ.copy()
    for key in list(env):
        if key != 'AI_GATEWAY_API_KEY' and any(term in key.upper() for term in ('API_KEY', 'TOKEN', 'PASSWORD', 'SECRET')):
            env.pop(key, None)
    env['JEV_DASHBOARD_PORT'] = '3081'
    with LOG.open('ab') as output:
        child = subprocess.Popen([node, f'--env-file-if-exists={ROOT / ".env.local"}', str(SERVER)],
                                 cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                 stdout=output, stderr=output, start_new_session=True)
    PID_FILE.write_text(str(child.pid) + '\n')
    for _ in range(60):
        if child.poll() is not None:
            PID_FILE.unlink(missing_ok=True)
            raise SystemExit(f'Dashboard exited; inspect {LOG}')
        if ready():
            print(f'Dashboard started: {URL}\nPID: {child.pid}')
            return
        time.sleep(.25)
    raise SystemExit(f'Dashboard still starting; inspect {LOG}')


def stop():
    pid = owned_pid()
    if not pid:
        print('No matching dashboard process; nothing stopped.')
        return
    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        if not owned_pid():
            PID_FILE.unlink(missing_ok=True)
            print('Dashboard stopped.')
            return
        time.sleep(.25)
    raise SystemExit('Dashboard did not stop; no forced kill attempted.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    action = parser.parse_args().action
    if action == 'start':
        start()
    elif action == 'stop':
        stop()
    else:
        print(json.dumps({'pid': owned_pid(), 'url': URL, 'ready': ready()}, ensure_ascii=False))
