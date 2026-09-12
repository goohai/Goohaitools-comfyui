import os
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

import folder_paths


class AnyType(str):
    """A wildcard socket that remains compatible with legacy ComfyUI validation."""

    def __ne__(self, other):
        return False


ANY = AnyType("*")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".gif"}
MAX_BATCH_PREVIEWS = 10


def _media_kind(value):
    if value is None:
        return "unknown"

    # ComfyUI IMAGE is a torch tensor in NHWC layout.
    if hasattr(value, "shape") and hasattr(value, "detach"):
        shape = tuple(value.shape)
        if len(shape) in (3, 4) and shape[-1] in (1, 3, 4):
            return "image"

    # Official VIDEO objects expose these methods. Keeping this duck-typed
    # avoids importing the new API on older ComfyUI releases.
    video_methods = ("save_to", "get_components", "get_frame_rate", "get_duration")
    if any(callable(getattr(value, name, None)) for name in video_methods):
        return "video"

    if isinstance(value, (str, os.PathLike)):
        suffix = Path(value).suffix.lower()
        if suffix in VIDEO_EXTENSIONS:
            return "video"
        if suffix in IMAGE_EXTENSIONS:
            return "image"

    if isinstance(value, dict):
        path = value.get("filename") or value.get("path") or value.get("file")
        suffix = Path(str(path)).suffix.lower() if path else ""
        if suffix in VIDEO_EXTENSIONS:
            return "video"
        if suffix in IMAGE_EXTENSIONS:
            return "image"

    return "unknown"


def _image_batch_size(value):
    if not hasattr(value, "shape"):
        return 0
    shape = tuple(value.shape)
    if len(shape) == 3 and shape[-1] in (1, 3, 4):
        return 1
    if len(shape) == 4 and shape[-1] in (1, 3, 4):
        return int(shape[0])
    return 0


def _save_image_preview(value, side):
    tensor = value
    if len(tensor.shape) == 3:
        tensor = tensor.unsqueeze(0)
    previews = []
    for index, item in enumerate(tensor[:MAX_BATCH_PREVIEWS]):
        image = item.detach().cpu().float().numpy()
        image = np.nan_to_num(image, nan=0.0, posinf=1.0, neginf=0.0)
        image = np.clip(image * 255.0, 0, 255).astype(np.uint8)
        if image.shape[-1] == 1:
            image = image[..., 0]

        filename = (
            f"gh_compare_{side}_{uuid.uuid4().hex}.png"
            if len(tensor) == 1
            else f"gh_compare_{side}_{index + 1}_{uuid.uuid4().hex}.png"
        )
        full_path = os.path.join(folder_paths.get_temp_directory(), filename)
        Image.fromarray(image).save(full_path, compress_level=4)
        previews.append({
            "kind": "image",
            "filename": filename,
            "subfolder": "",
            "type": "temp",
            "width": int(image.shape[1]),
            "height": int(image.shape[0]),
        })

    if len(previews) <= 1:
        return previews[0] if previews else {"kind": "unknown"}
    return {
        **previews[0],
        "batch": previews,
        "batch_size": len(previews),
        "batch_index": 0,
    }


def _resolve_existing_media(value):
    if isinstance(value, (str, os.PathLike)):
        raw = str(value)
        filename, base = folder_paths.annotated_filepath(raw)
        candidates = [Path(base) / filename] if base is not None else [Path(raw)]
        if base is None and not Path(raw).is_absolute():
            candidates.extend(Path(folder) / raw for folder in (
                folder_paths.get_input_directory(),
                folder_paths.get_output_directory(),
                folder_paths.get_temp_directory(),
            ))
        return next((candidate for candidate in candidates if candidate.is_file()), None)
    if isinstance(value, dict):
        raw = value.get("path") or value.get("file")
    else:
        raw = getattr(value, "path", None) or getattr(value, "file_path", None) or getattr(value, "filename", None)
    if raw:
        candidate = _resolve_existing_media(str(raw))
        if candidate is not None:
            return candidate
    if not isinstance(value, dict):
        return None
    filename = value.get("filename")
    if not filename:
        return None
    base = folder_paths.get_directory_by_type(value.get("type", "temp"))
    if base is None:
        return None
    candidate = Path(base) / str(value.get("subfolder", "")) / str(filename)
    return candidate if candidate.is_file() else None


