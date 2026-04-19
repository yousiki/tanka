#!/usr/bin/env python3
"""Fill the Homebrew cask template with the current release's hashes.

Reads homebrew/tanka.rb, rewrites the version to match GITHUB_REF_NAME, and
replaces both per-arch sha256 fields with values pulled from
dist/SHA256SUMS. Writes the populated cask to dist/tanka.rb so the release
workflow can attach it as a release asset.
"""
from __future__ import annotations

import os
import pathlib
import re
import sys

HASH_ZEROS = "0" * 64


def load_hashes(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        digest, name = parts
        out[name.strip().lstrip("*")] = digest
    return out


def main() -> int:
    ref = os.environ.get("GITHUB_REF_NAME", "").lstrip("v")
    if not ref:
        print("GITHUB_REF_NAME is required", file=sys.stderr)
        return 1

    repo_root = pathlib.Path(__file__).resolve().parents[2]
    template = repo_root / "homebrew" / "tanka.rb"
    sums_file = repo_root / "dist" / "SHA256SUMS"
    output = repo_root / "dist" / "tanka.rb"

    hashes = load_hashes(sums_file)
    try:
        arm_sha = hashes["Tanka-aarch64.dmg"]
        intel_sha = hashes["Tanka-x86_64.dmg"]
    except KeyError as err:
        print(f"missing hash for {err} in {sums_file}", file=sys.stderr)
        print(sums_file.read_text(), file=sys.stderr)
        return 1

    if HASH_ZEROS in (arm_sha, intel_sha):
        print("release SHA256SUMS contains a placeholder hash", file=sys.stderr)
        return 1

    source = template.read_text()
    source = re.sub(r'version "[^"]*"', f'version "{ref}"', source, count=1)
    # The template's arm_sha is a concrete hash (from the seed release),
    # not the zeros placeholder — target the first sha256 that appears.
    source = re.sub(r'sha256 "[^"]*"', f'sha256 "{arm_sha}"', source, count=1)
    source = source.replace(f'sha256 "{HASH_ZEROS}"', f'sha256 "{intel_sha}"')

    output.write_text(source)
    print(source)
    return 0


if __name__ == "__main__":
    sys.exit(main())
