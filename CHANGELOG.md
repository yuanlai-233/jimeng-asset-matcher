# Changelog

## v0.3.24 · 匹配提速与切页恢复

- 同一轮引用核对共用一次文字映射和标签扫描；精确位置查找不再创建所有同名引用的 Range。150 处引用的本地回归将核对全文遍历从 150 次降到 1 次。
- 菜单与标签就绪检测按 16ms 轮询，保留原生文档稳定等待、完整名称和相邻标签校验；不并行点击原生菜单。
- 用户点击页面、切换标签页/窗口时立即暂停并清理插件拥有的临时 @；异常退出同样清理，恢复后只补未完成的引用。
- 修复原生工具栏插入 @ 后、登记前切走导致的清理遗漏；仅在删除一个字符后完整富文档与原快照相等时清理，不删除用户输入或已提交标签。
- 保留 50 个新素材一次分派的上传修复。以上为自动化回归结果，实际整轮耗时取决于网页渲染与同步。

## v0.3.23 · 50 文件批量上传

- 新素材最多 50 个一次交给原生上传入口；失败素材仍按原卡片逐项替换，防止覆盖已成功项。

## v0.3.22 · 画布上传失败恢复

- 匹配前核对当前节点的原生上传状态，准确指出失败项，不再只报“素材目录不完整”。
- 再次点击“自动上传”时只原位替换失败的同名素材，保留成功素材、卡片位置和提示词。
- 新增素材逐个上传，等待上一项完成再继续；中断后只记录实际已提交的文件，避免漏传或重复上传。

## v0.3.21 · 完整 50 素材画布匹配修复

- 修复长提示词的原生素材菜单弹到屏幕外：定位每个引用时通过原生编辑器滚动光标，再打开菜单。
- 兼容画布删除文件名空格的行为，例如 `@scene morning` 对应 `scenemorning`；保留原文及空格，只使用唯一完整名称，普通正文编号不作为引用。
- 画布统一读取真实候选目录，按原生名称核对上传结果，并保留原本地文件名的确认记录。
- 50 个不同素材实测通过：30 图片、10 视频、10 音频全部紧邻原引用；原文不变，重复匹配不新增标签。

## v0.3.20 · 修复画布自动匹配

- 兼容新版画布的图片、视频、音频原生候选缩略图标记，修复菜单中存在素材却匹配不到的问题。
- 匹配前等待画布富文本回写稳定，再定位引用光标，避免连续匹配时菜单意外关闭或插入中断。
- 保留精确名称匹配、原文和原生标签校验；普通创作页保持原有触发流程。
- 同步扩展、Agent 安装包版本和文件校验清单，并补充候选识别及异步回写回归测试。

## 0.3.19 - 2026-09-12

- 工具条、提示卡、弹窗及背景音乐按钮随网页深浅色即时切换；浅色下采用白底深字，保留现有布局、尺寸和果冻动效。
- 以当前编辑器及页面的主题设置为准，仅监听有限祖先节点的主题属性变化，不重复扫描长提示词，也不修改网页主题偏好。
- 国际版识别「全方位參考 / Omni reference」模式；Dreamina Seedance 2.0 按 9 图、3 视频、3 音频、共 12 项预检，2.5 保持 30 / 10 / 10、共 50 项。补充繁体中文上传与超限提示识别。
- 更新 Markdown 使用说明与深浅色真实截图；在即梦普通页验证浅色 → 深色 → 浅色即时跟随。保留原生上传流程，不增加匹配次数上限。

## 0.3.18 - 2026-09-11

- 在原生 @ 右侧添加背景音乐音符开关；沿用原生按钮大小与行内间距，关闭时显示斜线，点击带果冻回弹，支持减少动态效果。
- 默认关闭，有正文时在提示词开头补上「不需要背景音乐」，开启时移除本次自动补句；空提示词不填字，重复开关不叠加，手写内容不删除。
- 排除空提示词占位说明里的 @ 图标，确保开关只跟随工具栏按钮；当前已验证的匹配在单纯切换音乐后保留。
- 使用原生富文本事务并跟踪自动补句的位置，保留其余正文、素材标签和光标；中文输入、上传和匹配期间暂停补句。
- 新增真实 ProseMirror 模型回归，覆盖切换、继续输入、段落移动、原生标签、空任务和输入法；两个库仅作为开发测试依赖，不进入扩展安装包。

