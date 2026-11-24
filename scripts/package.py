"""Build a Chrome Load unpacked archive with the manifest at its root."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
extension = root / "extension"
version = json.loads((root / "package.json").read_text())["version"]
for name in ("manifest.json", "build-info.json"):
    metadata = json.loads((extension / name).read_text())
    if metadata.get("version_name", metadata["version"]) != version:
        raise SystemExit(f"Version mismatch in {name}")

archive = root / "dist" / f"manga-translator-pro-{version}.zip"
archive.parent.mkdir(exist_ok=True)
with ZipFile(archive, "w", compression=ZIP_DEFLATED) as package:
    for path in sorted(extension.rglob("*")):
        if path.is_file():
            package.write(path, path.relative_to(extension))
print(archive)
