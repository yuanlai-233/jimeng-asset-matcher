const assert = require("assert").strict;

const {
  chooseDirectory,
  clearDirectoryHandle,
  clearLegacyDirectoryStorage,
  createMemoryHandleStore,
  queryReadPermission,
  requestReadPermission,
  restoreDirectory
} = require("../local-directory.js");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function memoryStore(initialValue = null) {
  let value = initialValue;
  return {
    async clear() {
      value = null;
    },
    async get() {
      return value;
    },
    async set(nextValue) {
      value = nextValue;
    }
  };
}

function directoryHandle(name, permission = "granted") {
  let state = permission;
  const calls = { query: 0, request: 0 };
  return {
    calls,
    kind: "directory",
    name,
    async queryPermission(options) {
      assert.deepEqual(options, { mode: "read" });
      calls.query += 1;
      return state;
    },
    async requestPermission(options) {
      assert.deepEqual(options, { mode: "read" });
      calls.request += 1;
      state = "granted";
      return state;
    }
  };
}

test("restores a saved directory without prompting outside a user gesture", async () => {
  const handle = directoryHandle("素材库", "prompt");
  const result = await restoreDirectory({ store: memoryStore(handle) });

  assert.equal(result.handle, handle);
  assert.equal(result.permission, "prompt");
  assert.equal(result.usable, false);
  assert.equal(handle.calls.query, 1);
  assert.equal(handle.calls.request, 0);
});

test("recovers cached permission when chooseDirectory runs from a click", async () => {
  const handle = directoryHandle("素材库", "prompt");
  let pickerCalls = 0;
  const result = await chooseDirectory({
    showDirectoryPicker: async () => {
      pickerCalls += 1;
      return directoryHandle("不应打开");
    },
    store: memoryStore(handle)
  });

  assert.equal(result.handle, handle);
  assert.equal(result.source, "restored");
  assert.equal(result.usable, true);
  assert.equal(handle.calls.request, 1);
  assert.equal(pickerCalls, 0);
});

test("force opens the picker and replaces the cached directory", async () => {
  const oldHandle = directoryHandle("旧素材库");
  const nextHandle = directoryHandle("新素材库");
  const store = memoryStore(oldHandle);
  let pickerOptions = null;
  const result = await chooseDirectory({
    force: true,
    pickerOptions: { startIn: "pictures" },
    showDirectoryPicker: async (options) => {
      pickerOptions = options;
      return nextHandle;
    },
    store
  });

  assert.equal(result.handle, nextHandle);
  assert.equal(result.source, "picked");
  assert.deepEqual(pickerOptions, {
    id: "jimeng-local-assets",
    mode: "read",
    startIn: "pictures"
  });
  assert.equal((await store.get()), nextHandle);
});

test("returns clear missing state when no directory has been saved", async () => {
  const result = await restoreDirectory({ store: memoryStore() });
  assert.deepEqual(result, {
    handle: null,
    permission: "missing",
    source: "none",
    usable: false
  });
});

test("reports unsupported directory picker in Chinese", async () => {
  await assert.rejects(
    () => chooseDirectory({ force: true, store: memoryStore() }),
    (error) => (
      error?.code === "DIRECTORY_PICKER_UNAVAILABLE" &&
      error.message.includes("不支持选择本地文件夹")
    )
  );
});

test("permission helpers tolerate picker handles without permission methods", async () => {
  const handle = { kind: "directory", name: "素材库" };
  assert.equal(await queryReadPermission(handle), "granted");
  assert.equal(await requestReadPermission(handle), "granted");
});

test("memory store retains a handle only for the current page session", async () => {
  const store = createMemoryHandleStore();
  const handle = directoryHandle("素材库");

  await store.set(handle);
  assert.equal(await store.get(), handle);
  await store.clear();
  assert.equal(await store.get(), null);
});

test("deletes the legacy site-origin IndexedDB without opening it", async () => {
  let deletedName = null;
  const indexedDB = {
    deleteDatabase(name) {
      deletedName = name;
      const request = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    open() {
      throw new Error("the legacy database must never be reopened");
    }
  };
  assert.equal(await clearLegacyDirectoryStorage(indexedDB), true);
  assert.equal(deletedName, "jimeng-asset-matcher");
});

test("reports a blocked legacy deletion after clearing the session handle", async () => {
  const handle = directoryHandle("素材库");
  const store = memoryStore(handle);
  const indexedDB = {
    deleteDatabase() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    }
  };
  const result = await clearDirectoryHandle({ indexedDB, store });
  assert.equal(await store.get(), null);
  assert.deepEqual(result, { legacyCleared: false, sessionCleared: true });
});

(async () => {
  for (const item of tests) {
    await item.run();
    console.log(`✓ ${item.name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