## 0.3.17 - 2026-09-11

- 修复自动上传只索引图片的问题；递归扫描、精确读取、原生上传和待确认账本现在覆盖图片、视频、音频。
- 普通页与画布共用媒体类型检查，整批文件必须符合原生上传入口的类型要求；视频和音频不会误走图片解码。
- Seedance 2.5 / 全能参考分别检查 30 图、10 视频、10 音频及 50 项总容量；上传提示分别显示三类数量。画布按就绪素材槽位确认混合批次。
- 使用 50 个带空格、括号及相近编号的文件和十段长提示词，在真实普通页单次自动提交 30 图、10 视频、10 音频，随后单击匹配完成。
- 增加混合上传、图片专用入口拒绝混合批次、只补传缺失视频/音频及 50/100/150 处提示词回归；更新 Markdown 指南、截图和测试文件。

## 0.3.16 - 2026-09-11

- 连续匹配遇到网页短暂恢复旧提示词时，等待原文快照恢复后继续；正常路径不增加固定等待，持续编辑仍会阻止候选点击。
- 每次重新查找当前工具栏内的原生按钮，复用已确认的范围，减少长页面上的全局扫描。
- 支持新版原生菜单中仅有音频封面图标的候选，继续排除命令和主体库条目。
- 待确认的本地图片名单未覆盖全部提示词时，读取完整原生素材目录，在同一轮匹配网页上传的视频、音频。
- 新增 50 / 150 处引用的混合批次回归及重复点击检查；不存在每轮 30 / 50 处匹配数量上限。
- 发布 Markdown 使用说明、真实截图和两图、多素材、含空格文件名测试文件；发布包不包含旧 HTML 指南。

## 0.3.15 - 2026-09-11

- 普通页和画布控制条缩至约 252 × 34px，使用柔白胶囊按钮、小图标和轻量状态文字。
- 新增按钮按压与回弹、提示卡弹入及淡出、确认弹窗弹入；覆盖系统减少动态效果。
- 操作提示卡最大宽度从 500px 缩至 340px，删除重复通用标题，精简无引用提示。
- 悬停说明延迟 420ms 显示，键盘焦点即时显示；提示卡存在时隐藏悬停说明，长内容受视口剩余高度约束。
- 关闭中的提示收到新消息时取消旧移除计时；鼠标或键盘停留期间持续保留提示。
- 两阶段手动操作、匹配原文保护与上传行为沿用原有实现。

## 0.3.14 - 2026-09-11

- 修复普通页手动输入 @ 查询时原生候选替换源文字的问题，扩展拥有的临时查询只在完整文档投影一致时清理。
- 普通页连续引用允许内容完全相同的不可变文档副本；仍拦截真实文字、旧标签属性、名称或光标变化。
- 统一普通页与画布两步按钮、文字状态、悬停/焦点提示、可关闭提示卡、首次说明和确认弹窗样式；增加上传动效与减少动态效果支持。
- 控制条隐藏时同时隐藏其提示层，避免匹配期间覆盖原生菜单。
- 新增离线交互使用指南与文字指南，含命名规则、两种页面流程、可复制提示词、草稿拼装器和补传排错。
- Chrome / Seedance 2.5 回归通过普通页单处、三处同名引用与重复点击，以及画布 14 图匹配、刷新后核对、删除一张后的单张补传。未提交生成任务。
- 新增普通页临时查询、完整文档副本、并发文字/标签属性变化和安全清理回归测试。

## 0.3.13（2026-09-10 本地验证）

