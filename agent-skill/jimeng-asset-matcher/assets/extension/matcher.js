(function exposeMatcher(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JimengAssetMatcher = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createMatcher() {
  // U+0000 is the same-length mask used for native mention text in
  // editor.plainText(). Treat it as a hard reference boundary so a preserved
  // @name followed by its native mention never parses as one corrupted name.
  const INVALID_NAME = /[\u0000@\n\r，。！？；、,.!?;：:[\]{}<>]/;

  // Normalize only comparison noise; keep meaningful spaces and parentheses.
  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAssetName(value) {
    let name = normalizeText(value)
      .replace(/^\d{2}:\d{2}\s+/, "")
      .replace(/^@+/, "")
      .trim()
      .normalize("NFC");

    if (!name || name.length > 80 || INVALID_NAME.test(name)) {
      return "";
    }
    return name;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Editors commonly expose a visible space as a normal space, NBSP or a
  // longer whitespace run. Match those forms equivalently while returning
  // offsets and token text from the untouched prompt for DOM Range lookup.
  function flexibleWhitespacePattern(value) {
    return Array.from(String(value || ""), (character) =>
      /\s|\u00a0/u.test(character)
        ? "[^\\S\\r\\n\\u2028\\u2029]+"
        : escapeRegExp(character)
    ).join("");
  }

  function explicitAtStart(text, position) {
    // Mail addresses and ASCII identifiers do not start asset references.
    return position === 0 || !/[@A-Za-z0-9_.%+\-]/u.test(text[position - 1]);
  }

  function promptReferenceErrors(prompt) {
    const text = String(prompt || "");
    const errors = new Set();
    for (const match of text.matchAll(/[@＠]/gu)) {
      const position = match.index;
      if (!explicitAtStart(text, position)) continue;
      const next = text[position + 1] || "";
      if (match[0] === "＠") errors.add("请将全角 ＠ 改为半角 @，并紧接完整素材名。");
      else if (next === "@") errors.add("引用前只能写一个 @；请删除重复的 @。");
      else if (!next || /[\s，。！？；、,.!?;：:]/u.test(next)) {
        errors.add("@ 后不能留空或插入空格；请紧接素材菜单中的完整名称。");
      } else if (/^@[^@\n\r，。！？；、,!?;：:]*?\.(?:png|jpe?g|webp|gif|bmp|mp4|mov|webm|m4v|wav|mp3|aac)(?=$|[\s，。！？；、,.!?;：:])/iu.test(text.slice(position))) {
        errors.add("引用中含文件扩展名；请使用原生 @ 菜单显示的素材名，不要自行添加扩展名。");
      }
    }
    return Array.from(errors);
  }

  // Generic parsing finds explicit @ references before the asset menu is
  // available. Candidate-aware matching below determines the exact boundary.
  function parsePromptReferences(prompt) {
    const text = String(prompt || "");
    const references = [];
    const seen = new Set();
    const pattern = /@([^\u0000@\s，。！？；、,.!?;：:[\]{}<>]{1,80})/gu;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const name = normalizeAssetName(match[1]);
      if (!name || seen.has(name) || !explicitAtStart(text, match.index)) {
        continue;
      }
      seen.add(name);
      references.push({
        name,
        token: `@${name}`,
        start: match.index,
        end: match.index + match[0].length
      });
    }
    return references;
  }

  // Generic parsing may over-capture CJK prose or under-capture names with
  // spaces. A candidate match belongs to it when both point at the same @ in
  // the same prompt snapshot; candidate-aware matching owns the exact end.
  function matchBelongsToReference(reference, match) {
    return Boolean(reference && match && reference.start === match.start);
  }

  function matchPromptToCandidates(prompt, candidateNames) {
    const text = String(prompt || "");
    const uniqueCandidates = [];
    const seen = new Set();

    for (const value of candidateNames || []) {
      const name = normalizeAssetName(value);
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      uniqueCandidates.push(name);
    }

    const matches = [];
    const occupied = [];
    const overlaps = (start, end) => occupied.some(
      (range) => start < range.end && end > range.start
    );

    function collect(name, token) {
      const pattern = new RegExp(flexibleWhitespacePattern(token), "gu");
      let found;
      while ((found = pattern.exec(text)) !== null) {
        const exactToken = found[0];
        const position = found.index;
        const end = position + exactToken.length;
        const next = end < text.length ? text[end] : "";
        const asciiOnlyName = /[A-Za-z0-9_-]$/.test(name);
        const invalidAsciiBoundary = asciiOnlyName && (
          /[A-Za-z0-9_-]/.test(next)
        );
        if (!overlaps(position, end) && !invalidAsciiBoundary &&
          explicitAtStart(text, position) && !/^\.[A-Za-z0-9]/u.test(text.slice(end))) {
          occupied.push({ start: position, end });
          matches.push({
            name,
            token: exactToken,
            prefixed: true,
            start: position,
            end
          });
        }
      }
    }

    // Longest names win, so 水杯架 cannot be consumed as 水杯. Product
    // matching intentionally accepts explicit @ references only.
    const sorted = uniqueCandidates.sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      collect(name, `@${name}`);
    }

    matches.sort((a, b) => a.start - b.start || b.name.length - a.name.length);
    return matches;
  }

  // Session cleanup uses conservative token boundaries. Candidate matching
  // may intentionally accept CJK prose after a known upload name, but that
  // looser rule must never keep a shorter target from an older task alive.
  function promptHasExactTarget(prompt, value) {
    const text = normalizeText(prompt);
    const name = normalizeAssetName(value);
    if (!text || !name) return false;
    const isBoundary = (character) =>
      !character || /\s/u.test(character) || INVALID_NAME.test(character);

    function contains(token, prefixed) {
      let from = 0;
      let position;
      while ((position = text.indexOf(token, from)) !== -1) {
        const end = position + token.length;
        const previous = position > 0 ? text[position - 1] : "";
        const next = end < text.length ? text[end] : "";
        if ((prefixed || isBoundary(previous)) && isBoundary(next)) return true;
        from = end;
      }
      return false;
    }

    return contains(`@${name}`, true);
  }

  // Identify one explicit reference occurrence inside a single prompt
  // snapshot. JSON encoding avoids delimiter collisions in valid asset names.
  function matchSlotKey(match) {
    const name = normalizeAssetName(match?.name);
    const start = Number(match?.start);
    const end = Number(match?.end);
    if (!name || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end < start) {
      return "";
    }
    return JSON.stringify([name, start, end]);
  }

  // Plain @ references remain in the prompt and each occurrence owns one
  // native-mention slot. An optional paired-slot Set is authoritative and can
  // skip an exact occurrence; callers without it retain the count-based prompt
  // order fallback. Source references are intentionally never deletion tasks.
  function planMatchesToMentionTargets(
    matches,
    currentCounts,
    targetCounts,
    pairedSlots
  ) {
    const nextTargetCounts = new Map(targetCounts || []);
    const hasExactPairs = pairedSlots instanceof Set;
    const groups = new Map();
    for (const match of matches || []) {
      if (!groups.has(match.name)) groups.set(match.name, []);
      groups.get(match.name).push(match);
    }

    const selected = [];
    for (const [name, group] of groups) {
      group.sort((a, b) => a.start - b.start || a.end - b.end);
      const current = currentCounts.get(name) || 0;
      nextTargetCounts.set(name, group.length);
      if (hasExactPairs) {
        selected.push(...group.filter((match) =>
          !pairedSlots.has(matchSlotKey(match))
        ));
      } else {
        const paired = Math.min(Math.max(current, 0), group.length);
        selected.push(...group.slice(paired));
      }
    }
    return { matches: selected, targetCounts: nextTargetCounts };
  }

  // Keep an unfinished target only while the current editor still contains
  // either its native mention or its exact plain-text reference. This is the
  // final guard against state leaking from a previously submitted prompt.
  function pruneInactiveMentionTargets(expectedCounts, currentCounts, matches) {
    const plainNames = new Set((matches || []).map((match) => match.name));
    return new Map(Array.from(expectedCounts || []).filter(([name]) =>
      (currentCounts.get(name) || 0) > 0 || plainNames.has(name)
    ));
  }

  // Validate absolute native-mention targets independently from transient
  // menu rendering. A partial candidate menu must not turn a satisfied target
  // yellow; a changed upload baseline still keeps a missing asset visible.
  function mentionTargetFailures(
    expectedCounts,
    currentCounts,
    knownCandidates,
    { materialsChanged = false } = {}
  ) {
    const failures = new Map();
    for (const [name, expectedCount] of expectedCounts || []) {
      if (!expectedCount) continue;
      const currentCount = currentCounts.get(name) || 0;
      const candidateAvailable = knownCandidates.has(name);
      if (currentCount >= expectedCount) {
        if (materialsChanged && !candidateAvailable) {
          failures.set(name, "上传素材已变化，当前素材菜单中没有这个素材");
        }
        continue;
      }
      failures.set(
        name,
        candidateAvailable
          ? `原生素材引用缺少 ${expectedCount - currentCount} 处`
          : "当前素材菜单中没有这个素材"
      );
    }
    return failures;
  }

  // Uploaded candidates that appear neither as an explicit @ reference nor as
  // an existing native mention are likely accidental extras. Bare same-name
  // prose is intentionally ignored by the product flow.
  function unexpectedCandidateNames(prompt, candidateNames, currentCounts = new Map()) {
    const names = [];
    const seen = new Set();
    for (const value of candidateNames || []) {
      const name = normalizeAssetName(value);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    const referenced = new Set(
      matchPromptToCandidates(prompt, names).map((match) => match.name)
    );
    for (const [name, count] of currentCounts || []) {
      if (count > 0) referenced.add(normalizeAssetName(name));
    }
    return names.filter((name) => !referenced.has(name));
  }

  // A trusted edit starts a new prompt revision only when it replaces most of
  // the current text. Small corrections must keep partial-match targets.
  function selectionReplacesPrompt(prompt, selectedText, threshold = 0.75) {
    const promptLength = normalizeText(prompt).length;
    if (!promptLength) return true;
    return normalizeText(selectedText).length >= promptLength * threshold;
  }

  return {
    matchPromptToCandidates,
    matchBelongsToReference,
    matchSlotKey,
    mentionTargetFailures,
    planMatchesToMentionTargets,
    promptHasExactTarget,
    pruneInactiveMentionTargets,
    normalizeAssetName,
    normalizeText,
    parsePromptReferences,
    promptReferenceErrors,
    selectionReplacesPrompt,
    unexpectedCandidateNames
  };
});
