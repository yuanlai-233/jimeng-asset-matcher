(function exposeLocalAssets(root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  const matcher = root?.JimengAssetMatcher || (
    isCommonJs ? require("./matcher.js") : null
  );
  const media = root?.JimengMediaFiles || (isCommonJs ? require("./media-files.js") : null);
  const api = factory(matcher, media);

  if (isCommonJs) {
    module.exports = api;
  }
  if (root) {
    root.JimengLocalAssets = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createLocalAssets(matcher, media) {
  "use strict";

  if (!matcher?.matchPromptToCandidates || !matcher?.parsePromptReferences) {
    throw new Error("JimengAssetMatcher must load before local-assets.js");
  }

  const DEFAULT_ASSET_EXTENSIONS = media.extensions;

  function abortError() {
    const error = new Error("Local asset indexing was cancelled");
    error.name = "AbortError";
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }

  function normalizeAssetName(value) {
    const unicodeName = String(value || "").normalize("NFC");
    return matcher.normalizeAssetName(unicodeName).normalize("NFC");
  }

  function normalizeExtensions(extensions) {
    const source = extensions === undefined
      ? DEFAULT_ASSET_EXTENSIONS
      : extensions;
    if (!source || typeof source[Symbol.iterator] !== "function") {
      throw new TypeError("extensions must be an iterable");
    }
    return new Set(Array.from(source, (value) =>
      String(value || "").replace(/^\.+/, "").toLowerCase().trim()
    ).filter(Boolean));
  }

  function describeFilename(filename, extensionSet) {
    const name = String(filename || "");
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) {
      return { ok: false, reason: "unsupported-extension" };
    }

    const extension = name.slice(dot + 1).toLowerCase();
    if (!extensionSet.has(extension)) {
      return { ok: false, reason: "unsupported-extension" };
    }

    const assetName = normalizeAssetName(name.slice(0, dot));
    if (!assetName) {
      return { ok: false, reason: "invalid-asset-name" };
    }

    return { assetName, extension, ok: true };
  }

  function assertDirectoryHandle(handle) {
    if (
      !handle ||
      handle.kind !== "directory" ||
      typeof handle.entries !== "function"
    ) {
      throw new TypeError("rootHandle must be a FileSystemDirectoryHandle");
    }
  }

  function comparePaths(left, right) {
    if (left.relativePath < right.relativePath) return -1;
    if (left.relativePath > right.relativePath) return 1;
    return 0;
  }

  // Build a metadata-only index. getFile() is intentionally deferred until
  // the upload layer knows which prompt references are needed; scanning a
  // large directory therefore does not read every file into memory.
  async function indexDirectory(rootHandle, options = {}) {
    assertDirectoryHandle(rootHandle);
    const extensionSet = normalizeExtensions(options.extensions);
    const includeHidden = options.includeHidden === true;
    const signal = options.signal;
    const records = [];
    const skipped = [];
    let scannedFileCount = 0;

    async function visit(directoryHandle, parentPath) {
      throwIfAborted(signal);
      for await (const [entryNameValue, entryHandle] of directoryHandle.entries()) {
        throwIfAborted(signal);
        const entryName = String(entryNameValue || entryHandle?.name || "");
        const relativePath = parentPath
          ? `${parentPath}/${entryName}`
          : entryName;

        if (!includeHidden && entryName.startsWith(".")) {
          skipped.push({
            kind: entryHandle?.kind || "unknown",
            name: entryName,
            reason: "hidden-entry",
            relativePath
          });
          continue;
        }

        if (entryHandle?.kind === "directory") {
          if (typeof entryHandle.entries !== "function") {
            skipped.push({
              kind: "directory",
              name: entryName,
              reason: "unreadable-directory",
              relativePath
            });
            continue;
          }
          await visit(entryHandle, relativePath);
          continue;
        }

        if (entryHandle?.kind !== "file") {
          skipped.push({
            kind: entryHandle?.kind || "unknown",
            name: entryName,
            reason: "unsupported-entry-kind",
            relativePath
          });
          continue;
        }

        scannedFileCount += 1;
        const description = describeFilename(entryName, extensionSet);
        if (!description.ok) {
          skipped.push({
            kind: "file",
            name: entryName,
            reason: description.reason,
            relativePath
          });
          continue;
        }

        records.push({
          assetName: description.assetName,
          extension: description.extension,
          mediaKind: media.kindOf(entryName),
          fileHandle: entryHandle,
          filename: entryName,
          relativePath
        });
      }
    }

    await visit(rootHandle, "");
    records.sort(comparePaths);
    skipped.sort(comparePaths);

    const byAssetName = new Map();
    for (const record of records) {
      if (!byAssetName.has(record.assetName)) {
        byAssetName.set(record.assetName, []);
      }
      byAssetName.get(record.assetName).push(record);
    }

    return {
      byAssetName,
      indexedFileCount: records.length,
      records,
      rootName: String(rootHandle.name || ""),
      scannedFileCount,
      skipped
    };
  }

  function assertIndex(index) {
    if (!index || !(index.byAssetName instanceof Map)) {
      throw new TypeError("index must be created by indexDirectory()");
    }
  }

  // Resolve only explicit @ references. Repeated prompt references remain in
  // occurrences for diagnostics but select one local file for one upload.
  // Duplicate basenames are conflicts: silently choosing the first folder is
  // unsafe and would bind a prompt to an arbitrary asset.
  function matchPromptToLocalAssets(prompt, index) {
    assertIndex(index);
    const candidateNames = Array.from(index.byAssetName.keys());
    const matches = matcher.matchPromptToCandidates(prompt, candidateNames);
    const occurrences = [];
    const files = [];
    const seenFiles = new Set();
    const conflictsByName = new Map();

    for (const match of matches) {
      const candidates = index.byAssetName.get(match.name) || [];
      if (candidates.length === 1) {
        const record = candidates[0];
        occurrences.push({ ...match, record, status: "matched" });
        if (!seenFiles.has(record.relativePath)) {
          seenFiles.add(record.relativePath);
          files.push(record);
        }
        continue;
      }

      occurrences.push({
        ...match,
        records: [...candidates],
        status: "conflict"
      });
      if (!conflictsByName.has(match.name)) {
        conflictsByName.set(match.name, {
          name: match.name,
          records: [...candidates]
        });
      }
    }

    // Generic parsing is used only to report unknown explicit references.
    // Candidate-aware matches own the exact boundary, so attached CJK action
    // prose after a known asset is not incorrectly reported as another miss.
    const matchedStarts = new Set(matches.map((match) => match.start));
    const missing = matcher.parsePromptReferences(prompt).filter(
      (reference) => !matchedStarts.has(reference.start)
    );

    return {
      conflicts: Array.from(conflictsByName.values()),
      files,
      missing,
      occurrences
    };
  }

  // Resolve only the selected handles to File objects. A small worker pool
  // keeps large batches responsive without opening every file at once.
  async function materializeMatchedFiles(matchResult, options = {}) {
    if (!matchResult || !Array.isArray(matchResult.files)) {
      throw new TypeError("matchResult must be created by matchPromptToLocalAssets()");
    }
    const concurrency = Number(options.concurrency ?? 4);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new TypeError("concurrency must be a positive integer");
    }

    const signal = options.signal;
    const output = new Array(matchResult.files.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        throwIfAborted(signal);
        const position = cursor;
        cursor += 1;
        if (position >= matchResult.files.length) return;

        const record = matchResult.files[position];
        if (typeof record?.fileHandle?.getFile !== "function") {
          const error = new TypeError("本地素材读取失败或文件已被移动。");
          error.code = "LOCAL_FILE_UNREADABLE";
          throw error;
        }
        const selectedFile = await record.fileHandle.getFile();
        throwIfAborted(signal);
        output[position] = { file: selectedFile, record };
      }
    }

    const workerCount = Math.min(concurrency, matchResult.files.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return output;
  }

  return {
    DEFAULT_ASSET_EXTENSIONS,
    describeFilename,
    indexDirectory,
    matchPromptToLocalAssets,
    materializeMatchedFiles,
    normalizeAssetName
  };
});