def _media_reference_for_path(path):
    if path is None:
        return None
    source = Path(path).resolve()
    managed_folders = (
        ("input", Path(folder_paths.get_input_directory())),
        ("output", Path(folder_paths.get_output_directory())),
        ("temp", Path(folder_paths.get_temp_directory())),
    )
    # A bare /view reference contains a filename plus a folder type. If the
    # same basename exists in another managed folder, prefer a private temp
    # copy rather than risk resolving the wrong asset after workflow replay.
    same_name = []
    for _, folder in managed_folders:
        try:
            same_name.extend(candidate.resolve() for candidate in folder.rglob(source.name) if candidate.is_file())
        except OSError:
            continue
    if len(set(same_name)) > 1:
        return None

    for folder_type, folder in managed_folders:
        try:
            relative = source.relative_to(folder.resolve())
        except ValueError:
            continue
        return {
            "filename": relative.name,
            "subfolder": str(relative.parent).replace(os.sep, "/") if str(relative.parent) != "." else "",
            "type": folder_type,
        }
    return None


def _prompt_image_reference(prompt, unique_id, side):
    if not isinstance(prompt, dict) or unique_id is None:
        return None
    current = prompt.get(str(unique_id), prompt.get(unique_id))
    if not isinstance(current, dict):
        return None
    raw_input = (current.get("inputs") or {}).get(side)
    if not isinstance(raw_input, (list, tuple)) or not raw_input:
        return None
    upstream = prompt.get(str(raw_input[0]), prompt.get(raw_input[0]))
    if not isinstance(upstream, dict):
        return None
    inputs = upstream.get("inputs") or {}
    preferred = [inputs.get(key) for key in ("image", "file", "filename", "path")]
    candidates = preferred + list(inputs.values())
    for candidate in candidates:
        if not isinstance(candidate, (str, os.PathLike)):
            continue
        suffix = Path(str(candidate).split("[")[0]).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS:
            continue
        path = _resolve_existing_media(candidate)
        if path is not None:
            return _media_reference_for_path(path)
    return None


def _video_metadata(value):
    def safe_call(name, default=0):
        fn = getattr(value, name, None)
        if not callable(fn):
            return default
        try:
            return fn()
        except Exception:
            return default

    dimensions = safe_call("get_dimensions", (0, 0))
    try:
        width, height = int(dimensions[0]), int(dimensions[1])
    except Exception:
        width, height = 0, 0
    try:
        frame_rate = float(safe_call("get_frame_rate", 0))
    except Exception:
        frame_rate = 0.0
    try:
        frame_count = int(safe_call("get_frame_count", 0))
    except Exception:
        frame_count = 0
    try:
        duration = float(safe_call("get_duration", 0))
    except Exception:
        duration = 0.0
    return width, height, frame_count, frame_rate, duration


def _resolve_existing_video(value):
    if isinstance(value, (str, os.PathLike)):
        path = Path(value)
        return path if path.is_file() else None
    if not isinstance(value, dict):
        return None
    raw = value.get("path") or value.get("file")
    if raw and Path(str(raw)).is_file():
        return Path(str(raw))
    filename = value.get("filename")
    if not filename:
        return None
    folder_type = value.get("type", "temp")
    base = {
        "input": folder_paths.get_input_directory(),
        "output": folder_paths.get_output_directory(),
        "temp": folder_paths.get_temp_directory(),
    }.get(folder_type, folder_paths.get_temp_directory())
    path = Path(base) / value.get("subfolder", "") / filename
    return path if path.is_file() else None


def _video_source_path(value):
    """Return a reusable on-disk source when the VIDEO object exposes one."""
    source = _resolve_existing_video(value)
    if source is not None:
        return source
    get_source = getattr(value, "get_stream_source", None)
    if not callable(get_source):
        return None
    try:
        source = get_source()
    except Exception:
        return None
    if isinstance(source, (str, os.PathLike)):
        path = Path(source)
        return path if path.is_file() else None
    return None


