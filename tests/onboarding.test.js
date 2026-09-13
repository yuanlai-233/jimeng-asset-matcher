const assert = require("assert").strict;

let stored = {};
const calls = [];
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        calls.push(["get", key]);
        if (Array.isArray(key)) {
          return Object.fromEntries(key.map((name) => [name, stored[name]]));
        }
        return { [key]: stored[key] };
      },
      async set(value) {
        calls.push(["set", value]);
        stored = { ...stored, ...value };
      },
      async remove(key) {
        calls.push(["remove", key]);
        delete stored[key];
      }
    }
  }
};
globalThis.JimengAssetPlugin = {};
require("../onboarding.js");

const onboarding = globalThis.JimengAssetPlugin.onboarding;

(async () => {
  assert.equal(await onboarding.hasSeen(), false);
  stored.jimengOnboardingSeenV2 = true;
  assert.equal(
    await onboarding.hasSeen(),
    true,
    "a user who already saw the short-lived v0.3.8 guide must not see it again"
  );
  stored = {};
  await onboarding.markSeen();
  assert.equal(await onboarding.hasSeen(), true);
  assert.deepEqual(calls[0], [
    "get",
    [onboarding.STORAGE_KEY, "jimengOnboardingSeenV2"]
  ]);
  assert.equal(stored.jimengOnboardingSeenV1, true);
  assert.equal(stored.jimengOnboardingSeenV2, undefined);
  assert.equal(onboarding.steps.length, 5);
  assert.equal(onboarding.disclaimer, undefined);
  const copy = onboarding.steps
    .map((step) => `${step.title}${step.text}`)
    .join("\n");
  assert.match(copy, /显式 @完整素材名/u);
  assert.match(copy, /空格/u);
  assert.match(copy, /先点“自动上传”/u);
  assert.match(copy, /再点“自动匹配”/u);
  assert.match(copy, /不.*重复/u);
  assert.match(copy, /即梦\/Dreamina 页面上传/u);
  const privateMarkers = [
    "/" + "Users/",
    "chang" + "shi",
    "Temporary" + "Items"
  ];
  assert.equal(privateMarkers.some((marker) => copy.includes(marker)), false);
  console.log("✓ onboarding is operational, one-time, and migration-safe");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
