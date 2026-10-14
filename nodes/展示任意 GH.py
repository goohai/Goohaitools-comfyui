import logging
import os
import uuid
import wave
from collections.abc import Mapping

import numpy as np
import torch
from PIL import Image

import folder_paths
import nodes
from comfy_api.latest import Input, Types
from comfy.model_management import InterruptProcessingException
from comfy_execution.graph_utils import is_link
from server import PromptServer


class AnyType(str):
    def __ne__(self, value):
        return False

    def __eq__(self, value):
        return True


ANY = AnyType("*")
NODE_TYPE = "GoohaiDisplayAny"


def select_display_targets(request):
    """Connected displays are dependencies, not independent execution roots."""
    prompt = request.get("prompt", {})
    displays = {node_id for node_id, node in prompt.items() if node.get("class_type") == NODE_TYPE}
    if not displays:
        return request
    referenced = {
        value[0]
        for node in prompt.values()
        for value in node.get("inputs", {}).values()
        if is_link(value)
    }
    passive = displays & referenced
    if not passive:
        return request
    targets = request.get("partial_execution_targets")
    if targets is None:
        targets = [
            node_id for node_id, node in prompt.items()
            if getattr(nodes.NODE_CLASS_MAPPINGS.get(node.get("class_type")), "OUTPUT_NODE", False) is True
        ]
    request["partial_execution_targets"] = [node_id for node_id in targets if str(node_id) not in passive]
    return request


def describe(value, depth=0, seen=None):
    if isinstance(value, str):
        return value if depth == 0 else repr(value[:500])
    if value is None or isinstance(value, (bool, int, float)):
        return str(value)
    if torch.is_tensor(value):
        return f"Tensor(shape={list(value.shape)}, dtype={value.dtype}, device={value.device})"
    if isinstance(value, np.ndarray):
        return f"ndarray(shape={list(value.shape)}, dtype={value.dtype})"
    if isinstance(value, (Mapping, list, tuple, set)):
        seen = set() if seen is None else seen
        if id(value) in seen:
            return "<循环引用>"
        if depth >= 3:
            return f"{type(value).__name__}({len(value)} 项)"
        seen.add(id(value))
        lines = []
        entries = value.items() if isinstance(value, Mapping) else enumerate(value)
        for index, (key, item) in enumerate(entries):
            if index == 8:
                lines.append(f"… 其余 {len(value) - 8} 项")
                break
            lines.append(f"{key}: {describe(item, depth + 1, seen)}")
        seen.remove(id(value))
        return f"{type(value).__name__}({len(value)} 项)\n" + "\n".join(lines)
    cls = type(value)
    return f"{cls.__module__}.{cls.__qualname__}"


def input_type(value, declared):
    declared = str(declared or "ANY").upper()
    if declared not in ("ANY", "*"):
        return declared
    if isinstance(value, Input.Video):
        return "VIDEO"
    if isinstance(value, Mapping):
        if "waveform" in value and "sample_rate" in value:
            return "AUDIO"
        if "samples" in value:
            return "LATENT"
    if torch.is_tensor(value):
        if value.ndim == 4 and value.shape[-1] in (1, 3, 4):
            return "IMAGE"
        if value.ndim in (2, 3):
            return "MASK"
    for cls, name in ((bool, "BOOLEAN"), (int, "INT"), (float, "FLOAT"), (str, "STRING")):
        if isinstance(value, cls):
            return name
    return "ANY"


def temp_file(extension):
    directory = folder_paths.get_temp_directory()
    os.makedirs(directory, exist_ok=True)
    filename = f"gh_display_{uuid.uuid4().hex}.{extension}"
    return os.path.join(directory, filename), {"filename": filename, "subfolder": "", "type": "temp"}


