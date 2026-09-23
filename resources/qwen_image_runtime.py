"""Private llama.cpp runtime for the Qwen Image 2.1 prompt optimizer."""

from __future__ import annotations

import gc
import importlib.util
import io
import json
import os
import re
import secrets
import sys
import threading
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

try:
    import comfy.model_management as model_management
except Exception:  # pragma: no cover - allows import-time diagnostics outside ComfyUI
    model_management = None

try:
    import llama_cpp
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import Qwen35ChatHandler
except Exception as exc:  # pragma: no cover
    llama_cpp = None
    Llama = None
    Qwen35ChatHandler = None
    _LLAMA_IMPORT_ERROR = exc
else:
    _LLAMA_IMPORT_ERROR = None


UINT32_MAX = 0xFFFFFFFF
TRANSPARENT_PREFIX = "This is an RGBA image with transparency. "
TRANSPARENT_SUFFIX = " The image has alpha channel and the background is transparent."
DEFAULT_MAX_OUTPUT_TOKENS = 2048


def _load_resource_module(name: str, filename: str):
    root = Path(__file__).resolve().parent
    path = root / filename
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load embedded prompt resource: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_T2I_PROMPT = _load_resource_module("goohai_qwen_prompt_t2i", "qwen_image_system_prompt_t2i.py").get_prompt()
_I2I_PROMPT = _load_resource_module("goohai_qwen_prompt_i2i", "qwen_image_system_prompt_i2i.py").get_prompt()

T2I_SYSTEM_PROMPT = _T2I_PROMPT
I2I_SYSTEM_PROMPT = _I2I_PROMPT


def _language_instruction(language: str, user_prompt: str) -> str:
    if language == "中文":
        return (
            "\n\nHIGH PRIORITY OUTPUT-LANGUAGE OVERRIDE: Write all descriptive prose in "
            "rewritten_prompt in Chinese. This override controls only the descriptive "
            "prose outside double quotes. Text that will visibly appear inside the image "
            "must follow the image-text language rules already given above."
        )
    if language == "English":
        return (
            "\n\nHIGH PRIORITY OUTPUT-LANGUAGE OVERRIDE: Write all descriptive prose in "
            "rewritten_prompt in English. This override controls only the descriptive "
            "prose outside double quotes. Text that will visibly appear inside the image "
            "must follow the image-text language rules already given above."
        )
    has_cjk = bool(re.search(r"[\u3400-\u9fff]", user_prompt or ""))
    selected = "Chinese" if (has_cjk or not str(user_prompt or "").strip()) else "English"
    return (
        "\n\nHIGH PRIORITY OUTPUT-LANGUAGE OVERRIDE: The output language is automatic. "
        f"Write all descriptive prose in rewritten_prompt in {selected}, based on the "
        "main language of the user's instruction. This controls only descriptive prose "
        "outside double quotes. Text visibly rendered in the image must follow the "
        "image-text language rules already given above."
    )


def _language_override_text(language: str, user_prompt: str) -> str:
    if language == "中文":
        return "Chinese"
    if language == "English":
        return "English"
    return "Chinese" if (re.search(r"[\u3400-\u9fff]", user_prompt or "") or not str(user_prompt or "").strip()) else "English"


def _selected_output_language(language: str, user_prompt: str) -> str:
    """Resolve the node's language selector to the language used by the model."""
    return _language_override_text(language, user_prompt)


