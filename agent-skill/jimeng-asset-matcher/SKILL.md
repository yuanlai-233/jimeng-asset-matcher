---
name: jimeng-asset-matcher
description: 安装、更新和使用即梦素材一键匹配扩展，根据提示词中的 @完整素材名 上传本地图片、视频和音频并绑定原生引用标签。用户提到即梦/Dreamina 素材自动上传、批量匹配、扩展安装或相关排错时使用。
license: MIT
metadata:
  version: "0.3.24"
  package-revision: "2"
  compatibility: "自动安装需要本机文件系统与 Python 3.9+；扩展运行需要桌面 Chrome 或 Edge 及即梦/Dreamina 页面。云端环境只能整理文件与指导本机安装。"
---

# 即梦素材一键匹配

内置 v0.3.24 的完整运行源码，无需编译、API Key、MCP 或 npm 依赖。扩展提供“自动上传 → 自动匹配”两步流程，普通创作页与无限画布分别处理当前输入框，并随网页浅色 / 深色模式自动换色。

## 安装或更新

用户要求安装时，直接完成其已授权的本机安装。仅询问用法时不运行安装脚本。

1. 以当前 `SKILL.md` 所在目录为 Skill 根目录，解析 [scripts/install.py](scripts/install.py) 的绝对路径；不要假设当前工作目录就是 Skill 目录。
2. 使用可用的 Python 3.9+ 运行脚本。Skill 已由平台导入时运行 `python3 "<Skill目录>/scripts/install.py" --extension-only`；Windows 可用 `py -3`。尚未安装 Skill 时，按当前宿主使用 `--platform codex` 或 `--platform claude`；其他宿主用 `--skills-dir "<平台的skills目录>"`，不要猜目录。完整参数见 [安装说明](references/installation.md)。
3. 脚本先校验随包文件，再把扩展放入稳定目录；同版不重复写入，更新保留旧目录备份。指定目录包含不相关内容时会停止，不要添加强制覆盖来绕过。
4. 读取脚本输出中的 `extension_dir`。浏览器应加载这个**直接包含 manifest.json 的目录**。有可用且获授权的浏览器/桌面操作工具时，继续操作扩展管理页：开发者模式 → 加载已解压的扩展程序；更新则重新加载已有扩展。没有相关工具时，给用户该绝对路径和这几个步骤。首次加载的官方流程见 [Chrome 文档](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。
5. 验证扩展卡片名称“即梦素材一键匹配”和版本 `0.3.24`；保存提示词、刷新即梦页面并点击视频提示词框，确认按钮出现。只有实际看见这些结果才能报告浏览器端已启用。`browser_status: manual_load_required` 仅表示文件准备完成。

扩展默认安装到用户目录下的 `JimengAssetMatcher/extension`，不使用临时解压目录作为最终安装位置。脚本不会修改浏览器配置、注册表、启动参数或企业策略。云端文件系统不能代替用户电脑；此时交付安装包和本机步骤。

## 使用与排错

操作前按需阅读 [图文使用说明](references/user-guide.md)。关键规则：

- 写半角 `@` 加完整文件名，不含扩展名；保留名称内部的空格、括号。例如 `@产品_绿杯，`。不要缩写、写成 `@@名称`、`@ 名称` 或全角 `＠`。
- 选择包含图片、视频、音频的根文件夹，扩展递归查找明确引用的文件。同名冲突先解决，不能凭相似度猜素材。
- 自动上传完成后，再点击自动匹配。保留原 `@素材名` 文字，在其后追加网页原生标签；重复引用每处分别配对，同一文件只上传一份。
- 目录权限、索引和上传记录属于页面会话。刷新后已有附件的任务先匹配核对，再补传缺失项；新增文件或换目录用 Shift 点击自动上传。
- 等匹配停止后再编辑提示词或切节点。遇到待确认上传、错位标签或内容变化，按界面提示处理，避免连续重传。
- 数量、大小、编码和时长以当前网页及模型限制为准；不要把某一站点或模式的容量推断为其他站点和模式也相同。
- 安装扩展不包含上传用户素材或提交生成的授权。用户要求上传或匹配时按其指定素材和范围操作；生成任务由用户确认提交。

## 维护与分发

修改代码或核对原理时读 [核心代码说明](references/core-code.md)，运行源码位于 [assets/extension](assets/extension)。核对分发包可运行 `python3 "<Skill目录>/scripts/install.py" --verify`。

上架字段和可直接使用的介绍见 [LISTING.md](LISTING.md)。保留 [MIT 许可证](LICENSE)、[隐私说明](references/PRIVACY.md)、[项目声明](references/DISCLAIMER.md) 和 [第三方说明](references/THIRD_PARTY_NOTICES.md)。
