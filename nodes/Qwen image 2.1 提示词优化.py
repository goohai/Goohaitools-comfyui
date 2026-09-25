from __future__ import annotations

import sys
from pathlib import Path

import folder_paths

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from resources.qwen_image_model_scan import select_models
from resources.qwen_image_runtime import (
    I2I_SYSTEM_PROMPT,
    REVERSE_SYSTEM_PROMPT,
    T2I_SYSTEM_PROMPT,
    QwenImageRuntime,
    append_transparency,
    collect_images,
    prompt_text_from_result,
    json_text_from_result,
    reverse_prompt_instruction,
    rewrite_user_prompt_for_transparency,
    _rewrite_language_rules,
)


def _models_dir() -> str:
    return str(Path(folder_paths.models_dir))


def _choices(mmproj: bool) -> list[str]:
    return [item.display for item in select_models(_models_dir(), mmproj=mmproj)]


def _preferred(choices: list[str], marker: str) -> str:
    marker = marker.casefold()
    return next((item for item in choices if marker in item.casefold()), choices[0])


def _resolve(display: str, mmproj: bool) -> str:
    for item in select_models(_models_dir(), mmproj=mmproj):
        if item.display == display:
            return item.path
    raise ValueError(f"找不到所选模型：{display}")


class QwenImagePromptOptimizer:
    @classmethod
    def INPUT_TYPES(cls):
        t2i = _choices(False)
        mmproj = _choices(True)
        if not t2i:
            t2i = ["未找到 qwen35 GGUF 模型"]
        if not mmproj:
            mmproj = ["未找到 mmproj GGUF 模型"]
        return {
            "required": {
                "用户提示词": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "文生图模型": (t2i, {"default": _preferred(t2i, "PE-T2I")}),
                "图生图模型": (t2i, {"default": _preferred(t2i, "PE-I2I")}),
                "视觉模型": (mmproj, {"default": _preferred(mmproj, "PE-I2I")}),
                "输出语言": (["自动", "中文", "English"], {"default": "自动"}),
                "透明背景": ("BOOLEAN", {"default": False}),
                "种子值": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                "种子模式": (["固定", "随机"], {"default": "固定"}),
                "卸载模型": (["自动", "保持加载", "运行后自动卸载", "运行前后自动卸载"], {"default": "自动"}),
            },
            "optional": {
                **{f"图像_{index:02d}": ("IMAGE",) for index in range(1, 11)},
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "STRING", "BOOLEAN")
    RETURN_NAMES = ("prompt", "json", "是否反推")
    FUNCTION = "optimize"
    CATEGORY = "孤海工具箱/提示词"

    @classmethod
    def IS_CHANGED(cls, 种子值=0, **kwargs):
        return max(0, min(0xFFFFFFFF, int(种子值)))

    def optimize(
        self,
        用户提示词,
        文生图模型,
        图生图模型,
        视觉模型,
        输出语言,
        透明背景,
        种子值,
        种子模式="固定",
        卸载模型="自动",
        unique_id=None,
        **kwargs,
    ):
        if isinstance(卸载模型, bool):
            卸载模型 = "运行后自动卸载" if 卸载模型 else "保持加载"
        images = collect_images(kwargs)
        has_images = bool(images)
        reverse_mode = has_images and not str(用户提示词 or "").strip()
        first_image_only = (
            reverse_mode
            and len(images) == 1
            and any(kwargs.get(name) is not None for name in ("图像_01", "image_01"))
        )
        if reverse_mode:
            model_display = 文生图模型
            base_system = REVERSE_SYSTEM_PROMPT
            prompt_input = reverse_prompt_instruction(bool(透明背景))
        elif has_images:
            model_display = 图生图模型
            base_system = I2I_SYSTEM_PROMPT
            prompt_input = str(用户提示词 or "").strip()
        else:
            model_display = 文生图模型
            base_system = T2I_SYSTEM_PROMPT
            prompt_input = str(用户提示词 or "").strip()

        if 透明背景 and not reverse_mode:
            prompt_input = rewrite_user_prompt_for_transparency(用户提示词, True)

        system_prompt = _rewrite_language_rules(
            base_system,
            输出语言,
            str(用户提示词 or ""),
            transparent_background=bool(透明背景),
            reverse_mode=reverse_mode,
        )
        model_path = _resolve(model_display, mmproj=False)
        mmproj_path = _resolve(视觉模型, mmproj=True)

        seed = max(0, min(0xFFFFFFFF, int(种子值)))

        result = QwenImageRuntime.complete(
            model_path=model_path,
            mmproj_path=mmproj_path,
            system_prompt=system_prompt,
            user_prompt=prompt_input,
            images=images,
            prompt_mode="I2I" if (has_images and not reverse_mode) else "T2I",
            seed=seed,
            unload_mode=卸载模型,
            reverse_mode=reverse_mode,
            reverse_resize_2048=first_image_only,
            output_language=输出语言,
            original_user_prompt=str(用户提示词 or ""),
            transparent_background=bool(透明背景),
        )
        return {
            "ui": {"seed": [seed]},
            "result": (
                prompt_text_from_result(result, bool(透明背景)),
                json_text_from_result(result, bool(透明背景)),
                reverse_mode,
            ),
        }


NODE_CLASS_MAPPINGS = {"QwenImagePromptOptimizer": QwenImagePromptOptimizer}
NODE_DISPLAY_NAME_MAPPINGS = {"QwenImagePromptOptimizer": "Qwen image 2.1 提示词优化"}