def _wrap_user_prompt_for_language(
    user_prompt: str,
    language: str,
    original_user_prompt: str,
    transparent_background: bool = False,
) -> str:
    """Add a last-mile language instruction next to the actual user request.

    Qwen can imitate the language of a multimodal user message even when the
    system prompt asks for another language.  Keeping this instruction in the
    same user turn makes the requested output language unambiguous while
    explicitly preserving text that is meant to be rendered in the image.
    """
    selected = _selected_output_language(language, original_user_prompt)
    image_text_rule = (
        "Keep exact text that must visibly appear in the image in the requested "
        "original language and characters; this exception applies only to that "
        "quoted image text, never to the descriptive prose."
    )
    transparency_directive = ""
    transparency_final_directive = ""
    if transparent_background:
        transparency_directive = (
            " TRANSPARENT BACKGROUND OVERRIDE: ignore any requested or observed "
            "background color, background material, backdrop, wall, floor, room, "
            "landscape, or other opaque background. The final description must use "
            "only a fully transparent background and must not retain those background "
            "details. Remove sky, clouds, cloud layers, scenery, and all other "
            "environmental background details, including details inferred from the "
            "reference image."
        )
        # Put the constraint after the user request as well.  In reverse prompting
        # the model may append a long visual description after its first mention
        # of the background; a final instruction is much harder to overlook.
        transparency_final_directive = (
            "\n\nFINAL TRANSPARENT-BACKGROUND CONSTRAINT (must be obeyed after reviewing "
            "the image): The final rewritten_prompt must describe a fully transparent "
            "background only. Do not include any contradictory background or scene "
            "description, including sky, clouds, cloud layers, horizon, landscape, "
            "walls, floors, rooms, tables, backdrops, gradients, or background colors. "
            "最终输出透明背景，不要出现任何与透明背景矛盾的背景描述。"
        )
    return (
        "OUTPUT LANGUAGE DIRECTIVE (highest priority for this user turn): "
        f"Write the descriptive prose in rewritten_prompt entirely in {selected}. "
        "The language used by the user request below is irrelevant and must not "
        "be copied or used to choose the prose language."
        + transparency_directive
        + " "
        f"{image_text_rule}\n\n"
        "USER REQUEST (follow its meaning, not its language):\n"
        f"{user_prompt}"
        + transparency_final_directive
    )


def _rewrite_language_rules(
    prompt: str,
    language: str,
    user_prompt: str,
    transparent_background: bool = False,
) -> str:
    # Replace the complete descriptive-prose policy. The I2I prompt uses an
    # uppercase `Output Format` heading and the T2I prompt begins with an
    # English-only sentence, so matching only one exact heading is insufficient.
    selected = _language_override_text(language, user_prompt)
    i2i_a = r"\*\*\(A\) Language of the rewritten prompt's DESCRIPTIVE prose.*?(?=\n\s*\*\*\(B\) Language of the TEXT THAT WILL BE RENDERED INTO THE OUTPUT IMAGE)"
    if re.search(i2i_a, prompt, flags=re.DOTALL):
        prompt = re.sub(
            i2i_a,
            "**(A) Language of the rewritten prompt's DESCRIPTIVE prose — "
            f"write every descriptive word in {selected}. This rule is controlled by "
            "the node output-language selector.**\n\n",
            prompt,
            count=1,
            flags=re.DOTALL,
        )
    else:
        t2i_language = r"## Language\s+.*?(?=\n## Output format)"
        if re.search(t2i_language, prompt, flags=re.DOTALL | re.IGNORECASE):
            prompt = re.sub(
                t2i_language,
                "## Language\n\n"
                f"The descriptive prose must be written in {selected}. "
                "Only text explicitly required to appear inside the image keeps "
                "its requested or source-image language.\n",
                prompt,
                count=1,
                flags=re.DOTALL | re.IGNORECASE,
            )
        prompt = prompt.replace("one long English paragraph", "one long paragraph")
    # 原生提示词可能在语言章节之外重复写入 English/Chinese 判断；仅在末尾
    # 追加覆盖容易被这些前置规则干扰。因此把最终语言规则写成独立、明确的
    # 最高优先级指令，并明确区分描述性提示词和图片内文字。
    language_lock = (
        "The descriptive prose must be entirely in English. Do not write Chinese, "
        "except inside double quotes when Chinese is the exact text that must appear "
        "in the image."
        if selected == "English"
        else "The descriptive prose must be entirely in Chinese. Do not write English, "
        "except for proper nouns, standardized units, or exact text that must appear "
        "in the image."
        if selected == "Chinese"
        else ""
    )
    transparency_lock = ""
    if transparent_background:
        transparency_lock = (
            "\n\nSYSTEM OVERRIDE — TRANSPARENT BACKGROUND: The output describes a native "
            "RGBA image on a fully transparent canvas. Describe the requested subject "
            "as isolated from any scene. Do not describe, preserve, or invent any opaque "
            "or colored background, including black, white, gray, colored backdrops, "
            "walls, floors, tables, rooms, landscapes, gradients, borders, or a solid "
            "background. If the user requests or the reference image contains a "
            "contradictory background, replace that background instruction with a fully "
            "transparent background. Do not add a background-colored fill behind the "
            "subject. The only background state is transparency. The runtime will wrap "
            "the final descriptive prose with the exact required RGBA sentences; do not "
            "add those wrapper sentences yourself. Any sky, cloud, cloud layer, horizon, "
            "landscape, wall, floor, room, table, backdrop, gradient, or background-color "
            "description is contradictory and must be removed, even if it was inferred "
            "from the reference image."
        )
    return prompt + (
        "\n\nSYSTEM OVERRIDE — OUTPUT LANGUAGE: The `rewritten_prompt` value must be "
        f"written in {selected}. Ignore every earlier instruction that chooses a "
        "different language for the descriptive prose. This does not translate exact "
        "text that must appear inside the image: preserve user-requested or source-image "
        "text in its required original language and characters. "
        + language_lock
        + transparency_lock
        + " Output JSON only."
    )


