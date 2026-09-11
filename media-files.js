(function exposeMediaFiles(root) {
  "use strict";
  // Shared by the directory index, isolated uploader and native upload bridges.
  const types = Object.freeze({
    avif: "image/avif", bmp: "image/bmp", gif: "image/gif", heic: "image/heic",
    heif: "image/heif", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
    wav: "audio/wav", mp3: "audio/mpeg", aac: "audio/aac", m4a: "audio/mp4"
  });
  const aliases = Object.freeze({
    "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav",
    "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/x-aac": "audio/aac",
    "image/jpg": "image/jpeg", "image/x-ms-bmp": "image/bmp"
  });
  const extensionOf = (value) => String(value || "").toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
  function kindOf(file) {
    const expected = types[extensionOf(typeof file === "string" ? file : file?.name)];
    if (!expected) return null;
    const type = String(file?.type || "").trim().toLowerCase();
    if (type && type !== "application/octet-stream" &&
      (aliases[type] || type) !== expected &&
      !(expected === "video/x-m4v" && type === "video/mp4")) return null;
    return expected.split("/")[0];
  }
  function tokenAcceptsFile(token, file) {
    const kind = kindOf(file);
    if (!kind) return false;
    const value = String(token || "").trim().toLowerCase();
    if (value === "*/*" || value === `${kind}/*`) return true;
    if (value.startsWith(".")) return extensionOf(file.name) === value.slice(1);
    const type = String(file.type || "").toLowerCase();
    return (aliases[value] || value) === (aliases[type] || type) ||
      (aliases[value] || value) === types[extensionOf(file.name)];
  }
  function acceptsFiles(tokens, files) {
    return files.every((file) => kindOf(file) &&
      (!tokens.length || tokens.some((token) => tokenAcceptsFile(token, file))));
  }
  function pickerAcceptsFiles(options, files) {
    const tokens = (options?.types || []).flatMap((type) =>
      Object.entries(type.accept || {}).flatMap(([mime, extensions]) => [mime, ...(extensions || [])]));
    return (files.length < 2 || options?.multiple === true) && acceptsFiles(tokens, files);
  }
  const api = Object.freeze({ extensions: Object.freeze(Object.keys(types)),
    extensionOf, kindOf, tokenAcceptsFile, acceptsFiles, pickerAcceptsFiles });
  root.JimengMediaFiles = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
