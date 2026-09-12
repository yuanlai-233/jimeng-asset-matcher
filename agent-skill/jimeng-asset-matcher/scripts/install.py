#!/usr/bin/env python3
"""Offline, standard-library installer. Does not enable browser extensions."""
import argparse
import hashlib
import html
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import uuid
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
NAME = "jimeng-asset-matcher"
MARKER = ".jimeng-install.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def checked_path(root, relative):
    parts = PurePosixPath(relative)
    if (not relative or parts.is_absolute() or ".." in parts.parts
            or "\\" in relative or ":" in relative or str(parts) != relative):
        raise ValueError("Invalid bundle path: " + relative)
    target = root.joinpath(*parts.parts)
    cursor = root
    for part in parts.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("Symlink in bundle: " + relative)
    if not target.is_file():
        raise ValueError("Missing bundle file: " + relative)
    return target


def verify_bundle():
    bundle = read_json(ROOT / "bundle.json")
    if bundle.get("name") != NAME or bundle.get("schema_version") != 1:
        raise ValueError("Unrecognized bundle.json")
    files = bundle["files"]
    for relative, expected in files.items():
        if digest(checked_path(ROOT, relative)) != expected:
            raise ValueError("File checksum mismatch: " + relative)
    required = {"SKILL.md", "LICENSE", "scripts/install.py", "references/user-guide.md"}
    if not required.issubset(files):
        raise ValueError("Incomplete skill bundle")
    manifest = read_json(ROOT / "assets/extension/manifest.json")
    if manifest["version"] != bundle["version"]:
        raise ValueError("Bundle and extension versions differ")
    runtime = {"manifest.json", "LICENSE", *manifest.get("icons", {}).values()}
    for entry in manifest["content_scripts"]:
        runtime.update(entry.get("js", []))
        runtime.update(entry.get("css", []))
    for rel in runtime:
        if "assets/extension/" + rel not in files:
            raise ValueError("Missing runtime checksum: " + rel)
    return bundle, sorted(runtime)


def destination(value):
    path = Path(value).expanduser().absolute()
    # Allow OS-managed parent aliases, but refuse a symlink at the target.
    if path.is_symlink():
        raise ValueError("Destination is a symlink: " + str(path))
    return path.resolve()


def overlaps(a, b):
    return a == b or a in b.parents or b in a.parents


def expected_files(component, runtime):
    if component == "extension":
        return {rel: ROOT / "assets/extension" / rel for rel in runtime}
    bundle = read_json(ROOT / "bundle.json")
    return {rel: ROOT / rel for rel in [*bundle["files"], "bundle.json"]}


def is_managed(target, component):
    try:
        marker = read_json(target / MARKER)
        return marker.get("name") == NAME and marker.get("component") == component
    except (OSError, ValueError, TypeError):
        return False


def plan_item(target, component, runtime):
    files = expected_files(component, runtime)
    if component == "skill" and target == ROOT:
        return dict(component=component, target=target, action="in_place", files=files)
    if overlaps(target, ROOT):
        raise ValueError("Destination overlaps the source bundle: " + str(target))
    if target.exists():
        if not target.is_dir():
            raise ValueError("Destination is not a directory: " + str(target))
        empty = not any(target.iterdir())
        if not empty and not is_managed(target, component):
            raise ValueError("Destination contains unmanaged files; choose a new directory: " + str(target))
        same = not empty and all(
            (target / rel).is_file() and not (target / rel).is_symlink()
            and digest(target / rel) == digest(source) for rel, source in files.items())
        actual = {p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file()}
        if same and actual == set(files) | {MARKER}:
            action = "unchanged"
        else:
            action = "update" if not empty else "install"
    else:
        action = "install"
    return dict(component=component, target=target, action=action, files=files)


def apply_items(items, bundle):
    staged, committed, backups = [], [], []
    try:
        for item in items:
            if item["action"] in {"unchanged", "in_place"}:
                continue
            target = item["target"]
            target.parent.mkdir(parents=True, exist_ok=True)
            stage = Path(tempfile.mkdtemp(prefix=".jimeng-stage-", dir=target.parent))
            staged.append(stage)
            for rel, source in item["files"].items():
                out = stage / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, out)
                if digest(out) != digest(source):
                    raise ValueError("Copy verification failed: " + rel)
            (stage / MARKER).write_text(json.dumps({
                "name": NAME, "version": bundle["version"], "component": item["component"]
            }, indent=2) + "\n", encoding="utf-8")
            backup = None
            if target.exists():
                backup_root = target.parent.parent / ".jimeng-asset-matcher-backups"
                backup_root.mkdir(parents=True, exist_ok=True)
                backup = backup_root / (target.name + "-" + uuid.uuid4().hex)
                target.rename(backup)
            try:
                stage.rename(target)
            except BaseException:
                if backup is not None:
                    backup.rename(target)
                raise
            committed.append((target, backup))
            if backup is not None:
                backups.append({"target": str(target), "backup": str(backup)})
    except BaseException:
        for target, backup in reversed(committed):
            shutil.rmtree(target)
            if backup is not None:
                backup.rename(target)
        raise
    finally:
        for stage in staged:
            if stage.exists():
                shutil.rmtree(stage)
    return backups


