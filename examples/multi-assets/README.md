# 多素材测试文件

下载项目后即可使用，无需运行脚本。

| 测试 | 选择的本地目录 | 提示词 |
| --- | --- | --- |
| 30 张图片 | `images` | [prompt-30-images.txt](prompt-30-images.txt) |
| 50 项混合素材 | v0.3.17 选择整个 `multi-assets` 根目录自动上传 | [prompt-50-mixed.txt](prompt-50-mixed.txt) |
| 100 处引用 | 复用上面已上传的 50 项，不再上传 | [prompt-100-references.txt](prompt-100-references.txt) |
| 第 31 张图片 | 满 30 张后，从网页原生入口添加 `boundary/测试图_31.png` | [prompt-31-images.txt](prompt-31-images.txt) |

历史 v0.3.16 已实测单次完成 50 项混合素材匹配，以及复用同一批素材的 100 处引用；再次点击没有重复标签。详见 [多素材实测说明](../../docs/MULTI_ASSET_GUIDE.md)。

图片是本地绘制的编号测试卡；视频是测试卡的缓慢放大；音频是低音量正弦测试音。均用于文件名、容量和标签校验，不代表视频生成效果。

[make-fixtures.py](make-fixtures.py) 可重建全部文件，需要 Python 3、Pillow 和 FFmpeg。脚本会覆盖本目录下同名测试文件。

[返回使用说明](../../USER_GUIDE.md)

v0.3.17 的混合自动上传完整实测使用 [复杂名称测试文件](../mixed-names/README.md)。本目录的 `boundary` 文件只有被提示词精确引用时才会上传。