def _protect_colored_background_terms(text: str, protected: list[str]) -> str:
    """Temporarily protect source-background descriptions in edit commands.

    In a sentence such as ``把白色背景改成蓝色天空``, ``白色背景`` describes
    what exists in the input image; it is not the requested output background.
    Generic background cleanup must therefore not see that phrase after the
    edit target has been changed to transparency.
    """
    value = text
    zh_term = re.compile(
        rf"(?:纯净的|均匀的|均匀纯净的|浅色的|深色的|纯色的|纯|浅|深)?"
        rf"(?:{_BACKGROUND_COLORS_ZH})色?"
        rf"[\u4e00-\u9fffA-Za-z-]{{0,6}}"
        rf"(?:背景|背景色|背景颜色|背景板|背景布|背景区域)"
    )
    en_term = re.compile(
        rf"(?:{_BACKGROUND_COLORS_EN})(?:\s+[\w-]+){{0,4}}\s+"
        rf"(?:background|backdrop)\b",
        re.IGNORECASE,
    )

    def stash(match: re.Match[str]) -> str:
        token = f"__GOOHAI_SOURCE_BACKGROUND_{len(protected)}__"
        protected.append(match.group(0))
        return token

    value = zh_term.sub(stash, value)
    value = en_term.sub(stash, value)
    return value


def _restore_protected_background_terms(text: str, protected: list[str]) -> str:
    value = text
    for index, original in enumerate(protected):
        value = value.replace(f"__GOOHAI_SOURCE_BACKGROUND_{index}__", original)
    return value


def _rewrite_background_edit_targets(text: str, protected: list[str]) -> str:
    """Change only the destination of explicit background-edit commands.

    The left side of an edit relation remains intact.  This is the important
    distinction between ``把白色背景改成蓝色天空`` and a plain ``白色背景``
    description.
    """
    value = str(text or "")
    zh_action = re.compile(
        r"(?P<head>(?:请\s*)?(?:把|将)\s*[^，。；\n]*?"
        r"(?:背景|背景色|背景颜色|背景板|背景布|背景区域)"
        r"[^，。；\n]*?(?:改为|改成|换成|替换为|替换成|变为|变成|设置为|设为)\s*)"
        r"(?P<target>[^，。；\n]+)"
    )

    def rewrite_zh(match: re.Match[str]) -> str:
        head = _protect_colored_background_terms(match.group("head"), protected)
        return head + "透明背景"

    value = zh_action.sub(rewrite_zh, value)

    en_action = re.compile(
        r"(?P<head>\b(?:change|replace|turn|make|set|switch)\b"
        r"[^,.!?;\n]*?\b(?:background|backdrop)(?:\s+color)?\b"
        r"[^,.!?;\n]*?\b(?:to|into|with)\b\s*)"
        r"(?P<target>[^,.!?;\n]+)",
        re.IGNORECASE,
    )

    def rewrite_en(match: re.Match[str]) -> str:
        head = _protect_colored_background_terms(match.group("head"), protected)
        return head + "a transparent background"

    return en_action.sub(rewrite_en, value)