def write_setup(extension, version):
    # Keep generated instructions outside the browser runtime directory.
    setup = extension.parent / "jimeng-installation.html"
    if setup.is_symlink() or (setup.exists() and "<!-- jimeng-generated-setup -->" not in setup.read_text(encoding="utf-8")):
        setup = extension.parent / ("jimeng-installation-" + uuid.uuid4().hex[:8] + ".html")
    setup.write_text("""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>即梦素材一键匹配 · 安装最后一步</title><!-- jimeng-generated-setup -->
<style>body{font:17px/1.8 system-ui,sans-serif;max-width:800px;margin:6vh auto;padding:24px;color:#202125;background:#faf9f6}h1{line-height:1.3}code,pre{background:#eeece6;padding:6px 10px;border-radius:8px;overflow-wrap:anywhere;white-space:pre-wrap}li{margin:12px 0}</style>
<h1>文件已安装，接下来加载到浏览器</h1>
<p>即梦素材一键匹配 v%s · 浏览器启用状态尚未验证。</p>
<ol><li>打开桌面 Chrome 或 Edge，在地址栏输入 <code>chrome://extensions/</code> 或 <code>edge://extensions/</code>。</li>
<li>开启“开发者模式”，点击“加载已解压的扩展程序”，选择下面的目录：</li></ol>
<pre>%s</pre>
<p>更新已有安装时：在原扩展卡片上点击“重新加载”。保留这个文件夹，只启用一个版本。</p>
<ol start="3"><li>确认扩展名称和版本；保存提示词，刷新即梦页面，点击视频提示词框。</li>
<li>写 <code>@完整文件名（不含扩展名）</code> → 自动上传 → 等素材就绪 → 自动匹配 → 检查后自行生成。</li></ol>
<p>安装程序不会自动上传素材或提交生成任务。</p></html>""" % (html.escape(version), html.escape(str(extension))), encoding="utf-8")
    return setup


def main():
    parser = argparse.ArgumentParser(description="离线安装即梦素材匹配 Skill 和扩展文件。浏览器需加载扩展。")
    parser.add_argument("--platform", choices=["codex", "claude"], default="codex")
    parser.add_argument("--skills-dir", help="自定义 skills 父目录；覆盖 --platform 的默认目录")
    parser.add_argument("--extension-dir", help="稳定的扩展安装目录")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--extension-only", action="store_true")
    group.add_argument("--skill-only", action="store_true")
    parser.add_argument("--verify", action="store_true", help="仅校验随包文件，不写入")
    parser.add_argument("--dry-run", action="store_true", help="校验并输出安装计划，不写入")
    parser.add_argument("--open", action="store_true", help="安装后用默认浏览器打开本地安装指引")
    args = parser.parse_args()
    bundle, runtime = verify_bundle()
    if args.verify:
        print(json.dumps({"status": "verified", "version": bundle["version"],
                          "files": len(bundle["files"]), "runtime_files": len(runtime)}, ensure_ascii=False, indent=2))
        return
    skill_base = args.skills_dir or str(Path.home() / (".agents" if args.platform == "codex" else ".claude") / "skills")
    skill_dir = destination(str(Path(skill_base).expanduser() / NAME))
    extension = destination(args.extension_dir or str(Path.home() / "JimengAssetMatcher" / "extension"))
    items = []
    if not args.extension_only:
        items.append(plan_item(skill_dir, "skill", runtime))
    if not args.skill_only:
        items.append(plan_item(extension, "extension", runtime))
    if len(items) == 2 and overlaps(items[0]["target"], items[1]["target"]):
        raise ValueError("Skill and extension destinations overlap")
    result = {"status": "dry_run" if args.dry_run else "files_installed", "version": bundle["version"],
              "plan": [{"component": i["component"], "path": str(i["target"]), "action": i["action"]} for i in items]}
    if not args.skill_only:
        result.update(extension_dir=str(extension), browser_status="manual_load_required")
    if not args.extension_only:
        result["skill_dir"] = str(skill_dir)
    if not args.dry_run:
        result["backups"] = apply_items(items, bundle)
        if not args.skill_only:
            try:
                setup = write_setup(extension, bundle["version"])
                result["setup_guide"] = str(setup)
                if args.open:
                    result["guide_open_requested"] = bool(webbrowser.open(setup.as_uri()))
            except (OSError, UnicodeError, webbrowser.Error) as error:
                result["guide_warning"] = str(error)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        sys.exit("Python 3.9+ is required. You can load assets/extension manually without Python.")
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print("Install stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)
