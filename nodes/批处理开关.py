import comfy.sd
import comfy.utils

class GuHaiParameterSummary:
    FUNCTION = "get_params"    
    CATEGORY = "孤海工具箱"
    RETURN_TYPES = ("BOOLEAN", "BOOLEAN", "FLOAT", "FLOAT")
    RETURN_NAMES = ("布尔1", "布尔2", "浮点1", "浮点2")
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "批量处理": ("BOOLEAN", {
                    "default": False,
                    "label": "批量处理",
                    "display": ["关", "开"]  # 添加自定义显示
                }),
                "包含子文件夹": ("BOOLEAN", {
                    "default": False,
                    "label": "包含子文件夹",
                    "display": ["关", "开"]  # 添加自定义显示
                }),
                "头顶比例": ("FLOAT", {"min": 0, "max": 0.5, "default": 0.1, "step": 0.01, "label": "头顶比例"}),
                "人脸占比": ("FLOAT", {"min": 0.1, "max": 0.8, "default": 0.5, "step": 0.01, "label": "人脸占比"}),
            }
        }

    def get_params(self, 批量处理, 包含子文件夹, 头顶比例, 人脸占比):
        return (批量处理, 包含子文件夹, 头顶比例, 人脸占比)

NODE_CLASS_MAPPINGS = {
    "GuHaiParameterSummary": GuHaiParameterSummary
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHaiParameterSummary": "孤海批处理开关"
}