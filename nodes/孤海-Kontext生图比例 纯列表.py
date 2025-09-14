import comfy.utils

class 孤海Kontext比例节点:
    """
    孤海-Kontext生图比例 | 纯列表节点
    提供预设比例选项，输出选择的字符串
    """
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        # 定义所有比例选项
        ratios = [
            "原始比例",
            "1：1（1024x1024）",
            "1：2（720x1456）",
            "2：3（832x1248）",
            "3：4（880x1184）",
            "3：5（800x1328）",
            "9：16（752x1392）",
            "9：21（672x1568）",
            "2：1（1456x720）",
            "3：2（1248x832）",
            "4：3（1184x880）",
            "5：3（1328x800）",
            "16：9（1392x752）",
            "21：9（1568x672）"
        ]
        # 构建比例选择参数，界面显示为"比例选择"
        return {
            "required": {
                "比例选择": (ratios, {"default": "原始比例"})
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("比例",)  # 输出端名称改为"比例"
    FUNCTION = "获取比例"
    CATEGORY = "孤海-Kontext"

    def 获取比例(self, 比例选择):
        # 直接返回选择的字符串
        return (比例选择,)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "孤海Kontext比例节点": 孤海Kontext比例节点
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海Kontext比例节点": "孤海-Kontext生图比例 | 纯列表"
}