def _rewrite_direct_background_descriptions(text: str) -> str:
    """Rewrite non-relational background descriptions to transparency."""
    value = text

    # ``背景为红色`` / ``背景颜色是黑色布料``.  The clause ends at normal
    # Chinese punctuation, so nearby subject details are retained.
    zh_clause = re.compile(
        rf"背景(?:颜色)?\s*(?:是|为|呈|：|:)\s*"
        rf"[^，。；\n]*?(?:{_BACKGROUND_COLORS_ZH})色?"
        rf"[^，。；\n]*?(?=[，。；\n]|$)"
    )
    value = zh_clause.sub("背景为透明", value)

    # ``黑色布料背景`` / ``纯白色背景``.
    zh_phrase = re.compile(
        rf"(?:纯净的|均匀的|均匀纯净的|浅色的|深色的|纯色的|纯|浅|深)?"
        rf"(?:{_BACKGROUND_COLORS_ZH})色?"
        rf"[\u4e00-\u9fffA-Za-z-]{{0,6}}"
        rf"(?:背景|背景色|背景颜色|背景板|背景布|背景区域)"
    )
    value = zh_phrase.sub("透明背景", value)

    en_clause = re.compile(
        rf"\b(?:the\s+)?background(?:\s+color)?\s+"
        rf"(?:is|was|becomes|became|changed\s+to|changed\s+into|"
        rf"replaced\s+with|set\s+to)\s+"
        rf"[^,.!?;\n]*?(?:{_BACKGROUND_COLORS_EN})"
        rf"[^,.!?;\n]*?(?=[,.!?;\n]|$)",
        re.IGNORECASE,
    )
    value = en_clause.sub("The background is transparent", value)

    en_phrase = re.compile(
        rf"\b(?:on|against|over|with)\s+(?:a|an|the)\s+"
        rf"(?:[\w-]+\s+){{0,4}}?(?:{_BACKGROUND_COLORS_EN})"
        rf"\s+(?:colored\s+)?(?:background|backdrop)\b",
        re.IGNORECASE,
    )
    value = en_phrase.sub("on a transparent background", value)
    en_simple = re.compile(
        rf"\b(?:{_BACKGROUND_COLORS_EN})(?:\s+[\w-]+){{0,4}}\s+"
        rf"(?:background|backdrop)\b",
        re.IGNORECASE,
    )
    value = en_simple.sub("transparent background", value)
    return value


def rewrite_user_prompt_for_transparency(user_prompt: object, enabled: bool) -> str:
    """Preprocess the user's request before it reaches the vision-language model.

    Explicit edit relations preserve their source condition and replace only
    the requested destination.  Standalone background descriptions are
    rewritten directly.  This is deliberately separate from the final
    fallback so the model receives the corrected intent during reasoning.
    """
    value = str(user_prompt or "").strip()
    if not enabled or not value:
        return value
    protected: list[str] = []
    value = _rewrite_background_edit_targets(value, protected)
    value = _rewrite_direct_background_descriptions(value)
    return _restore_protected_background_terms(value, protected).strip()


def _tensor_images(value: object) -> list[torch.Tensor]:
    if value is None or not torch.is_tensor(value):
        return []
    if value.numel() == 0 or value.ndim != 4:
        return []
    _, height, width, channels = value.shape
    if height <= 0 or width <= 0 or channels < 3:
        return []
    return [value[index] for index in range(value.shape[0])]


def collect_images(inputs: dict[str, object]) -> list[torch.Tensor]:
    indexed: list[tuple[int, object]] = []
    for name, value in inputs.items():
        match = re.search(r"(\d+)$", str(name))
        normalized_name = str(name).casefold().replace("_", "")
        if match and (normalized_name.startswith("image") or normalized_name.startswith("图像")):
            indexed.append((int(match.group(1)), value))
    images: list[torch.Tensor] = []
    for _, value in sorted(indexed):
        images.extend(_tensor_images(value))
    if len(images) > 10:
        raise ValueError("Qwen image 2.1 提示词优化：图像总数超过 10 张。")
    return images


