(function exposeLocalDirectory(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JimengLocalDirectory = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createLocalDirectory(scope) {
  "use strict";

  // v0.3.6 and earlier stored FileSystemDirectoryHandle in IndexedDB from a
  // content script. That database belongs to the host website's origin, so a
  // page script could theoretically access the retained capability. v0.3.7
  // intentionally keeps the handle in memory for this page session only and
  // deletes the legacy site-origin database during startup.
  const DB_NAME = "jimeng-asset-matcher";

  function createError(message, code, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function assertDirectoryHandle(handle) {
    if (!handle || handle.kind !== "directory") {
      throw new TypeError("handle must be a FileSystemDirectoryHandle");
    }
  }

  function createMemoryHandleStore(initialHandle = null) {
    let value = initialHandle;
    return {
      async clear() {
        value = null;
      },
      async get() {
        return value;
      },
      async set(handle) {
        assertDirectoryHandle(handle);
        value = handle;
      }
    };
  }

  const sessionStore = createMemoryHandleStore();

  async function clearLegacyDirectoryStorage(
    indexedDbFactory = scope.indexedDB
  ) {
    if (!indexedDbFactory?.deleteDatabase) return true;
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDbFactory.deleteDatabase(DB_NAME);
      } catch (cause) {
        reject(createError(
          "无法清除旧版保存的文件夹授权。",
          "LEGACY_DIRECTORY_CLEAR_FAILED",
          cause
        ));
        return;
      }
      request.onsuccess = () => resolve(true);
      request.onblocked = () => resolve(false);
      request.onerror = () => reject(createError(
        "无法清除旧版保存的文件夹授权。",
        "LEGACY_DIRECTORY_CLEAR_FAILED",
        request.error
      ));
    });
  }

  function resolveStore(options) {
    return options.store || sessionStore;
  }

  async function queryReadPermission(handle) {
    assertDirectoryHandle(handle);
    if (typeof handle.queryPermission !== "function") return "granted";
    return handle.queryPermission({ mode: "read" });
  }

  async function requestReadPermission(handle) {
    assertDirectoryHandle(handle);
    const current = await queryReadPermission(handle);
    if (current === "granted") return current;
    if (typeof handle.requestPermission !== "function") return current;

    try {
      return await handle.requestPermission({ mode: "read" });
    } catch (cause) {
      throw createError(
        "无法恢复素材文件夹权限，请点击插件按钮后重新选择文件夹。",
        "DIRECTORY_PERMISSION_REQUEST_FAILED",
        cause
      );
    }
  }

  async function saveDirectoryHandle(handle, options = {}) {
    assertDirectoryHandle(handle);
    await resolveStore(options).set(handle);
    return handle;
  }

  async function clearDirectoryHandle(options = {}) {
    await resolveStore(options).clear();
    let legacyCleared = true;
    if (options.clearLegacy !== false) {
      legacyCleared = await clearLegacyDirectoryStorage(
        options.indexedDB || scope.indexedDB
      );
    }
    return { legacyCleared, sessionCleared: true };
  }

  async function restoreDirectory(options = {}) {
    const store = resolveStore(options);
    const handle = await store.get();
    if (!handle || handle.kind !== "directory") {
      return {
        handle: null,
        permission: "missing",
        source: "none",
        usable: false
      };
    }

    const permission = options.requestPermission === true
      ? await requestReadPermission(handle)
      : await queryReadPermission(handle);
    return {
      handle,
      permission,
      source: "restored",
      usable: permission === "granted"
    };
  }

  // Call from a real click/keyboard handler. When force is false, an existing
  // handle is reused after permission recovery; otherwise the picker opens so
  // the user can replace the selected folder.
  async function chooseDirectory(options = {}) {
    if (options.force !== true) {
      const restored = await restoreDirectory({
        ...options,
        requestPermission: true
      });
      if (restored.usable) return restored;
    }

    const picker = options.showDirectoryPicker || scope.showDirectoryPicker;
    if (typeof picker !== "function") {
      throw createError(
        "当前浏览器不支持选择本地文件夹，请使用最新版 Chrome 或 Edge。",
        "DIRECTORY_PICKER_UNAVAILABLE"
      );
    }

    const handle = await picker({
      id: "jimeng-local-assets",
      mode: "read",
      ...(options.pickerOptions || {})
    });
    assertDirectoryHandle(handle);
    const permission = await requestReadPermission(handle);
    if (permission !== "granted") {
      throw createError(
        "未获得素材文件夹读取权限，请重新选择并允许读取。",
        "DIRECTORY_PERMISSION_DENIED"
      );
    }

    await saveDirectoryHandle(handle, options);
    return {
      handle,
      permission,
      source: "picked",
      usable: true
    };
  }

  return {
    clearLegacyDirectoryStorage,
    clearDirectoryHandle,
    chooseDirectory,
    createMemoryHandleStore,
    queryReadPermission,
    requestReadPermission,
    restoreDirectory,
    saveDirectoryHandle
  };
});
