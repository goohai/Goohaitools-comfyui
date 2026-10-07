from __future__ import annotations

import asyncio
import importlib.metadata
import json
import platform
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import folder_paths
from aiohttp import web
from server import PromptServer

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _ensure_llm_folder_registry() -> None:
    """Match llama-cpp's LLM registry, while remaining usable without that node."""
    registry = getattr(folder_paths, "folder_names_and_paths", {})
    if "LLM" not in registry:
        roots = [
            str(Path(folder_paths.models_dir) / "LLM"),
            str(Path(folder_paths.models_dir) / "llm"),
        ]
        folder_paths.folder_names_and_paths["LLM"] = (roots, {".gguf"})
    else:
        roots, extensions = registry["LLM"]
        roots = list(roots)
        extensions = set(extensions)
        for root in (
            str(Path(folder_paths.models_dir) / "LLM"),
            str(Path(folder_paths.models_dir) / "llm"),
        ):
            if root not in roots:
                roots.append(root)
        extensions.add(".gguf")
        folder_paths.folder_names_and_paths["LLM"] = (roots, extensions)


_ensure_llm_folder_registry()

_LLAMA_CPP_MIN_VERSION = (0, 3, 48)
_LLAMA_CPP_RELEASES_URL = "https://github.com/JamePeng/llama-cpp-python/releases"
_LLAMA_CPP_API_URL = "https://api.github.com/repos/JamePeng/llama-cpp-python/releases?per_page=100"
_LLAMA_CPP_INSTALL_LOCK = asyncio.Lock()


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = re.match(r"\s*(\d+)\.(\d+)\.(\d+)", str(value or ""))
    return tuple(map(int, match.groups())) if match else (0, 0, 0)


def _llama_install_target() -> dict[str, str | bool]:
    system = platform.system()
    machine = platform.machine().casefold()
    python_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    result: dict[str, str | bool] = {
        "supported": False,
        "system": system,
        "machine": platform.machine(),
        "python_tag": python_tag,
        "release_url": _LLAMA_CPP_RELEASES_URL,
    }
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        result.update({
            "supported": True,
            "backend": "metal",
            "tag_marker": "-metal-macos-",
            "wheel_suffix": f"-{python_tag}-{python_tag}-macosx_11_0_arm64.whl",
        })
        return result
    if system == "Windows" and machine in {"amd64", "x86_64"}:
        os_marker, wheel_platform = "-win-", "win_amd64"
    elif system == "Linux" and machine in {"amd64", "x86_64"}:
        os_marker, wheel_platform = "-linux-", "linux_x86_64"
    else:
        result["reason"] = "当前系统或 CPU 架构没有可自动选择的官方 wheel。"
        return result
    try:
        import torch
        cuda_version = str(torch.version.cuda or "")
    except Exception:
        cuda_version = ""
    cuda_match = re.match(r"(\d+)\.(\d+)", cuda_version)
    if not cuda_match:
        result["reason"] = "未检测到 PyTorch CUDA 环境，无法安全选择 GPU wheel。"
        return result
    backend = f"cu{cuda_match.group(1)}{cuda_match.group(2)}"
    result.update({
        "supported": True,
        "backend": backend,
        "cuda": cuda_version,
        "tag_marker": f"-{backend}{os_marker}",
        "wheel_suffix": f"-{python_tag}-{python_tag}-{wheel_platform}.whl",
    })
    return result


def _llama_dependency_status() -> dict[str, object]:
    target = _llama_install_target()
    try:
        installed_version = importlib.metadata.version("llama-cpp-python")
    except importlib.metadata.PackageNotFoundError:
        installed_version = ""
    reasons: list[str] = []
    if not installed_version:
        reasons.append("当前未安装 llama-cpp-python")
    elif _version_tuple(installed_version) < _LLAMA_CPP_MIN_VERSION:
        reasons.append(f"当前 llama-cpp-python 版本：{installed_version}")
    return {
        **target,
        "installed_version": installed_version or None,
        "needs_install": bool(reasons),
        "reason": "；".join(reasons) or "依赖可用",
        "minimum_version": "0.3.48",
    }