def _image_data_url(image: torch.Tensor, max_size: int) -> str:
    array = image.detach().cpu().float().clamp(0, 1).numpy()
    array = (array[..., :3] * 255.0 + 0.5).astype(np.uint8)
    pil = Image.fromarray(array, mode="RGB")
    scale = min(1.0, max_size / max(pil.width, pil.height))
    if scale < 1.0:
        pil = pil.resize((max(1, round(pil.width * scale)), max(1, round(pil.height * scale))), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    # 视觉编码器不要求 PNG；关闭 PNG optimize 并使用高质量 JPEG 可显著
    # 减少单图运行时的 CPU 编码时间，同时仍满足长边不超过 1024 的要求。
    pil.save(buffer, format="JPEG", quality=95, optimize=False)
    import base64
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?(?:</think>|$)", "", text or "", flags=re.DOTALL).strip()


def _parse_json(text: str) -> dict[str, object]:
    clean = _strip_thinking(text).strip()
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.IGNORECASE | re.DOTALL).strip()
    try:
        result = json.loads(clean)
    except Exception as exc:
        match = re.search(r"\{.*\}", clean, flags=re.DOTALL)
        if not match:
            raise ValueError(f"模型没有返回有效 JSON：{clean[:500]}") from exc
        result = json.loads(match.group(0))
    if not isinstance(result, dict):
        raise ValueError("模型 JSON 返回值不是对象。")
    return result


def _normalize_result(result: dict[str, object], editing_mode: bool) -> dict[str, object]:
    """Keep the public JSON shape stable even if the model omits an empty field."""
    normalized: dict[str, object] = {
        "rewritten_prompt": str(result.get("rewritten_prompt", "")).strip(),
        "wh_ratio": str(result.get("wh_ratio", "") or "").strip(),
    }
    if editing_mode:
        normalized["ratio_follow"] = str(result.get("ratio_follow", "") or "").strip()
    if not normalized["rewritten_prompt"]:
        raise ValueError("模型返回的 rewritten_prompt 为空。")
    return normalized


_BACKGROUND_COLORS_ZH = (
    "黑|白|灰|红|橙|黄|绿|青|蓝|紫|粉|棕|褐|米|金|银|彩色|多彩|有色"
)
_BACKGROUND_COLORS_EN = (
    "black|white|gray|grey|red|orange|yellow|green|cyan|blue|purple|violet|"
    "pink|brown|beige|gold|silver|colored|colourful|colorful|multicolored|"
    "multi-colored"
)


def _force_transparent_background_text(text: str) -> str:
    """Remove contradictory colored/opaque background descriptions.

    This is intentionally limited to phrases that explicitly refer to a
    background/backdrop.  It must not rewrite subject colors such as black hair
    or a red dress.
    """
    value = str(text or "").strip()
    if not value:
        return value

    # Use the same relation-aware pass as the input preprocessing.  This keeps
    # the source condition in edit instructions (for example, ``white
    # background``) while changing only the requested destination.  Only after
    # that pass do we rewrite standalone background descriptions.
    protected: list[str] = []
    value = _rewrite_background_edit_targets(value, protected)
    value = _rewrite_direct_background_descriptions(value)
    value = _restore_protected_background_terms(value, protected)
    value = _remove_transparent_background_residue(value)
    value = re.sub(r"背景为透明背景", "背景为透明", value)
    value = re.sub(
        r"transparent background with (?:a |an |the )?(?:"
        + _BACKGROUND_COLORS_EN
        + r")\b",
        "transparent background",
        value,
        flags=re.IGNORECASE,
    )
    return value.strip()


_TRANSPARENT_RESIDUE_ZH = (
    "天空|云层|云朵|云彩|积云|白云|乌云|地平线|风景|景色|"
    "墙面|墙壁|地面|地板|桌面|房间|室内|户外|背景板|背景布|"
    "渐变背景|背景渐变"
)
_TRANSPARENT_RESIDUE_EN = (
    "sky|clouds?|cloud layer|cloudscape|horizon|landscape|scenery|"
    "wall|floor|tabletop|table|room|interior|outdoor|backdrop|"
    "background gradient|gradient background"
)


