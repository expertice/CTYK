#!/usr/bin/env python3
"""
Export project structure and text files into a single Markdown dump.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path


OUTPUT_FILE_NAME = "project_dump.md"
MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024  # 1 MB

IGNORED_DIR_NAMES = {
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    ".idea",
    ".vscode",
}

IGNORED_FILE_NAMES = {
    "package-lock.json",
    "yarn.lock",
    ".env",
    OUTPUT_FILE_NAME,
}

IGNORED_EXTENSIONS = {
    ".log",
    ".pyc",
    ".cache",
    ".ds_store",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".mp4",
    ".mov",
    ".ico",
    ".avif",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".zip",
    ".gz",
    ".tar",
}

LANGUAGE_BY_EXTENSION = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".cfg": "ini",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ps1": "powershell",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".xml": "xml",
    ".sql": "sql",
    ".txt": "text",
    ".csv": "csv",
    ".env.example": "dotenv",
    ".dockerfile": "dockerfile",
    ".bat": "bat",
    ".cmd": "bat",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".php": "php",
    ".r": "r",
}


def should_ignore_dir(dir_name: str) -> bool:
    lowered = dir_name.lower()
    return lowered in IGNORED_DIR_NAMES or lowered.endswith(".egg-info")


def should_ignore_file_name(file_name: str) -> bool:
    return file_name.lower() in {name.lower() for name in IGNORED_FILE_NAMES}


def should_ignore_by_extension(path: Path) -> bool:
    suffixes = [suffix.lower() for suffix in path.suffixes]
    if not suffixes:
        return False
    return any(suffix in IGNORED_EXTENSIONS for suffix in suffixes)


def detect_markdown_language(path: Path) -> str:
    suffixes = [suffix.lower() for suffix in path.suffixes]
    if not suffixes:
        if path.name.lower() == "dockerfile":
            return "dockerfile"
        return "text"

    full_suffix = "".join(suffixes)
    if full_suffix in LANGUAGE_BY_EXTENSION:
        return LANGUAGE_BY_EXTENSION[full_suffix]

    last_suffix = suffixes[-1]
    return LANGUAGE_BY_EXTENSION.get(last_suffix, "text")


def build_visible_tree_lines(root: Path) -> list[str]:
    lines: list[str] = [f"{root.name}/"]

    def walk(directory: Path, prefix: str) -> None:
        entries = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        visible_entries: list[Path] = []
        for entry in entries:
            if entry.is_dir() and should_ignore_dir(entry.name):
                continue
            if entry.is_file() and should_ignore_file_name(entry.name):
                continue
            if entry.is_file() and should_ignore_by_extension(entry):
                continue
            visible_entries.append(entry)

        for idx, entry in enumerate(visible_entries):
            is_last = idx == len(visible_entries) - 1
            branch = "└── " if is_last else "├── "
            lines.append(f"{prefix}{branch}{entry.name}{'/' if entry.is_dir() else ''}")
            if entry.is_dir():
                child_prefix = f"{prefix}{'    ' if is_last else '│   '}"
                walk(entry, child_prefix)

    walk(root, "")
    return lines


def scan_files(root: Path, skip_reasons: Counter[str]) -> tuple[list[Path], dict[Path, str]]:
    included_files: list[Path] = []
    contents: dict[Path, str] = {}

    for current_dir, dir_names, file_names in root.walk(top_down=True):
        dir_names[:] = [d for d in dir_names if not should_ignore_dir(d)]

        for file_name in sorted(file_names, key=str.lower):
            path = current_dir / file_name
            rel = path.relative_to(root)
            rel_str = rel.as_posix()

            if should_ignore_file_name(file_name):
                skip_reasons["ignored_name"] += 1
                print(f"[SKIP][ignored_name] {rel_str}")
                continue

            if should_ignore_by_extension(path):
                skip_reasons["ignored_extension"] += 1
                print(f"[SKIP][ignored_extension] {rel_str}")
                continue

            size = path.stat().st_size
            if size > MAX_FILE_SIZE_BYTES:
                skip_reasons["too_large"] += 1
                print(f"[SKIP][too_large] {rel_str} ({size} bytes)")
                continue

            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                skip_reasons["non_utf8_or_binary"] += 1
                print(f"[SKIP][non_utf8_or_binary] {rel_str}")
                continue
            except OSError as exc:
                skip_reasons["read_error"] += 1
                print(f"[SKIP][read_error] {rel_str}: {exc}")
                continue

            included_files.append(path)
            contents[path] = text
            print(f"[INCLUDE] {rel_str}")

    included_files.sort(key=lambda p: p.relative_to(root).as_posix())
    return included_files, contents


def write_dump(
    root: Path,
    output_path: Path,
    tree_lines: list[str],
    included_files: list[Path],
    contents: dict[Path, str],
) -> None:
    with output_path.open("w", encoding="utf-8", newline="\n") as md:
        md.write("# Project Dump\n\n")
        md.write("## Project Tree\n\n")
        md.write("```text\n")
        md.write("\n".join(tree_lines))
        md.write("\n```\n\n")
        md.write("## File Contents\n\n")

        for path in included_files:
            relative_path = path.relative_to(root).as_posix()
            language = detect_markdown_language(path)
            md.write(f"---\nSTART OF FILE: {relative_path}\n---\n\n")
            md.write(f"```{language}\n")
            md.write(contents[path])
            if not contents[path].endswith("\n"):
                md.write("\n")
            md.write("```\n\n")


def print_stats(included_count: int, skip_reasons: Counter[str]) -> None:
    skipped_count = sum(skip_reasons.values())
    print("\n=== Export summary ===")
    print(f"Included files: {included_count}")
    print(f"Skipped files: {skipped_count}")
    if skipped_count:
        print("Skipped by reason:")
        for reason, count in sorted(skip_reasons.items()):
            print(f"  - {reason}: {count}")


def main() -> None:
    root = Path.cwd()
    output_path = root / OUTPUT_FILE_NAME
    skip_reasons: Counter[str] = Counter()

    print(f"Scanning project in: {root}")
    tree_lines = build_visible_tree_lines(root)
    included_files, contents = scan_files(root, skip_reasons)
    write_dump(root, output_path, tree_lines, included_files, contents)
    print(f"\nMarkdown dump created: {output_path}")
    print_stats(len(included_files), skip_reasons)


if __name__ == "__main__":
    main()
