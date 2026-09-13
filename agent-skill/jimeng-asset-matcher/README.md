# 即梦素材一键匹配 Skill

**v0.3.20 · 分发包修订 1 · MIT · 含完整扩展核心源码**

把“即梦素材一键匹配”交给 AI 助手安装、讲解和排错。内置原版 Chrome / Edge 扩展，根据提示词中的 `@完整素材名` 自动上传本地图片、视频和音频，再追加网页原生引用标签。

## 快速安装

从 GitHub 克隆后，在 Agent 终端执行这一行即可安装 Codex Skill 和浏览器扩展文件：

```bash
git clone --depth 1 https://github.com/yuanlai-233/jimeng-asset-matcher.git && python3 jimeng-asset-matcher/agent-skill/jimeng-asset-matcher/scripts/install.py --platform codex --open
```

Claude Code 将末尾的 `--platform codex` 改为 `--platform claude`。首次使用仍需在 Chrome / Edge 扩展管理页加载脚本输出的目录。

解压后，把整个 `jimeng-asset-matcher` 文件夹交给支持 Skill 的本地 AI 助手，并说：

> 请读取这个文件夹的 SKILL.md，安装即梦素材一键匹配，并帮我完成浏览器加载。

也可以在解压后的 Skill 目录打开终端，运行下面任意一条命令。需要 Python 3.9+，不需要 pip、npm、API Key 或管理员权限。

```bash
# Codex：安装 Skill 和浏览器扩展文件
python3 scripts/install.py --platform codex --open

# Claude Code：安装 Skill 和浏览器扩展文件
python3 scripts/install.py --platform claude --open

# Skill 已通过平台导入：只安装浏览器扩展文件
python3 scripts/install.py --extension-only --open
```

Windows 将 `python3` 换成 `py -3`，或双击 `install-windows.cmd`；默认安装到 Codex，需要 Claude Code 时选择对应命令。macOS 可双击 `install-macos.command`，或执行上面的终端命令。启动器找不到 Python 时会提示，不会替你下载安装其他软件。

脚本会校验内置文件、复制 Skill 和扩展、为更新保留备份，并输出浏览器应加载的绝对路径。**首次仍需在 Chrome / Edge 扩展管理页开启开发者模式并加载该目录。** AI 助手有可用的桌面操作权限时可协助完成；仅运行脚本不会启用浏览器扩展。

没有 Python 也能使用：把 `assets/extension` 整个文件夹复制到固定位置，在扩展管理页加载它。加载的目录必须直接包含 `manifest.json`。

## 开始使用

1. 在即梦的视频提示词中写半角 `@` 加完整素材名，不含扩展名，例如 `@产品_绿杯，`。
2. 点击 **自动上传**，选择素材根文件夹。等网页接收完素材。
3. 点击 **自动匹配**，检查每处原文字后出现对应原生标签，再自行生成。

[图文使用说明](references/user-guide.md)包含真实截图、无限画布操作、视频/音频流程、复杂名称示例和常见问题。

## 随包内容

| 文件或目录 | 用途 |
| --- | --- |
| [SKILL.md](SKILL.md) | 通用 Agent Skills 入口 |
| [scripts/install.py](scripts/install.py) | 离线安装、预览、校验、备份 |
| [assets/extension](assets/extension) | v0.3.20 完整运行源码、图标及 manifest |
| [references/installation.md](references/installation.md) | 安装位置、更新、回退、卸载 |
| [references/user-guide.md](references/user-guide.md) | 可离线阅读的图文说明 |
| [references/core-code.md](references/core-code.md) | 核心模块和实现逻辑 |
| [LISTING.md](LISTING.md) | 可用于上架的名称、简介、详细介绍 |
| [bundle.json](bundle.json) | 版本及随包文件 SHA-256 校验清单 |
| [LICENSE](LICENSE) | MIT 许可证 |

离线安装不访问任何服务器；使用扩展时，明确命中的素材通过即梦/Dreamina 网页原生上传。项目沿用 [隐私说明](references/PRIVACY.md) 和 [非官方项目声明](references/DISCLAIMER.md)。

上游项目：[GitHub](https://github.com/yuanlai-233/jimeng-asset-matcher) · [v0.3.20 发布](https://github.com/yuanlai-233/jimeng-asset-matcher/releases/tag/v0.3.20)。

赞赏支持：

![源来的赞赏码](references/images/reward-qrcode.png)