- 新版画布视频节点提供与普通版一致的“自动上传 → 自动匹配”两步流程，文件夹索引、精确交集、冲突检查与增量去重共用原有逻辑。
- 新增当前节点原生上传桥；仅交接本批文件，拒绝全局上传、已有参考替换入口、隐藏或歧义目标，成功/失败/超时/用户打断时恢复接口。
- 画布逐项等待新增图片就绪，不套用普通页聚合卡片的暂时接收判断；上传中改字或切换编辑器会停止观察并保留已分派批次的去重保护。
- 画布上传记录按页面及节点隔离，支持编辑器重新挂载；协同同步的相同富文档副本不再造成光标验证误失败。
- 增加常见图片解码预检，损坏文件在整批上传前拒绝；HEIC/HEIF 交由网页判断。
- 增加已实测画布 Seedance 2.0 / 全能参考的 12 个总素材容量预检，计入手动添加的参考；其他模型仍由原生网页判断。
- 增加上传桥、容量、损坏图片、跨节点记录、文档同步及中断回归测试。未在 Dreamina 账号或所有模型组合中实测。

## 0.3.12（2026-09-10 本地验证）

- 新画布保持原生 @ 读取、完整名称匹配、原文字后追加标签的流程。
- 原生按钮复用已有查询时，用经过文档与选区校验的单字符触发器保护源文字；清理后再关闭菜单，避免查询重开阻塞下一项。
- 识别截断显示的视频标签的完整名称，避免漏计或重复插入。
- 保留 ProseMirror 段落与硬换行对应的文字偏移，修复多行漏匹配。
- 排除素材添加按钮的计数，并用当前节点图片/视频槽位变化更新目录与成功状态。
- 识别空素材菜单并清理失败触发器，切换节点后不沿用旧节点绿色状态。
- 拦截重复 @、空引用、@ 后空格、全角 @ 和误加常见扩展名；不把邮箱当引用，收紧编号和跨行名称边界。
- 真实网页验证了普通视频页上传/匹配/重复点击，以及新画布图片视频混合、多行、50% 缩放、空目录和节点切换。未提交生成任务，未在 Dreamina 账号实测。
- 画布文件夹自动上传仍不显示；素材通过网页原生入口添加。

## 0.3.11 - 2026-09-09

- Adapted the ordinary video page's native file-picker upload entry.
- Synchronized Tiptap EditorState selection with each exact source token before opening the picker; verify it again before clicking a candidate.
- Stopped further insertion when existing off-slot or duplicate chips are found, without deleting user text or old chips.
- Kept previously verified names in incremental matching and recognized changed aggregate-card previews without requiring a count increase.
- Added the verified Seedance 2.5 omni-reference 30-image preflight and immediate native capacity-rejection handling.
- Added regression coverage for selection safety, incremental batches, capacity retries, and stale warning cleanup.

## 0.3.9 - 2026-08-29

- Restored the original extension name and concise browser-manager description.
- Made the first-use guide one-time only and removed the permanent “说明” toolbar button.
- Kept project affiliation, usage-scope, and feedback details in repository documentation.

## 0.3.8 - 2026-08-29

- Clarified that the extension is an unofficial helper for reference matching and exact automatic upload.
- Added a prominent first-use disclaimer covering Jimeng, Jianying, Dreamina, CapCut, and ByteDance.
- Added the public feedback address `cs_svip@163.com` and a standalone disclaimer document.

## 0.3.7 - 2026-08-29

- Added a first-use Chinese guide and a permanent “说明” control.
- Added a one-click “忘记已选文件夹” action.
- Moved directory capabilities to page-session memory and delete the legacy site-origin IndexedDB database.
- Added safe recovery for partially rejected upload batches: verify successes first, then retry only missing files.
- Broadened upload observation to the verified composer while disabling expensive whole-page mutation watching.
- Trapped keyboard focus inside the first-use guide and closed its asynchronous popup races.
- Removed root folder names and conflicting relative paths from injected page messages.
- Installed upload observation before dispatching file events.
- Added fast provisional acceptance for an already-idle aggregate upload card.
- Reduced progress polling and stopped reading whole-page `innerText` during upload checks.
- Blocked a repeated upload before directory permission, scanning, file reads, or dispatch.
- Added open-source privacy, security, contribution, license, architecture, and CI files.

## 0.3.6

- Separated automatic upload and automatic matching into two explicit manual phases.
- Preserved source `@name` text and appended native mention tags.
- Added exact pending-name reconciliation and virtual-list catalogue handling.
