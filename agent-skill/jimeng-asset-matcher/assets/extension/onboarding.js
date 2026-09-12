(function createOnboarding(scope) {
  "use strict";

  const plugin = (scope.JimengAssetPlugin ||= {});
  const STORAGE_KEY = "jimengOnboardingSeenV1";
  const LEGACY_STORAGE_KEY = "jimengOnboardingSeenV2";
  const steps = Object.freeze([
    Object.freeze({
      title: "1. 写完整素材名",
      text: "只识别显式 @完整素材名，不写 .png 等扩展名。建议用中文、字母、数字和下划线命名，避免空格；上传后以网页显示的名称为准。"
    }),
    Object.freeze({
      title: "2. 先点“自动上传”",
      text: "选择素材文件夹，包含子文件夹也可以。只上传提示词精确引用的图片、视频和音频；同一素材引用多次只传一份。"
    }),
    Object.freeze({
      title: "3. 再点“自动匹配”",
      text: "上传完成后，再点击这个按钮。原来的 @素材名 保留，每个引用位置后会出现一个原生素材标签。"
    }),
    Object.freeze({
      title: "4. 不要重复点击上传",
      text: "等待素材就绪后再匹配。刷新页面或手动删除附件后，先点“自动匹配”核对，再上传缺少的素材。"
    }),
    Object.freeze({
      title: "5. 本地权限与隐私",
      text: "目录只在当前页面会话中保留。插件没有统计或自建服务器；命中的素材会交给当前即梦/Dreamina 页面上传。"
    })
  ]);

  function storageArea(options = {}) {
    return options.storage || scope.chrome?.storage?.local || null;
  }

  async function hasSeen(options = {}) {
    const storage = storageArea(options);
    if (!storage?.get) throw new Error("extension storage is unavailable");
    const value = await storage.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    return value?.[STORAGE_KEY] === true || value?.[LEGACY_STORAGE_KEY] === true;
  }

  async function markSeen(options = {}) {
    const storage = storageArea(options);
    if (!storage?.set) throw new Error("extension storage is unavailable");
    await storage.set({ [STORAGE_KEY]: true });
    await storage.remove?.(LEGACY_STORAGE_KEY);
  }

  plugin.onboarding = Object.freeze({
    STORAGE_KEY,
    hasSeen,
    markSeen,
    steps
  });
})(globalThis);