def _remove_transparent_background_residue(text: str) -> str:
    """Remove residual environment clauses left by image reverse prompting.

    The model can correctly write ``背景为透明`` and then continue with
    ``白色积云、蔚蓝色天空``.  These clauses are not standalone color phrases,
    so the normal background matcher cannot catch them.  We remove only
    punctuation-delimited clauses containing explicit environment terms and do
    not touch subject colors or lighting clauses.
    """
    value = str(text or "")
    zh_clause = re.compile(
        rf"(?:^|(?<=[，。；、]))[^，。；\n]*?(?:{_TRANSPARENT_RESIDUE_ZH})"
        rf"[^，。；\n]*(?=[，。；\n]|$)"
    )
    en_clause = re.compile(
        rf"(?:^|(?<=[,.!?;]))[^,.!?;\n]*?(?:\b(?:{_TRANSPARENT_RESIDUE_EN})\b)"
        rf"[^,.!?;\n]*(?=[,.!?;\n]|$)",
        re.IGNORECASE,
    )
    value = zh_clause.sub("", value)
    value = en_clause.sub("", value)
    # Removing several adjacent clauses can leave their separators behind.
    # Normalize them without changing meaningful spaces inside English text.
    value = re.sub(r"[ \t]*([，。；、,.!?;])[ \t]*", r"\1", value)
    value = re.sub(r"([，。；、,.!?;])(?:[，。；、,.!?;])+", r"\1", value)
    value = re.sub(r"([,.!?;])(?=\S)", r"\1 ", value)
    value = re.sub(r"[ \t]{2,}", " ", value)
    return value.strip(" ，。；、,.!?;")


def _schema(image_mode: bool) -> dict[str, object]:
    properties: dict[str, object] = {
        "rewritten_prompt": {"type": "string"},
        "wh_ratio": {"type": "string"},
    }
    required = ["rewritten_prompt", "wh_ratio"]
    if image_mode:
        properties["ratio_follow"] = {"type": "string"}
        required.append("ratio_follow")
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


