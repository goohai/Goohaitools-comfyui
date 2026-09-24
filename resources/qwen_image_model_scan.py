"""Independent GGUF discovery and lightweight metadata reading.

This module intentionally does not touch ComfyUI's global folder_paths registry.
"""

from __future__ import annotations

import os
import struct
from dataclasses import dataclass
from pathlib import Path
from threading import RLock


@dataclass(frozen=True)
class GGUFModel:
    key: str
    display: str
    path: str
    is_mmproj: bool
    architecture: str
    general_type: str


_CACHE_LOCK = RLock()
_METADATA_CACHE: dict[tuple[str, int, int], dict[str, object]] = {}
_SCAN_CACHE: dict[tuple[str, ...], tuple[GGUFModel, ...]] = {}


def _read_u32(stream) -> int:
    return struct.unpack("<I", stream.read(4))[0]


def _read_u64(stream) -> int:
    return struct.unpack("<Q", stream.read(8))[0]


def _read_string(stream) -> str:
    length = _read_u64(stream)
    raw = stream.read(length)
    return raw.decode("utf-8", errors="replace")


def _read_scalar(stream, value_type: int):
    formats = {
        0: ("<B", 1), 1: ("<b", 1), 2: ("<H", 2), 3: ("<h", 2),
        4: ("<I", 4), 5: ("<i", 4), 6: ("<f", 4), 7: ("<?", 1),
        10: ("<Q", 8), 11: ("<q", 8), 12: ("<d", 8),
    }
    if value_type == 8:
        return _read_string(stream)
    if value_type not in formats:
        raise ValueError(f"Unsupported GGUF value type: {value_type}")
    fmt, size = formats[value_type]
    data = stream.read(size)
    if len(data) != size:
        raise EOFError("Truncated GGUF metadata")
    return struct.unpack(fmt, data)[0]


def _skip_value(stream, value_type: int) -> object:
    if value_type == 9:
        item_type = _read_u32(stream)
        count = _read_u64(stream)
        # Read arrays to keep the stream aligned, but do not retain tokenizer
        # vocab arrays that can contain hundreds of thousands of entries.
        for _ in range(count):
            _skip_value(stream, item_type)
        return None
    return _read_scalar(stream, value_type)


def read_gguf_metadata(path: str | os.PathLike[str]) -> dict[str, object]:
    """Read only the GGUF header and key/value metadata, never tensor data."""
    resolved = os.path.abspath(os.fspath(path))
    stat = os.stat(resolved)
    cache_key = (resolved, int(stat.st_size), int(stat.st_mtime_ns))
    with _CACHE_LOCK:
        cached = _METADATA_CACHE.get(cache_key)
    if cached is not None:
        return cached

    metadata: dict[str, object] = {}
    with open(resolved, "rb") as stream:
        if stream.read(4) != b"GGUF":
            raise ValueError(f"Not a GGUF file: {resolved}")
        _read_u32(stream)       # version
        _read_u64(stream)       # tensor count
        kv_count = _read_u64(stream)
        for _ in range(kv_count):
            key = _read_string(stream)
            value_type = _read_u32(stream)
            # Keep only the small fields needed by this node. Other values are
            # still consumed to preserve header alignment.
            value = _skip_value(stream, value_type)
            if key in {
                "general.architecture",
                "general.type",
                "general.name",
                "general.basename",
                "clip.projector_type",
            } or key.endswith(".context_length"):
                metadata[key] = value

    with _CACHE_LOCK:
        _METADATA_CACHE[cache_key] = metadata
    return metadata


def _model_roots(models_dir: str | os.PathLike[str]) -> list[Path]:
    base = Path(models_dir)
    result: list[Path] = []
    seen: set[str] = set()
    for child in (base / "LLM", base / "llm"):
        if not child.is_dir():
            continue
        identity = os.path.normcase(os.path.realpath(str(child)))
        if identity not in seen:
            seen.add(identity)
            result.append(child)
    return result


def scan_models(models_dir: str | os.PathLike[str]) -> tuple[GGUFModel, ...]:
    roots = _model_roots(models_dir)
    root_key = tuple(os.path.normcase(os.path.realpath(str(p))) for p in roots)
    with _CACHE_LOCK:
        cached = _SCAN_CACHE.get(root_key)
    # Model directory contents can change while ComfyUI is running. A small
    # directory signature keeps dropdown refreshes cheap without going stale.
    files: list[tuple[Path, Path]] = []
    signature_parts: list[str] = list(root_key)
    for root in roots:
        for path in sorted(root.rglob("*"), key=lambda p: str(p).casefold()):
            if path.is_file() and path.suffix.casefold() == ".gguf":
                files.append((root, path))
                stat = path.stat()
                signature_parts.append(f"{path}|{stat.st_size}|{stat.st_mtime_ns}")
    signature = tuple(signature_parts)
    if cached is not None and getattr(scan_models, "_signature", None) == (root_key, signature):
        return cached

    entries: list[GGUFModel] = []
    duplicate_keys: dict[str, int] = {}
    raw_entries: list[tuple[Path, Path, dict[str, object], str]] = []
    for root, path in files:
        try:
            metadata = read_gguf_metadata(path)
        except Exception:
            continue
        relative = path.relative_to(root).as_posix()
        key = relative.casefold()
        duplicate_keys[key] = duplicate_keys.get(key, 0) + 1
        raw_entries.append((root, path, metadata, relative))

    for root, path, metadata, relative in raw_entries:
        architecture = str(metadata.get("general.architecture", "")).casefold()
        general_type = str(metadata.get("general.type", "")).casefold()
        is_mmproj = general_type == "mmproj" or "mmproj" in path.name.casefold()
        # Keep the dropdown compact: nested folders are only a storage detail
        # and should not be shown in the model selector.
        display = path.name
        entries.append(GGUFModel(
            key=f"{os.path.normcase(str(path))}",
            display=display,
            path=str(path),
            is_mmproj=is_mmproj,
            architecture=architecture,
            general_type=general_type,
        ))

    entries.sort(key=lambda item: item.display.casefold())
    result = tuple(entries)
    with _CACHE_LOCK:
        _SCAN_CACHE[root_key] = result
    scan_models._signature = (root_key, signature)
    return result


def select_models(models_dir: str | os.PathLike[str], *, mmproj: bool) -> tuple[GGUFModel, ...]:
    models = scan_models(models_dir)
    if mmproj:
        return tuple(item for item in models if item.is_mmproj)
    candidates = tuple(
        item for item in models
        if not item.is_mmproj and item.general_type in {"", "model"} and item.architecture == "qwen35"
    )
    # This node is dedicated to Qwen Image 2.1 PE. If those files are present,
    # hide unrelated Qwen3.x chat models from the two PE dropdowns. The fallback
    # keeps the node diagnosable on installations where metadata is incomplete.
    dedicated = tuple(
        item for item in candidates
        if "qwen image" in item.display.casefold() or "pe-" in item.display.casefold()
    )
    return dedicated or candidates
