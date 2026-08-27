import torch
try:
    from comfy_execution.graph import ExecutionBlocker
except Exception:
    ExecutionBlocker = ()


class AnyType(str):
    def __ne__(self, value):
        return False

    def __eq__(self, value):
        return True

    def __str__(self):
        return "*"


ANY = AnyType("*")


class GoohaiAnyExists:
    """检测 Any 输入是否存在，并在空值时提供轻量类型占位值。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {"Any": (ANY,)},
            "hidden": {"gh_input_type": ("STRING", {"default": "ANY"})},
        }

    RETURN_TYPES = (ANY, "BOOLEAN")
    RETURN_NAMES = ("Any", "布尔")
    FUNCTION = "check"
    CATEGORY = "孤海工具箱"

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        return True

    @staticmethod
    def _is_black_tensor(value):
        try:
            return hasattr(value, "numel") and value.numel() > 0 and not bool(torch.any(value != 0).item())
        except Exception:
            return False

    @classmethod
    def _is_empty(cls, value, input_type):
        if value is None or (ExecutionBlocker and isinstance(value, ExecutionBlocker)):
            return True
        if input_type == "MASK":
            # 纯黑 MASK 视为空，但仍透传原始遮罩。
            return cls._is_black_tensor(value)
        if input_type == "LATENT" and isinstance(value, dict) and "samples" in value:
            return cls._is_black_tensor(value.get("samples"))
        if isinstance(value, str):
            return value == ""
        if isinstance(value, (list, tuple, dict, set)):
            return len(value) == 0
        return False  # 0 和 False 均为有效内容

    @staticmethod
    def _placeholder(input_type):
        t = str(input_type or "ANY").upper()
        if t == "IMAGE":
            return torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        if t == "MASK":
            return torch.zeros((1, 64, 64), dtype=torch.float32)
        if t == "STRING":
            return ""
        if t in ("INT", "INTEGER"):
            return 0
        if t in ("FLOAT", "DOUBLE"):
            return 0.0
        if t == "BOOLEAN":
            return False
        if t == "LATENT":
            return {"samples": torch.zeros((1, 4, 1, 1), dtype=torch.float32)}
        if t in ("CONDITIONING", "CONDITION"):
            return []
        # MODEL / CLIP / VAE 及未知复杂类型不能凭空构造有效对象。
        return None

    @staticmethod
    def _runtime_type(value, declared_type):
        t = str(declared_type or "ANY").upper()
        if t not in ("ANY", "*") or value is None:
            return "ANY" if t == "*" else t
        if torch.is_tensor(value):
            if value.ndim >= 4 and value.shape[-1] in (1, 3, 4):
                return "IMAGE"
            if value.ndim in (2, 3):
                return "MASK"
        if isinstance(value, dict) and "samples" in value:
            return "LATENT"
        if isinstance(value, bool):
            return "BOOLEAN"
        if isinstance(value, int):
            return "INT"
        if isinstance(value, float):
            return "FLOAT"
        if isinstance(value, str):
            return "STRING"
        return "ANY"

    def check(self, Any=None, gh_input_type="ANY", **kwargs):
        # 前端会把插槽显示名改成“图像/遮罩”等中文名称；ComfyUI
        # 会用该名称作为执行参数名，因此这里兼容动态名称。
        if Any is None and kwargs:
            for key, value in kwargs.items():
                if key != "gh_input_type":
                    Any = value
                    if str(gh_input_type).upper() == "ANY":
                        gh_input_type = {
                            "图像": "IMAGE", "遮罩": "MASK", "音频": "AUDIO",
                            "视频": "VIDEO", "模型": "MODEL", "CLIP": "CLIP",
                            "VAE": "VAE", "字符串": "STRING", "条件": "CONDITIONING",
                            "Latent": "LATENT", "整数": "INT", "浮点": "FLOAT",
                            "布尔": "BOOLEAN", "Any": "ANY",
                        }.get(key, key)
                    break
        input_type = self._runtime_type(Any, gh_input_type)
        empty = self._is_empty(Any, input_type)
        if not empty:
            return (Any, True)
        # MASK 的纯黑输入保留原对象；None 则生成 64x64 黑遮罩。
        if input_type == "MASK" and Any is not None:
            return (Any, False)
        if Any is None and input_type == "ANY":
            return (None, False)
        return (self._placeholder(input_type), False)


NODE_CLASS_MAPPINGS = {"GoohaiAnyExists": GoohaiAnyExists}
NODE_DISPLAY_NAME_MAPPINGS = {"GoohaiAnyExists": "万能是否存在(GH)"}
