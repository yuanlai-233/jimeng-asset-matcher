# 即梦素材一键匹配

[![Latest Release](https://img.shields.io/github/v/release/yuanlai-233/jimeng-asset-matcher?display_name=tag)](https://github.com/yuanlai-233/jimeng-asset-matcher/releases/latest) [![License](https://img.shields.io/github/license/yuanlai-233/jimeng-asset-matcher)](LICENSE)

根据提示词中的 `@素材名`，从本地文件夹自动上传图片、视频和音频，再把即梦 / Dreamina 的原生素材标签添加到原文字后面。支持普通创作页和无限画布。

**写提示词 → 自动上传 → 自动匹配 → 检查后自行生成。**

## 功能

- 递归扫描本地文件夹，按完整文件名匹配图片、视频和音频。
- 分开执行“自动上传”和“自动匹配”，上传失败时可以单独补传。
- 支持即梦和 Dreamina 的普通创作页、无限画布视频节点。
- 保留原始提示词，只在对应引用后添加网页原生素材标签。
- 提供背景音乐开关、主题跟随和 Agent Skill 安装脚本。

## 安装

### 浏览器扩展

1. 从[最新 Release](https://github.com/yuanlai-233/jimeng-asset-matcher/releases/latest)下载插件安装包并解压。
2. 打开 Chrome 的 `chrome://extensions/` 或 Edge 的 `edge://extensions/`。
3. 开启“开发者模式”，选择“加载未打包的扩展程序”。
4. 选择**直接包含 `manifest.json`** 的解压文件夹。
5. 回到即梦或 Dreamina 并刷新页面。

当前发布的插件包：[jimeng-asset-matcher-v0.3.24.zip](https://github.com/yuanlai-233/jimeng-asset-matcher/releases/download/v0.3.24/jimeng-asset-matcher-v0.3.24.zip)。更新扩展时覆盖原文件夹，再点击扩展管理页的“重新加载”。

### Agent 一键安装

在支持 Git 和 Python 3.9+ 的 Agent 终端中运行：

```bash
git clone --depth 1 https://github.com/yuanlai-233/jimeng-asset-matcher.git \
  && python3 jimeng-asset-matcher/agent-skill/jimeng-asset-matcher/scripts/install.py --platform codex --open
```

Claude Code 用户把 `--platform codex` 改为 `--platform claude`。安装脚本会校验文件、保留旧版备份，并输出浏览器扩展目录。

## 使用

1. 打开[即梦](https://jimeng.jianying.com/)或 [Dreamina](https://dreamina.capcut.com/)，进入支持参考素材的视频生成模式。
2. 将素材放在同一个文件夹或其子文件夹中。
3. 在提示词中使用半角 `@` 加完整文件名（不含扩展名），例如：

   ```text
   产品外观参考 @产品_绿杯，环境参考 @场景_窗边。
   ```

4. 点击“自动上传”，选择素材文件夹，等待网页素材就绪。
5. 点击“自动匹配”，检查每个引用后是否出现对应的原生素材标签，再自行生成。

素材名称必须完整；名称中的空格和括号可以保留。已经手动上传素材时，也可以直接写提示词并点击“自动匹配”。

## 文档

- [完整使用说明](USER_GUIDE.md)
- [多素材测试与示例](docs/MULTI_ASSET_GUIDE.md)
- [Agent Skill 使用说明](agent-skill/jimeng-asset-matcher/SKILL.md)
- [更新日志](CHANGELOG.md)
- [全部版本与下载](https://github.com/yuanlai-233/jimeng-asset-matcher/releases)

## 隐私与许可

这是面向即梦 / Dreamina 的非官方辅助扩展。素材和提示词由当前网页直接处理；插件不会向开发者服务器上传素材或提示词。目录索引只保存在当前页面会话中，刷新后需要重新选择目录。

本项目采用 [MIT License](LICENSE)。问题反馈和功能建议请提交 [Issues](https://github.com/yuanlai-233/jimeng-asset-matcher/issues)。

## 赞赏支持

如果这个工具帮你节省了素材整理时间，可以扫码支持后续维护：

![源来的赞赏码](docs/images/reward-qrcode.png)