def _find_llama_wheel(target: dict[str, object]) -> tuple[str, str]:
    request = urllib.request.Request(
        _LLAMA_CPP_API_URL,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Goohaitools-comfyui"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        releases = json.load(response)
    marker = str(target["tag_marker"]).casefold()
    suffix = str(target["wheel_suffix"]).casefold()
    for release in releases:
        if release.get("draft") or release.get("prerelease"):
            continue
        tag = str(release.get("tag_name", ""))
        if marker not in tag.casefold():
            continue
        for asset in release.get("assets", []):
            name = str(asset.get("name", ""))
            url = str(asset.get("browser_download_url", ""))
            if name.casefold().endswith(suffix) and url.startswith(
                "https://github.com/JamePeng/llama-cpp-python/releases/download/"
            ):
                return url, name
    raise RuntimeError("官方发布页没有找到与当前系统、Python 和 CUDA 完全匹配的 wheel。")


def _install_llama_cpp() -> dict[str, object]:
    target = _llama_install_target()
    if not target.get("supported"):
        raise RuntimeError(str(target.get("reason") or "当前环境不支持自动安装。"))
    wheel_url, wheel_name = _find_llama_wheel(target)
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--force-reinstall",
        "--no-deps",
        "--disable-pip-version-check",
        "--no-input",
        wheel_url,
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=900,
        check=False,
    )
    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    if completed.returncode != 0:
        raise RuntimeError(f"pip 安装失败（退出码 {completed.returncode}）：\n{output[-4000:]}")
    return {
        "success": True,
        "wheel": wheel_name,
        "message": "llama-cpp-python 安装完成。请完全重启 ComfyUI 后再使用该节点。",
    }


@PromptServer.instance.routes.get("/goohai/qwen_image_prompt_optimizer/llama_status")
async def qwen_image_llama_status(_request):
    return web.json_response(_llama_dependency_status())


@PromptServer.instance.routes.post("/goohai/qwen_image_prompt_optimizer/install_llama")
async def qwen_image_install_llama(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if payload.get("confirm") is not True:
        return web.json_response({"success": False, "message": "安装请求缺少用户确认。"}, status=400)
    if _LLAMA_CPP_INSTALL_LOCK.locked():
        return web.json_response({"success": False, "message": "安装任务正在运行。"}, status=409)
    async with _LLAMA_CPP_INSTALL_LOCK:
        try:
            result = await asyncio.to_thread(_install_llama_cpp)
            return web.json_response(result)
        except Exception as error:
            return web.json_response({
                "success": False,
                "message": str(error),
                "release_url": _LLAMA_CPP_RELEASES_URL,
            }, status=500)

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


def _all_choices() -> tuple[list[str], list[str]]:
    all_llms = folder_paths.get_filename_list("LLM")
    return (
        [name for name in all_llms if "mmproj" not in name.casefold()],
        [name for name in all_llms if "mmproj" in name.casefold()],
    )


def _preferred(choices: list[str], marker: str) -> str:
    marker = marker.casefold()
    return next((item for item in choices if marker in item.casefold()), choices[0])


def _resolve(display: str, mmproj: bool) -> str:
    path = folder_paths.get_full_path("LLM", display)
    if path is None:
        raise ValueError(f"找不到所选模型：{display}")
    is_mmproj = "mmproj" in Path(display).name.casefold()
    if is_mmproj != bool(mmproj):
        raise ValueError(f"模型类型不匹配：{display}")
    return path


class QwenImagePromptOptimizer:
    @classmethod
    def INPUT_TYPES(cls):
        t2i, mmproj = _all_choices()
        if not t2i:
            t2i = ["未找到 GGUF 模型"]
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
