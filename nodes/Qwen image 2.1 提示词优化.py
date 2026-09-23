from __future__ import annotations

import os
import threading
import sys
from pathlib import Path

import folder_paths

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from resources.qwen_image_model_scan import select_models  # noqa: E402
from resources.qwen_image_runtime import (  # noqa: E402
    I2I_SYSTEM_PROMPT,
    T2I_SYSTEM_PROMPT,
    QwenImageRuntime,
    append_transparency,
    collect_images,
    prompt_text_from_result,
    json_text_from_result,
    random_seed,
    reverse_prompt_instruction,
    rewrite_user_prompt_for_transparency,
    _rewrite_language_rules,
)


_SEED_LOCK = threading.RLock()
_LAST_SEEDS: dict[str, int] = {}


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
                "种子值": (["固定", "随机"], {"default": "固定"}),
                "卸载模型": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                **{f"图像_{index:02d}": ("IMAGE",) for index in range(1, 11)},
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt", "json")
    FUNCTION = "optimize"
    CATEGORY = "孤海工具箱/提示词"

    @classmethod
    def IS_CHANGED(cls, 种子值="固定", **kwargs):
        return float("nan") if 种子值 == "随机" else None

    def optimize(
        self,
        用户提示词,
        文生图模型,
        图生图模型,
        视觉模型,
        输出语言,
        透明背景,
        种子值,
        卸载模型,
        unique_id=None,
        **kwargs,
    ):
        images = collect_images(kwargs)
        has_images = bool(images)
        # Empty user prompt plus valid images is reverse prompting. It uses the
        # I2I PE model as requested, while keeping the T2I reverse-description
        # task and output fields.
        reverse_mode = has_images and not str(用户提示词 or "").strip()
        if reverse_mode:
            # 有图但没有用户指令时仍执行“图像反推”，但按要求使用图生图
            # PE 模型；任务类型仍保持 T2I 反推格式，输出可用于文生图的提示词。
            model_display = 图生图模型
            base_system = T2I_SYSTEM_PROMPT
            prompt_input = reverse_prompt_instruction(bool(透明背景))
        elif has_images:
            model_display = 图生图模型
            base_system = I2I_SYSTEM_PROMPT
            prompt_input = str(用户提示词 or "").strip()
        else:
            model_display = 文生图模型
            base_system = T2I_SYSTEM_PROMPT
            prompt_input = str(用户提示词 or "").strip()

        # 透明背景必须在用户指令进入模型前参与语义处理。显式的“把 A
        # 背景改成 B”只替换目标 B，保留 A 作为原图中的待替换条件；普通
        # 独立背景描述才直接改成透明背景。
        if 透明背景 and not reverse_mode:
            prompt_input = rewrite_user_prompt_for_transparency(用户提示词, True)

        # 使用节点内置的完整 Qwen Image 原生系统提示词。它包含官方的
        # 构图、位置、材质、文字、比例和图像编辑规则，不能为了性能压缩。
        system_prompt = _rewrite_language_rules(
            base_system,
            输出语言,
            str(用户提示词 or ""),
            transparent_background=bool(透明背景),
        )
        model_path = _resolve(model_display, mmproj=False)
        # Qwen35ChatHandler 即使 T2I 不传图也需要 mmproj 才能正确套用
        # Qwen3.5 chat template；无图时不会向消息中加入 image_url。
        mmproj_path = _resolve(视觉模型, mmproj=True)

        key = str(unique_id or id(self))
        with _SEED_LOCK:
            if 种子值 == "随机" or key not in _LAST_SEEDS:
                _LAST_SEEDS[key] = random_seed()
            seed = _LAST_SEEDS[key]

        result = QwenImageRuntime.complete(
            model_path=model_path,
            mmproj_path=mmproj_path,
            system_prompt=system_prompt,
            user_prompt=prompt_input,
            images=images,
            prompt_mode="I2I" if (has_images and not reverse_mode) else "T2I",
            seed=seed,
            unload=bool(卸载模型),
            output_language=输出语言,
            original_user_prompt=str(用户提示词 or ""),
            transparent_background=bool(透明背景),
        )
        return (
            prompt_text_from_result(result, bool(透明背景)),
            json_text_from_result(result, bool(透明背景)),
        )


NODE_CLASS_MAPPINGS = {"QwenImagePromptOptimizer": QwenImagePromptOptimizer}
NODE_DISPLAY_NAME_MAPPINGS = {"QwenImagePromptOptimizer": "Qwen image 2.1 提示词优化"}