class QwenImageRuntime:
    _lock = threading.RLock()
    _llm = None
    _chat_handler = None
    _signature: tuple[str, str, int] | None = None

    @classmethod
    def _close_locked(cls) -> None:
        llm = cls._llm
        handler = cls._chat_handler
        cls._llm = None
        cls._chat_handler = None
        cls._signature = None
        if llm is not None:
            try:
                llm.close()
            except Exception:
                pass
        if handler is not None:
            try:
                exit_stack = getattr(handler, "_exit_stack", None)
                if exit_stack is not None:
                    exit_stack.close()
            except Exception:
                pass
        gc.collect()
        if model_management is not None:
            try:
                model_management.soft_empty_cache()
            except Exception:
                pass

    @classmethod
    def _ensure(
        cls,
        model_path: str,
        mmproj_path: str | None,
        image_mode: bool,
        context_size: int,
    ):
        if Llama is None:
            raise RuntimeError(f"llama-cpp-python 不可用：{_LLAMA_IMPORT_ERROR}")
        signature = (
            os.path.abspath(model_path),
            os.path.abspath(mmproj_path) if mmproj_path else "",
            int(context_size),
        )
        with cls._lock:
            if cls._llm is not None and cls._signature == signature:
                return cls._llm
            cls._close_locked()
            handler = None
            if mmproj_path:
                if not mmproj_path:
                    raise ValueError("图像模式需要选择视觉模型 mmproj。")
                if Qwen35ChatHandler is None:
                    raise RuntimeError("当前 llama-cpp-python 没有 Qwen35ChatHandler。")
                handler = Qwen35ChatHandler(
                    mmproj_path=mmproj_path,
                    add_vision_id=image_mode,
                    enable_thinking=False,
                    verbose=False,
                )
            else:
                # Qwen3.5 的 chat template 在无 mmproj 时也必须通过 handler
                # 节点统一禁用 Qwen3.5 thinking，保持较快的提示词优化路径。
                handler = Qwen35ChatHandler(
                    enable_thinking=False,
                    verbose=False,
                )
            cls._llm = Llama(
                model_path=model_path,
                chat_handler=handler,
                # 与 ComfyUI-llama-cpp_vlm 的默认实现保持一致；部分 llama.cpp
                # 构建中整数 -1 比字符串 all 更稳定地触发全量 GPU offload。
                n_gpu_layers=-1,
                n_ctx=int(context_size),
                n_batch=2048,
                n_ubatch=512,
                verbose=False,
            )
            cls._chat_handler = handler
            cls._signature = signature
            return cls._llm

    @classmethod
    def complete(
        cls,
        *,
        model_path: str,
        mmproj_path: str | None,
        system_prompt: str,
        user_prompt: str,
        images: list[torch.Tensor],
        prompt_mode: str,
        seed: int,
        unload: bool,
        reverse_mode: bool = False,
        output_language: str = "自动",
        original_user_prompt: str = "",
        transparent_background: bool = False,
    ) -> dict[str, object]:
        vision_mode = bool(images)
        editing_mode = prompt_mode == "I2I"
        with cls._lock:
            started_at = time.perf_counter()
            # 保留完整原生系统提示词，同时按图像数量平衡视觉信息、上下文
            # 容量和速度：单图 768；2-4 张 512；5-10 张 256。
            image_count = len(images)
            if image_count == 0:
                context_size = 8192
                image_max_size = 0
            elif image_count == 1:
                context_size = 8192
                image_max_size = 768
            elif image_count <= 4:
                context_size = 16384
                image_max_size = 512
            else:
                context_size = 32768
                image_max_size = 256
            llm = cls._ensure(model_path, mmproj_path, vision_mode, context_size)
            loaded_at = time.perf_counter()
            language_wrapped_prompt = _wrap_user_prompt_for_language(
                user_prompt,
                output_language,
                original_user_prompt,
                transparent_background=bool(transparent_background),
            )
            content: list[dict[str, object]] = [{"type": "text", "text": language_wrapped_prompt}]
            for image in images:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": _image_data_url(image, image_max_size)},
                })
            encoded_at = time.perf_counter()
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content if vision_mode else language_wrapped_prompt},
            ]
            try:
                completion_kwargs = {
                    "messages": messages,
                    "seed": int(seed),
                    "temperature": 0.3,
                    "top_p": 0.9,
                    "top_k": 30,
                    "min_p": 0.05,
                    "max_tokens": DEFAULT_MAX_OUTPUT_TOKENS,
                    "reasoning_budget": 0,
                }
                # 完整原生提示词已经明确要求 JSON。常规路径不启用 JSON grammar，
                # 以匹配参考节点并避免长系统提示词下的 grammar 解码开销；只有
                # 首次返回无法解析时才重试 JSON grammar。
                result = llm.create_chat_completion(**completion_kwargs)
                text = result["choices"][0]["message"]["content"]
                try:
                    parsed = _normalize_result(_parse_json(text), editing_mode)
                except ValueError:
                    # 失败重试前清掉上一次请求的 KV 状态。否则第二次完整消息
                    # 会接在第一次异常/截断输出后面，容易出现 non-consecutive
                    # token、再次截断，或视觉模型输出分析文本而不是 JSON。
                    cls._clear_state_locked(llm)
                    # 恢复请求继续显式保持 reasoning_budget=0，并使用完整
                    # schema，确保只生成所需字段。正常请求不走 grammar，保持
                    # 与参考节点相近的速度。
                    completion_kwargs["reasoning_budget"] = 0
                    completion_kwargs["response_format"] = {
                        "type": "json_object",
                        "schema": _schema(editing_mode),
                    }
                    completion_kwargs["max_tokens"] = DEFAULT_MAX_OUTPUT_TOKENS
                    retry = llm.create_chat_completion(**completion_kwargs)
                    text = retry["choices"][0]["message"]["content"]
                    parsed = _normalize_result(_parse_json(text), editing_mode)
                    result = retry
                completed_at = time.perf_counter()
                usage = result.get("usage", {}) if isinstance(result, dict) else {}
                print(
                    "[Goohai Qwen] "
                    f"load={loaded_at - started_at:.2f}s, "
                    f"image={encoded_at - loaded_at:.2f}s, "
                    f"infer={completed_at - encoded_at:.2f}s, "
                    f"total={completed_at - started_at:.2f}s, images={len(images)}, "
                    f"prompt_tokens={usage.get('prompt_tokens', '?')}, "
                    f"completion_tokens={usage.get('completion_tokens', '?')}"
                )
            finally:
                cls._clear_state_locked(llm)
                if unload:
                    cls._close_locked()
            return parsed

    @staticmethod
    def _clear_state_locked(llm) -> None:
        """Clear Qwen3.5 KV state like the reference node without unloading weights."""
        try:
            if hasattr(llm, "n_tokens"):
                llm.n_tokens = 0
        except Exception:
            pass
        ctx = getattr(llm, "_ctx", None)
        if ctx is not None:
            for name, args in (("kv_cache_clear", ()), ("memory_clear", (True,))):
                fn = getattr(ctx, name, None)
                if callable(fn):
                    try:
                        fn(*args)
                        break
                    except Exception:
                        continue

    @classmethod
    def close(cls) -> None:
        with cls._lock:
            cls._close_locked()


