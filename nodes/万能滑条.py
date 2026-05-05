"""
GoohaiTools — 孤海万能滑条 (Goohai Universal Slider)
"""


class GoohaiUniversalSlider:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "值": ("FLOAT", {
                    "default": 0.5,
                    "min": 0.0,
                    "max": 102400,
                    "step": 0.01,
                    "display": "slider",
                }),
            },
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("*",)
    FUNCTION     = "execute"
    CATEGORY     = "孤海工具箱"

    def execute(self, 值):
        return (float(值),)

    @classmethod
    def IS_CHANGED(cls, 值):
        return float(值)


# ── 节点注册映射 ─────────────────────────────────
NODE_CLASS_MAPPINGS = {
    "GoohaiUniversalSlider": GoohaiUniversalSlider,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GoohaiUniversalSlider": "孤海万能滑条",
}
