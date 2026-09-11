(function exposeLocalWorkflow(root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  const matcher = root?.JimengAssetMatcher || (
    isCommonJs ? require("./matcher.js") : null
  );
  const localAssets = root?.JimengLocalAssets || (
    isCommonJs ? require("./local-assets.js") : null
  );
  const api = factory(matcher, localAssets);
  if (isCommonJs) module.exports = api;
  if (root) root.JimengLocalWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this,
  function createLocalWorkflow(matcher, localAssets) {
    "use strict";

    if (!matcher?.normalizeAssetName || !localAssets?.matchPromptToLocalAssets) {
      throw new Error("Local asset modules must load before local-workflow.js");
    }

    function normalizedNameSet(names) {
      const result = new Set();
      for (const value of names || []) {
        const name = matcher.normalizeAssetName(value);
        if (name) result.add(name);
      }
      return result;
    }

    // Planning is side-effect free. In particular, conflicts are reported
    // before any File is materialized or handed to the web page.
    function planLocalUpload(prompt, index, uploadedNames = []) {
      const localMatches = localAssets.matchPromptToLocalAssets(prompt, index);
      const uploaded = normalizedNameSet(uploadedNames);
      const filesToUpload = [];
      const alreadyUploaded = [];

      for (const record of localMatches.files) {
        if (uploaded.has(record.assetName)) alreadyUploaded.push(record);
        else filesToUpload.push(record);
      }

      return {
        alreadyUploaded,
        conflicts: localMatches.conflicts,
        filesToUpload,
        localMatches,
        missing: localMatches.missing,
        occurrences: localMatches.occurrences
      };
    }

    function assertPromptUnchanged(before, after) {
      if (String(before || "") === String(after || "")) return true;
      const error = new Error(
        "上传期间提示词已发生变化，已停止自动上传，请重新点击。"
      );
      error.code = "PROMPT_CHANGED_DURING_UPLOAD";
      throw error;
    }

    return { assertPromptUnchanged, normalizedNameSet, planLocalUpload };
  });
