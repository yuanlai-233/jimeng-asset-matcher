# Architecture and Safety Boundaries

## Runtime shape

The project is a Manifest V3 content-script extension. It has no popup, background service worker, remote script, analytics endpoint, or runtime dependency. It runs only on the two hosts listed in `manifest.json`.

## Two explicit phases

```text
prompt with explicit @name
        |
        v
automatic upload: local filename index -> exact intersection -> native file input
        |
        v
pending batch (page accepted, not yet verified)
        |
        v
manual automatic match: exact native row -> one click -> adjacent native mention check
        |
        v
task-local verified ledger
```

Automatic upload never opens the native `@` menu or edits the prompt. Automatic matching never reads arbitrary local files or resubmits a pending batch.

## Module responsibilities

- `media-files.js`: shared image/video/audio extension, MIME and native-picker acceptance rules in both execution worlds.
- `bgm.js`: inline sibling of the native @ control, per-editor default-off toggle and debounced prompt synchronization.
- `bgm-bridge.js`: native Tiptap transactions prepend/remove only the owned no-music sentence; transaction mapping follows edits while preserving other rich text and the selection.
- `matcher.js`: Unicode/name normalization and exact prompt-slot planning.
- `runtime.js`: constants and page-session state.
- `theme.js`: follows page theme attributes and the active editor's computed surface color, falling back to the OS only when neither is known. A bounded ancestor observer coalesces attribute changes without rescanning prompt content; namespaced CSS tokens affect extension UI only.
- `onboarding.js`: fixed first-use copy and one non-sensitive storage flag.
- `local-directory.js`: user-gesture folder selection, page-session handle memory, and legacy database deletion.
- `local-assets.js`: recursive metadata index and deferred `getFile()` for exact matches only.
- `local-workflow.js`: side-effect-free upload plan.
- `local-upload.js`: media-type validation, image-only decoding, trusted upload target selection, pre-dispatch observation, canvas per-material completion, and ordinary aggregate-card provisional acceptance.
- `canvas.js`: one visible video-form ownership, node-scoped in-memory upload ledgers, and temporary native query tracking.
- `canvas-upload-bridge.js`: short-lived MAIN-world handoff to the selected video node’s native upload menu; excludes replacement and global inputs.
- `upload-bridge.js`: ordinary native picker handoff and guarded Tiptap selection/temporary-query transactions.
- `native-trigger.js`: opens the current composer's real `@` control, including paged Infinite Canvas toolbars.
- `candidates.js`: active popup isolation, virtual-list traversal, exact row selection, and one-click uncertainty stop.
- `editor.js`: Slate caret placement, adjacent mention verification, and external highlights.
- `ui.js`: controls, first-use guide, status, warnings, and send confirmation.
- `content.js`: workflow orchestration and task-bound duplicate-upload guards.

## Security invariants

- Prompt text never manufactures candidate names; native rows or exact local filenames are the authoritative sources.
- Only explicit `@complete name` references participate. Bare prose is ignored.
- Matching preserves source text and appends a native mention after it.
- A slot receives at most one native candidate click per run. Uncertain results stop the run.
- A dispatched batch becomes pending immediately and cannot be automatically re-uploaded in the same task. If the page explicitly rejects a possibly partial batch, one manual matching pass records confirmed names and unlocks only the missing names for selective retry.
- Page acceptance is not the same as native-name verification.
- File handles never persist in the host website's storage.
- Injected diagnostics do not include a root folder name or relative local path.

## Release contents

The public source repository includes tests, documentation, screenshots and tutorial assets. A browser-installable release archive contains only `manifest.json`, every JavaScript/CSS file declared by its content scripts, the four declared icons, and `LICENSE`. All product features and UI remain included, including the first-use guide implemented in JavaScript. Markdown/HTML documentation, screenshots, example assets, tests, build scripts, internal handoff notes and old archives are excluded. Create CRX packages from the clean release directory rather than from the source repository.

## Modern editor synchronization

Ordinary and canvas editor rendering can replace a Tiptap document with a structurally equal copy. Selection validation and owned-trigger cleanup accept full rich-document equality in this case, while still requiring the pinned exact position/token and restoration of the complete pre-trigger document. Real text/attribute/mention changes remain rejected; native menu rows are the only producers of mention nodes.

Canvas upload confirmation uses the increase in ready image, video and audio slots. Existing previews or an incomplete subset cannot confirm the batch. Capacity preflight includes all material slots for the specifically verified canvas model/mode. Page refresh drops the in-memory ledger; it is not persistent upload history.

The ordinary page may retain an owned temporary query after appending its native `reference-mention-tag` atom. Cleanup is permitted only if removing exactly that owned character and the adjacent observed native atom reproduces the entire pre-trigger rich document; the actual transaction then removes only the character. Changes to other text, older chip attributes, unrelated atom types, or consumed triggers are rejected. Both editors continue to use native candidate clicks to construct mention nodes.

A queued controlled-value update on the ordinary page can briefly restore the preceding owned `@` after cleanup. Before positioning the next reference, the matcher waits up to 720 ms only if its full text snapshot differs, proceeding as soon as the exact snapshot returns. Persistent changes still prevent the native click. Already-proved toolbar scopes are reused while their live buttons are re-resolved. Pending local names are used directly only when they cover every prompt reference; mixed batches acquire the complete catalogue and reconcile their pending media ledger in the same run. Matching iterates every planned occurrence without a 30/50-slot cap.

Seedance 2.5 omni-reference preflight counts image, video and audio independently (30/10/10, 50 total). Every file must be accepted by the native picker; an image-only entry cannot receive a mixed batch. Video/audio are excluded from bitmap decoding. All three kinds share exact-name verification and retry bookkeeping.

Dreamina Seedance 2.0 omni-reference has separate per-type limits (9/3/3) and a 12-item total. Model and mode are read from the active form's combobox controls, never from prompt text. Unknown combinations defer to the native page. Capacity checks do not limit the number of reference occurrences matched.
