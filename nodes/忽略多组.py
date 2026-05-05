class IgnoreGroupsGuHai:
    """忽略多组 孤海 — 通过开关控制工作流中各编组的忽略/旁路状态"""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = "孤海工具箱"
    OUTPUT_NODE = True

    def execute(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "忽略多组孤海": IgnoreGroupsGuHai,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "忽略多组孤海": "忽略多组 孤海",
}