def _direct_video_reference(value):
    """Build a /view reference without copying a complete existing file."""
    source = _video_source_path(value)
    if source is None:
        return None

    # A trimmed VideoFromFile cannot point at the original file because the
    # browser would show frames outside the requested time window.
    trim_window = getattr(value, "get_active_trim_window", None)
    if callable(trim_window):
        try:
            start_time, duration = trim_window()
            if abs(float(start_time)) > 1e-9 or abs(float(duration)) > 1e-9:
                return None
        except Exception:
            return None

    return _media_reference_for_path(source)


def _save_video_preview(value, side):
    width, height, frame_count, frame_rate, duration = _video_metadata(value)

    direct = _direct_video_reference(value)
    if direct is not None:
        return {
            "kind": "video",
            **direct,
            "width": width,
            "height": height,
            "frame_count": frame_count,
            "frame_rate": frame_rate,
            "duration": duration,
        }

    filename = f"gh_compare_{side}_{uuid.uuid4().hex}.mp4"
    full_path = os.path.join(folder_paths.get_temp_directory(), filename)

    source = _video_source_path(value)
    if source is not None:
        # Copy through Python so this module stays platform independent.
        with open(source, "rb") as src, open(full_path, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
    else:
        save_to = getattr(value, "save_to", None)
        if not callable(save_to):
            raise TypeError("无法将该输入识别或导出为视频")
        try:
            # New ComfyUI: explicitly request a browser-friendly MP4/H.264 file.
            from comfy_api.latest._util.video_types import VideoCodec, VideoContainer

            save_to(full_path, format=VideoContainer.MP4, codec=VideoCodec.H264)
        except (ImportError, AttributeError, TypeError):
            # Older/custom VIDEO implementations commonly infer format by suffix.
            save_to(full_path)

    return {
        "kind": "video",
        "filename": filename,
        "subfolder": "",
        "type": "temp",
        "width": width,
        "height": height,
        "frame_count": frame_count,
        "frame_rate": frame_rate,
        "duration": duration,
    }


def _make_preview(value, side, source_reference=None):
    kind = _media_kind(value)
    if kind == "image":
        if _image_batch_size(value) > 1:
            return _save_image_preview(value, side)
        existing = _resolve_existing_media(value)
        direct = _media_reference_for_path(existing) if existing is not None else None
        direct = direct or source_reference
        if direct is not None:
            direct_path = Path(folder_paths.get_directory_by_type(direct["type"])) / direct.get("subfolder", "") / direct["filename"]
            try:
                with Image.open(direct_path) as image:
                    width, height = image.size
            except (OSError, ValueError):
                return _save_image_preview(value, side)
            return {"kind": "image", **direct, "width": width, "height": height}
        return _save_image_preview(value, side)
    if kind == "video":
        return _save_video_preview(value, side)
    return {"kind": "unknown"}


class GHImageVideoComparer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "media_a": (ANY, {"tooltip": "图像或视频 A（可选）"}),
                "media_b": (ANY, {"tooltip": "图像或视频 B（可选）"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "compare"
    OUTPUT_NODE = True
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "在节点内以滑动、左右双拼或上下双拼方式对比图像/视频。"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Preview nodes should refresh after every execution.
        return float("nan")

    def compare(self, media_a=None, media_b=None, prompt=None, extra_pnginfo=None, unique_id=None):
        # Running a workflow after both links were removed must not clear the
        # last successful browser preview stored in the node properties.
        if media_a is None and media_b is None:
            return {"ui": {"gh_compare": [{"version": 1, "preserve": True}]}}

        kind_a = _media_kind(media_a)
        kind_b = _media_kind(media_b)
        if media_a is not None and media_b is not None:
            if kind_a not in ("image", "video") or kind_b not in ("image", "video") or kind_a != kind_b:
                raise TypeError("图像对比 视频对比 GH：A 与 B 必须是同一类型，不允许图像和视频混合输入。")
        return {
            "ui": {
                "gh_compare": [{
                    "version": 1,
                    "a": _make_preview(media_a, "a", _prompt_image_reference(prompt, unique_id, "media_a")) if media_a is not None else {"kind": "unknown"},
                    "b": _make_preview(media_b, "b", _prompt_image_reference(prompt, unique_id, "media_b")) if media_b is not None else {"kind": "unknown"},
                }]
            }
        }


NODE_CLASS_MAPPINGS = {
    "GH_ImageVideoComparer": GHImageVideoComparer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GH_ImageVideoComparer": "图像对比 视频对比 GH",
}
