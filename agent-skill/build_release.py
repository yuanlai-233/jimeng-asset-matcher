#!/usr/bin/env python3
"""Rebuild the checksum inventory and portable ZIP/.skill layouts."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

BASE = Path(__file__).resolve().parent
ROOT = BASE / "jimeng-asset-matcher"
FORBIDDEN_PACKAGE_PARTS = {
    "test", "tests", "testing", "fixture", "fixtures", "sample", "samples",
    "qa", "evidence", "verification", "raw", "tmp", "temp",
    "test-materials", "quick-start",
}


def main():
    files = []
    for path in sorted(ROOT.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed: " + str(path))
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in {"__pycache__", ".git", ".DS_Store"} for part in rel.parts):
            continue
        if any(part.lower() in FORBIDDEN_PACKAGE_PARTS for part in rel.parts):
            raise ValueError("Test or temporary material is not allowed in the skill package: " + str(path))
        if rel.as_posix() == "bundle.json":
            continue
        if path.suffix in {".pyc", ".zip"} or path.name == ".jimeng-install.json":
            raise ValueError("Generated or installed file in package source: " + str(path))
        files.append(path)
    for doc in (p for p in files if p.suffix == ".md"):
        for link in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', doc.read_text(encoding="utf-8")):
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", link) or link.startswith("#"):
                continue
            target = (doc.parent / link.split("#")[0]).resolve()
            if not target.exists() and target != ROOT / "bundle.json":
                raise ValueError("Broken local link in " + doc.name + ": " + link)
    manifest = json.loads((ROOT / "assets/extension/manifest.json").read_text())
    version = manifest["version"]
    bundle = {
        "schema_version": 1, "name": ROOT.name, "version": version, "package_revision": 2,
        "source_release": "https://github.com/yuanlai-233/jimeng-asset-matcher/releases/tag/v" + version,
        "files": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    (ROOT / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    files.append(ROOT / "bundle.json")
    sums = []
    layouts = [
        ("jimeng-asset-matcher-skill-v" + version + ".zip", False),
        ("jimeng-asset-matcher-skill-v" + version + "-flat.zip", True),
        ("jimeng-asset-matcher-v" + version + ".skill", False),
    ]
    for archive_name, flat in layouts:
        archive = BASE / archive_name
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for path in sorted(files):
                rel = path.relative_to(ROOT).as_posix()
                info = zipfile.ZipInfo(rel if flat else ROOT.name + "/" + rel, date_time=(2026, 9, 11, 0, 0, 0))
                info.create_system = 3
                executable = path.name == "install-macos.command" or path.suffix == ".py"
                info.external_attr = (0o100755 if executable else 0o100644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(info, path.read_bytes(), compresslevel=9)
        sums.append(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name)
        print(archive.name + ": " + str(archive.stat().st_size) + " bytes; " + str(len(files)) + " files")
    (BASE / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