def preview_images(value, kind):
    if not torch.is_tensor(value):
        raise TypeError("图像/遮罩输入不是 Tensor")
    if kind == "MASK":
        images = value.unsqueeze(0) if value.ndim == 2 else value
        if images.ndim != 3:
            raise ValueError("遮罩应为 [B,H,W] 或 [H,W]")
    else:
        images = value.unsqueeze(0) if value.ndim == 3 else value
        if images.ndim != 4 or images.shape[-1] not in (1, 3, 4):
            raise ValueError("图像应为 [B,H,W,C]")
    results = []
    for image in images:
        i = 255. * image.cpu().numpy()
        pixels = np.clip(i, 0, 255).astype(np.uint8)
        if pixels.ndim == 3 and pixels.shape[-1] == 1:
            pixels = pixels[..., 0]
        path, reference = temp_file("png")
        Image.fromarray(pixels).save(path, compress_level=1)
        results.append(reference)
    return results


def preview_audio(value):
    waveform = value["waveform"]
    sample_rate = int(value["sample_rate"])
    if not torch.is_tensor(waveform) or sample_rate <= 0:
        raise ValueError("音频需要有效的 waveform 和 sample_rate")
    if waveform.ndim == 1:
        waveform = waveform[None, None, :]
    elif waveform.ndim == 2:
        waveform = waveform[None, ...]
    if waveform.ndim != 3:
        raise ValueError("音频波形应为 [B,C,T]")
    results = []
    for item in waveform:
        samples = item.detach().float().cpu().numpy().T
        samples = np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0)
        samples = (np.clip(samples, -1, 1) * 32767).astype("<i2")
        path, reference = temp_file("wav")
        with wave.open(path, "wb") as output:
            output.setnchannels(item.shape[0])
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(samples.tobytes())
        results.append(reference)
    return results


class GoohaiDisplayAny:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"gh_input_type": ("STRING", {"default": "ANY", "hidden": True, "socketless": True})},
            "optional": {"Any": (ANY,)},
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("Any",)
    FUNCTION = "display"
    CATEGORY = "孤海工具箱"
    OUTPUT_NODE = True
    DESCRIPTION = "展示并原样透传任意输入。有下游连接时按需执行，无下游连接时主动展示。"

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        return True

    def display(self, Any=None, gh_input_type="ANY", prompt=None, unique_id=None):
        if prompt and unique_id in prompt:
            source = prompt[unique_id].get("inputs", {}).get("Any")
            if is_link(source) and source[0] in prompt:
                source_class = nodes.NODE_CLASS_MAPPINGS.get(prompt[source[0]]["class_type"])
                output_types = getattr(source_class, "RETURN_TYPES", ())
                if source[1] < len(output_types) and str(output_types[source[1]]) not in ("*", "ANY", "COMFY_MATCHTYPE_V3"):
                    gh_input_type = output_types[source[1]]
        kind = input_type(Any, gh_input_type)
        payload = {"type": kind, "text": describe(Any), "images": [], "audio": [], "video": []}
        try:
            if kind in ("IMAGE", "MASK"):
                payload["images"] = preview_images(Any, kind)
            elif kind == "AUDIO":
                payload["audio"] = preview_audio(Any)
            elif kind == "VIDEO" and isinstance(Any, Input.Video):
                path, reference = temp_file("mp4")
                Any.save_to(path, format=Types.VideoContainer.MP4, codec=Types.VideoCodec.H264)
                payload["video"] = [reference]
            elif kind == "VIDEO":
                payload["text"] += "\n该视频格式不支持直接预览，已保留原始数据透传。"
        except InterruptProcessingException:
            raise
        except Exception as error:
            # Preview is optional; a failed media conversion must not block data flow.
            logging.warning("[GoohaiTools] 展示任意 GH 预览失败: %s", error)
            payload["text"] += f"\n预览失败（仍原样透传）：{error}"
        return {"ui": {"gh_display": [payload]}, "result": (Any,)}


NODE_CLASS_MAPPINGS = {NODE_TYPE: GoohaiDisplayAny}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_TYPE: "展示任意 GH"}

PromptServer.instance.add_on_prompt_handler(select_display_targets)



