class BoolGuHai:
    """布尔 孤海 — 带自定义开关 UI 的布尔节点"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "开关": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("布尔",)
    FUNCTION = "execute"
    CATEGORY = "孤海工具箱"

    def execute(self, 开关):
        return (开关,)


NODE_CLASS_MAPPINGS = {
    "布尔孤海": BoolGuHai,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "布尔孤海": "布尔 孤海",
}
