#!/usr/bin/env python3
"""Reapply the project's small branding overlay to pinned DSH npm assets."""
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / 'runtime/dsh/node_modules/@deepseek-ai'
BACKUP = ROOT / '.local/dsh-brand-originals/0.1.5-rc.2'
NAME = '百川妇幼专科Agent'
ASSET = ROOT / 'assets/branding/baichuan-medical-logo-hd.png'


def original(relative):
    installed = PACKAGES / relative
    saved = BACKUP / relative
    if not saved.exists():
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(installed, saved)
    return saved.read_text()


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit(f'Unexpected pinned DSH asset: expected one occurrence of {old!r}')
    return text.replace(old, new)


def main():
    version = json.loads((PACKAGES / 'dsh/package.json').read_text())['version']
    if version != '0.1.5-rc.2':
        raise SystemExit(f'Review this overlay before applying it to DSH {version}')
    if not ASSET.exists():
        raise SystemExit(f'Missing completed logo asset: {ASSET}')
    changes = {}
    brand = Path('dsh-client-ui-brand-official/lib/client.js')
    original(brand)
    changes[brand] = (ROOT / 'config/branding/brand-client.js').read_text()
    layout = Path('dsh-client-ui-layout/lib/client.js')
    changes[layout] = replace_once(original(layout),
        'const productTitle = "DeepSeek Harness";', f'const productTitle = "{NAME}";')
    conversation = Path('dsh-client-ui-conversation/lib/client.js')
    text = original(conversation)
    for old in ['"hero.headline": "探索未至之境"', '"hero.headline": "Into the Unknown"']:
        text = replace_once(text, old, f'"hero.headline": "{NAME}"')
    badge = '(0, react_jsx_runtime.jsx)("span", {\n' + '\t' * 8 + 'className: HeroShell_module_css_default.previewBadge,\n' + '\t' * 8 + 'children: t("hero.preview")\n' + '\t' * 7 + '})'
    text = replace_once(text, ', ' + badge, '')
    text = replace_once(text,
        '(0, react_jsx_runtime.jsx)("div", { className: HeroShell_module_css_default.body })',
        '(0, react_jsx_runtime.jsx)("div", { className: HeroShell_module_css_default.body, children: renderSlot("conversation.hero.agentPreset", {}) })')
    text = replace_once(text,
        '}),\n' + '\t' * 5 + 'renderSlot("conversation.hero.agentPreset", {})', '})')
    text = replace_once(text,
        'hero && heroWorkspaceRow,\n' + '\t' * 5 + 'zone !== void 0 && renderSlot("conversation.input.dock", zone),\n' + '\t' * 5 + 'inputBar',
        '''(0, react_jsx_runtime.jsxs)("div", {
                        className: "bc-composer-frame",
                        "data-hero": hero ? "" : void 0,
                        children: [
                            zone !== void 0 && renderSlot("conversation.input.dock", zone),
                            inputBar,
                            hero && heroWorkspaceRow
                        ]
                    })''')
    text = replace_once(text, '"hero.chooseWorkspace": "选择工作区"',
                        '"hero.chooseWorkspace": "选择工作空间"')
    # Version-checked health record integration: composer seat and normal send path.
    health_core = (ROOT / 'config/health-records/core.js').read_text()
    health_panel = (ROOT / 'config/health-records/panel.js').read_text()
    text = replace_once(text, '\t\tconst InputBar = ', health_core + '\n' + health_panel + '\n\t\tconst InputBar = ')
    text = replace_once(text,
        '\t\t\t\t\t\t\tsessionId !== void 0 && (0, react_jsx_runtime.jsx)("div", {',
        '\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(BcHealthEntry, { sessionId }, sessionId ?? "unbound"),\n' +
        '\t\t\t\t\t\t\tsessionId !== void 0 && (0, react_jsx_runtime.jsx)("div", {')
    text = replace_once(text,
        'return this.conversation().sendSession(session, text, attachmentIds, mode, signal);',
        'return bcHealth.withContext(session.sessionId, text, (message) => this.conversation().sendSession(session, message, attachmentIds, mode, signal));')
    changes[conversation] = text
    preset = Path('dsh-client-ui-agent-preset/lib/client.js')
    text = original(preset)
    start = text.index('\t\tfunction AgentPresetSeat({')
    end = text.index('\n\t\t//#endregion', start)
    text = text[:start] + (ROOT / 'config/branding/agent-preset-seat.js').read_text() + text[end:]
    changes[preset] = text
    index = Path('dsh-web-frontend/dist/index.html')
    text = replace_once(original(index), '<title>DeepSeek Harness</title>', f'<title>{NAME}</title>')
    text = replace_once(text, 'type="image/svg+xml" href="./favicon.svg"',
                        'type="image/png" href="./branding/baichuan-medical-logo.png?v=2"')
    text = text.replace('<html lang="en">', '<html lang="zh-CN">')
    text = replace_once(text, '</head>',
        '  <link rel="stylesheet" href="./branding/start-page.css?v=3" />\n</head>')
    changes[index] = text
    manifest = Path('dsh-web-frontend/dist/manifest.webmanifest')
    data = json.loads(original(manifest))
    data.update(name=NAME, short_name=NAME)
    data['icons'] = [{'src': '/branding/baichuan-medical-logo.png?v=2', 'type': 'image/png', 'purpose': 'any'}]
    changes[manifest] = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    # All version-sensitive replacements succeeded before touching runtime files.
    target = PACKAGES / 'dsh-web-frontend/dist/branding/baichuan-medical-logo.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ASSET, target)
    (target.parent / 'start-page.css').write_text((ROOT / 'config/branding/start-page.css').read_text() + '\n' + (ROOT / 'config/health-records/panel.css').read_text())
    for relative, content in changes.items():
        (PACKAGES / relative).write_text(content)
    print(f'Applied {NAME}: branding, segmented presets, composer footer and health records drawer.')


if __name__ == '__main__':
    main()