def _install_comfy_unload_hook() -> None:
    """让 ComfyUI 官方卸载模型同时释放本节点的 llama.cpp 实例。

    这里包装当前已有的 unload_all_models，而不是替换它，因此与其他插件
    的卸载 wrapper 可以按任意加载顺序串联执行。
    """
    if model_management is None or getattr(model_management, "_goohai_qwen_unload_hook", False):
        return
    original = getattr(model_management, "unload_all_models", None)
    if original is None:
        return

    def wrapped(*args, **kwargs):
        QwenImageRuntime.close()
        return original(*args, **kwargs)

    model_management.unload_all_models = wrapped
    model_management._goohai_qwen_unload_hook = True


_install_comfy_unload_hook()


def random_seed() -> int:
    return secrets.randbelow(UINT32_MAX + 1)


def append_transparency(prompt: str, enabled: bool) -> str:
    if not enabled:
        return prompt
    text = str(prompt or "").strip()
    prefix = TRANSPARENT_PREFIX.strip()
    suffix = TRANSPARENT_SUFFIX.strip()
    # The model is instructed to return only the body.  Still remove wrappers
    # if it emits them, so prompt and json always have exactly one fixed head
    # and one fixed tail.
    while text.startswith(prefix):
        text = text[len(prefix):].lstrip()
    while text.endswith(suffix):
        text = text[:-len(suffix)].rstrip()
    text = _force_transparent_background_text(text)
    return f"{TRANSPARENT_PREFIX}{text}{TRANSPARENT_SUFFIX}"


def prompt_text_from_result(result: dict[str, object], transparency: bool) -> str:
    prompt = str(result.get("rewritten_prompt", "")).strip()
    if not prompt:
        raise ValueError("模型返回的 rewritten_prompt 为空。")
    return append_transparency(prompt, transparency)


def json_text_from_result(result: dict[str, object], transparency: bool = False) -> str:
    """Return the model result as compact JSON for downstream JSON-aware nodes."""
    output = dict(result)
    output["rewritten_prompt"] = append_transparency(
        str(output.get("rewritten_prompt", "")),
        transparency,
    )
    return json.dumps(output, ensure_ascii=False, separators=(",", ":"))


def reverse_prompt_instruction(transparent_background: bool = False) -> str:
    instruction = (
        "The user instruction is empty. This is an image-to-prompt reverse-description task: "
        "inspect every supplied input image and write a detailed, faithful text-to-image "
        "prompt that could generate a visually similar image. Do not invent edits, do not "
        "mention the analysis process, and describe observable subject, composition, "
        "lighting, colors, materials, style, and readable image text."
    )
    if transparent_background:
        instruction += (
            " Ignore the reference image's opaque or colored background and do not describe "
            "sky, clouds, cloud layers, scenery, walls, floors, rooms, landscapes, or any "
            "other environmental background. The final output must use only a fully "
            "transparent background. FINAL RULE: 最终输出透明背景，不要出现任何与透明背景 "
            "矛盾的背景描述。"
        )
    return instruction
