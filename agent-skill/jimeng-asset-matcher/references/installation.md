# 安装、更新与移除

## 环境与自动安装范围

自动安装脚本使用 Python 3.9+ 标准库，面向 macOS、Windows 和 Linux 桌面。浏览器扩展为 Manifest V3，需要桌面 Chrome 或 Edge。无 Python 时仍可手动加载内置 `assets/extension`，扩展运行本身不依赖 Python。

脚本在本机完成文件校验、固定目录复制和更新备份；不联网、不安装依赖、不要求 API Key、不修改浏览器配置。没有本机文件系统权限的云端助手只能准备文件与指导安装。

浏览器需要通过扩展管理页加载未打包扩展；更新运行文件后需要重新加载扩展并刷新网页。[Chrome 官方安装流程](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

## 默认目录

| 内容 | 目录 |
| --- | --- |
| Codex Skill | `~/.agents/skills/jimeng-asset-matcher` |
| Claude Code Skill | `~/.claude/skills/jimeng-asset-matcher` |
| 浏览器扩展 | `~/JimengAssetMatcher/extension` |
| 本地安装指引 | 扩展目录的上一级 `jimeng-installation.html` |

`~` 表示当前用户目录。Windows 对应 `%USERPROFILE%`。安装器输出完整的绝对路径，复制该路径即可。

Codex 当前官方个人目录为 `~/.agents/skills`；旧版或定制宿主需要其他目录时，用 `--skills-dir` 显式指定，安装器不会同时写入多个目录。[Codex 官方说明](https://learn.chatgpt.com/docs/build-skills)。Claude Code 个人目录为 `~/.claude/skills`。[Claude Code 官方说明](https://code.claude.com/docs/en/skills)。

## 命令

以下命令在解压后的 Skill 目录执行；也可以把 `scripts/install.py` 换成该文件的绝对路径。Windows 使用 `py -3` 代替 `python3`。

```bash
python3 scripts/install.py --verify
python3 scripts/install.py --platform codex --dry-run
python3 scripts/install.py --platform codex --open
python3 scripts/install.py --platform claude --open
```

`--verify` 仅核对包内文件，无安装写入；校验清单用于发现损坏或漏文件，不是发行者数字签名。`--dry-run` 输出将要写入的目录和动作，不创建目录、不打开浏览器。

```bash
# Skill 已由市场导入，仅准备扩展文件
python3 scripts/install.py --extension-only --open

# 只安装 Skill，稍后再处理浏览器
python3 scripts/install.py --platform claude --skill-only

# 其他支持 SKILL.md 的平台：指定该平台实际的 skills 父目录
python3 scripts/install.py --skills-dir "/path/to/skills" --extension-dir "/path/to/JimengExtension"

# 项目级安装
python3 scripts/install.py --skills-dir "/path/to/project/.agents/skills"
python3 scripts/install.py --skills-dir "/path/to/project/.claude/skills"
```

`--skills-dir` 是父目录，脚本会自动加上 `jimeng-asset-matcher`；`--extension-dir` 就是最终直接包含 `manifest.json` 的目录。不要把两者设置成彼此的子目录，也不要把安装目标放进解压源目录。

`--open` 只请求系统默认浏览器打开本地安装指引；如果默认浏览器不是 Chrome/Edge，请自行打开其中一个进行扩展加载。

## 浏览器最后一步

1. Chrome 地址栏输入 `chrome://extensions/`；Edge 输入 `edge://extensions/`。
2. 开启开发者模式，点击加载已解压的扩展程序，选择输出的 `extension_dir`。
3. 确认扩展名称“即梦素材一键匹配”、版本 `0.3.20` 且已启用。
4. 保存提示词后刷新即梦页面，进入视频创作并点击提示词框；首次说明点击“开始使用”。

脚本输出 `files_installed` 表示文件部署完成，`manual_load_required` 表示尚未验证浏览器加载。若其他 AI 有本机 UI 操作工具，可继续完成加载与界面核对；不得只凭安装退出码宣称网页已可用。

在 Skill 宿主新开会话或刷新 Skill 列表，确认出现 `jimeng-asset-matcher`。Codex 可输入 `$jimeng-asset-matcher`，Claude Code 可输入 `/jimeng-asset-matcher`；也可直接说“帮我安装即梦素材一键匹配”。

## 更新与回退

下载新版 Skill，在新版解压目录重新执行同一条安装命令。同版一致文件显示 `unchanged`；安装器管理过的旧版目录会完整备份后替换。更新有多个目标时，后续复制失败会回退此前已替换目标。

备份放在目标父目录的上一级 `.jimeng-asset-matcher-backups`，不放进 Skill 发现目录。每份备份位置会输出到 `backups`。例如 Codex 默认 Skill 备份位于 `~/.agents/.jimeng-asset-matcher-backups`。

回退时先停用浏览器扩展，把当前安装目录移到另一处，将输出的备份目录移回原 `target`，然后重新加载扩展、刷新即梦并刷新 Skill 列表。需要同时回退 Skill 和扩展时分别恢复对应备份。

如果原扩展由旧 ZIP 手动安装，或 Skill 由另一个市场管理，安装器不会直接覆盖非本脚本管理的非空目录。由平台完成 Skill 更新，扩展文件可安装到一个新稳定目录，再在浏览器加载新目录并停用旧版。保留正在使用的目录。

## 卸载

先在 Chrome/Edge 扩展管理页移除扩展，再删除安装器输出的扩展目录与指引文件。删除对应宿主 skills 父目录下的 `jimeng-asset-matcher` 即可移除本地 Skill。备份按需保留或删除；不会自动清理备份、素材或浏览器账号数据。

## 平台打包差异

标准包使用 `jimeng-asset-matcher/SKILL.md` 单根目录；另有根目录直接放 `SKILL.md` 的 flat ZIP，以适配不同上传器。两个包内容相同。手动使用 flat 包时，先解压进名为 `jimeng-asset-matcher` 的目录。

市场仅支持纯提示词、禁止脚本或二进制图标时，无法提供此包的完整自动安装能力。此类平台可以引用安装包下载链接和使用说明；按实际平台规则调整，不能宣称所有市场已通过审核。
