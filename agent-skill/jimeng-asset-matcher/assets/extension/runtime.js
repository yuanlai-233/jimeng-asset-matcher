(function createRuntime(scope) {
  "use strict";

  // A single namespace keeps the manifest-v3 content scripts small and avoids
  // leaking implementation details into Dreamina's page globals.
  const plugin = (scope.JimengAssetPlugin ||= {});
  plugin.version = scope.chrome?.runtime?.getManifest?.().version || "development";

  plugin.constants = Object.freeze({
    buttonId: "jimeng-asset-match-button",
    confirmId: "jimeng-send-confirm",
    controlsId: "jimeng-match-controls",
    extraConfirmId: "jimeng-extra-material-confirm",
    helpButtonId: "jimeng-help-button",
    highlightName: "jimeng-unmatched-reference",
    localUploadButtonId: "jimeng-local-upload-button",
    onboardingId: "jimeng-first-use-guide",
    overlayId: "jimeng-unmatched-overlay",
    statusId: "jimeng-match-status-indicator",
    toastId: "jimeng-asset-match-toast"
  });

  plugin.state = {
    // Shared interaction and highlight lifecycle flags.
    applyingHighlights: false,
    acknowledgedUnexpectedSignature: "",
    assetGuardInstalled: false,
    bypassSendConfirmation: false,
    highlightActive: false,
    highlightCount: 0,
    highlightTimer: null,
    installTimer: null,
    localAssetIndex: null,
    localAssetIndexHandle: null,
    localDirectoryHandle: null,
    // An upload attempt can finish before its native @ rows are available.
    // Automatic upload stays locked; a later explicit “自动匹配” action checks
    // those exact local names one by one without resubmitting the files.
    localUploadNeedsReconcile: false,
    localUploadPendingNames: [],
    localUploadPendingByEditor: new WeakMap(),
    // A page-level rejection can be partial. After an explicit matching pass
    // verifies the successful names, only the still-missing names may retry.
    localUploadRejectedByEditor: new WeakSet(),
    localUploadReconcileEditor: null,
    // Names enter this task-local ledger only after an exact native candidate
    // produced a real mention. It prevents a second automatic-upload click
    // from resubmitting the same files without adding any pre-upload
    // dependency on the web @ picker.
    localUploadVerifiedNamesByEditor: new WeakMap(),
    localUploading: false,
    onboardingAutoHandled: false,
    onboardingCheckStarted: false,

    // Match-status cache. Dirty flags prevent scroll events from re-parsing
    // the whole prompt or rescanning all thumbnails.
    materialCheckPending: false,
    candidateCatalogComplete: false,
    candidateCatalogEditor: null,
    candidateMaterialSignature: null,
    candidateNamesSnapshot: [],
    expectedMentionCounts: new Map(),
    matchStatusVerified: false,
    matchStatusEditor: null,
    matching: false,
    statusContentDirty: true,
    statusFailureDetails: new Map(),
    statusRemainingCount: 0,
    statusRemainingNames: [],
    statusTimer: null,
    toastTimer: null,
    unexpectedMaterialNames: [],
    verifiedEditorSignature: null,
    verifiedMaterialSignature: null
  };

  // Only interact with elements that are actually available to the user.
  plugin.isVisible = function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    // New Jimeng keeps inactive generators mounted with identical geometry.
    if (typeof element.checkVisibility === "function" &&
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      rect.width > 1 &&
      rect.height > 1 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  };

  plugin.sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  // Poll a short-lived Dreamina UI transition without using long fixed waits.
  plugin.waitFor = async function waitFor(check, timeout = 2400, interval = 80) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = check();
      if (value) return value;
      await plugin.sleep(interval);
    }
    return null;
  };
})(globalThis);
