import re

import torch
try:
    from comfy_execution.graph import ExecutionBlocker
except Exception:
    ExecutionBlocker = ()

class AnyType(str):
    def __ne__(self, value): return False
    def __eq__(self, value): return True
    def __str__(self): return "*"
ANY = AnyType("*")
MAX_INPUTS = 16

class GoohaiAnySwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {f"any_{i:02d}": (ANY,) for i in range(1, MAX_INPUTS + 1)},
                "hidden": {"gh_input_type": ("STRING", {"default": "ANY"})}}
    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("any",)
    FUNCTION = "switch"
    CATEGORY = "孤海工具箱"
    @classmethod
    def VALIDATE_INPUTS(cls, input_types): return True
    @staticmethod
    def _empty(v):
        if v is None or (ExecutionBlocker and isinstance(v, ExecutionBlocker)): return True
        if isinstance(v, dict) and "samples" in v:
            s = v.get("samples"); return s is None or (torch.is_tensor(s) and s.numel() == 0)
        if isinstance(v, str): return v == ""
        if isinstance(v, (list, tuple, dict, set)): return len(v) == 0
        if torch.is_tensor(v): return v.numel() == 0
        return False
    def switch(self, gh_input_type="ANY", **kwargs):
        # ComfyUI may submit the current frontend slot names (for example
        # "图像_1") instead of the original INPUT_TYPES names ("any_01").
        # Recover the stable slot index from the numeric suffix so dynamic
        # labels do not change input priority or make connected values vanish.
        indexed_values = {}
        for key, value in kwargs.items():
            if key == "gh_input_type":
                continue
            match = re.search(r"(\d+)$", str(key))
            if not match:
                continue
            index = int(match.group(1))
            if 1 <= index <= MAX_INPUTS:
                indexed_values.setdefault(index, value)
        values = [indexed_values[index] for index in sorted(indexed_values)]
        types = []
        for v in values:
            if self._empty(v): continue
            if torch.is_tensor(v): types.append("IMAGE" if v.ndim >= 4 else "TENSOR")
            elif isinstance(v, dict) and "samples" in v: types.append("LATENT")
            else: types.append(type(v).__name__)
        if len(set(types)) > 1:
            raise RuntimeError(f"任意切换 GH：输入类型不一致：{', '.join(types)}")
        for v in values:
            if not self._empty(v): return (v,)
        raise RuntimeError("任意切换 GH：所有输入均为空，无法输出。")

NODE_CLASS_MAPPINGS = {"GoohaiAnySwitch": GoohaiAnySwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"GoohaiAnySwitch": "任意切换 GH"}



