"""Run against the built CLI; expose only its declared direct dependencies."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[4]
with tempfile.TemporaryDirectory(prefix="revyme-cli-clean-review-") as tmp:
    package = Path(tmp) / "package"
    package.mkdir()
    for name in ["dist", "bin"]:
        shutil.copytree(root / "packages/cli" / name, package / name)
    shutil.copyfile(root / "packages/cli/package.json", package / "package.json")
    dependencies = json.loads((package / "package.json").read_text())["dependencies"]
    for name in dependencies:
        target = package / "node_modules" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        source = root / "node_modules" / name
        if name == "@revyme/automation-core":
            source = root / "packages/automation-core"
        os.symlink(source, target, target_is_directory=True)
    result = subprocess.run(
        ["node", str(package / "bin/revyme.mjs"), "--version"],
        cwd=package,
        text=True,
        capture_output=True,
    )
    print("declared_dependencies_only_exit:", result.returncode)
    print(result.stdout)
    print(result.stderr)
    raise SystemExit(result.returncode)
