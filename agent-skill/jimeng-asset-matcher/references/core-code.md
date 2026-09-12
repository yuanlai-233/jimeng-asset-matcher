# 核心代码说明

本包保留 v0.3.19 发布包中全部 26 个运行文件，位于 `assets/extension/`，包含 19 个 JavaScript 文件、CSS、manifest、4 个图标与 MIT 许可证。除发布仓库中的 README、CHANGELOG、截图和 `.gitignore` 外，扩展运行文件与 v0.3.19 发布目录逐文件一致，未重写核心逻辑。

代码使用原生 JavaScript，不需要构建或 npm 依赖。浏览器按 `manifest.json` 的声明顺序加载。本 Skill 不附带测试素材、测试脚本、验收截图或历史调试产物。

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 配置、站点范围、脚本顺序、storage 权限 |
| `media-files.js` | 图片、视频和音频类型识别与上传格式检查 |
| `upload-bridge.js`、`canvas-upload-bridge.js` | 普通页与画布的原生上传桥接 |
| `matcher.js` | 提示词引用解析、完整名称匹配及引用错误识别 |
| `local-directory.js`、`local-assets.js` | 目录选择、递归索引、冲突检查与读取精确命中的文件 |
| `local-workflow.js`、`local-upload.js` | 规划上传批次、核对已有素材、等待确认与增量补传 |
| `editor.js` | 编辑器文档与光标处理、引用位置和原生标签配对 |
| `candidates.js` | 获取网页原生候选、滚动候选列表、按完整名查找 |
| `native-trigger.js` | 触发并管理网页原生引用入口 |
| `canvas.js` | 无限画布及当前活动节点适配 |
| `runtime.js` | 扩展模块共享状态和运行支持 |
| `theme.js`、`bgm.js`、`bgm-bridge.js` | 网页深浅色适配与背景音乐开关 |
| `ui.js`、`content.css` | 两步控制条、状态提示、交互与样式 |
| `onboarding.js` | 首次使用引导 |
| `content.js` | 串联上传、候选扫描、逐处插入与结果核对 |

## 执行逻辑

提示词显式引用 → 精确解析名称 → 从用户选定根目录建立索引 → 排除已确认素材 → 通过网页原生入口上传 → 等待用户启动匹配 → 获取原生素材候选 → 在原文后逐处追加标签 → 核对配对状态。

重复引用与重复上传是两件事：同一文件只需上传一份，提示词中每处引用都需要自己的原生标签。界面显示“已匹配”只表示引用配对完成。

## 安装层

`scripts/install.py` 仅处理分发和本地复制；不向页面注入额外逻辑，不读取素材，不接触登录状态。扩展目录与 Skill 目录独立，避免平台更新或清理解压目录后破坏浏览器加载路径。

`bundle.json` 记录版本、包修订号和文件 SHA-256。修改随包代码或文档后，应重新生成校验清单和 ZIP；否则安装器会明确拒绝校验不通过的文件。不要在校验失败后跳过校验继续安装。

## 权限与运行边界

扩展保留原 manifest：权限为 `storage`，站点仅为 `https://jimeng.jianying.com/*` 与 `https://dreamina.capcut.com/*`。安装过程离线；使用时明确引用的素材交给当前网页上传。目录索引属于当前页面会话，具体说明见 [隐私说明](PRIVACY.md)。
