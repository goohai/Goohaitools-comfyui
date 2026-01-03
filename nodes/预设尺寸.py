import comfy
import math

class LoneSeaPresetSize:
    @classmethod
    def INPUT_TYPES(cls):
        preset_list = [
            "1寸（2.5x3.5cm）",
            "大1寸（3.3x4.8cm）",
            "小2寸（3.5x4.5cm）",
            "2寸（3.5x4.9cm）",
            "大2寸（3.5x5.3cm）",
            "3寸（5.5x8.5cm）",
            "5寸（8.9x12.7cm）",
            "6寸（10.1x15.2cm）",
            "身份证社保（2.6x3.2cm）",
            "驾驶证（2.2x3.2cm）",
            "日签（4.5x4.5cm）",
            "美签（5.1x5.1cm）",
            "自定义尺寸"
        ]
        
        return {
            "required": {
                "预设尺寸": (preset_list, {"default": "1寸（2.5x3.5cm）"}),
                "dpi": ("INT", {"default": 300, "min": 72, "max": 5000, "step": 1}),
                "自定义宽度": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10000.0, "step": 0.1}),
                "自定义高度": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10000.0, "step": 0.1}),
                "单位": (["像素", "厘米", "英寸"], {"default": "像素"}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT",)
    RETURN_NAMES = ("宽度", "高度", "分辨率",)
    FUNCTION = "calculate_size"
    CATEGORY = "孤海工具箱"

    def calculate_size(self, 预设尺寸, dpi, 自定义宽度, 自定义高度, 单位):
        size_map = {
            "1寸（2.5x3.5cm）": (2.5, 3.5),
            "大1寸（3.3x4.8cm）": (3.3, 4.8),
            "小2寸（3.5x4.5cm）": (3.5, 4.5),
            "2寸（3.5x4.9cm）": (3.5, 4.9),
            "大2寸（3.5x5.3cm）": (3.5, 5.3),
            "3寸（5.5x8.5cm）": (5.5,8.5),
            "5寸（8.9x12.7cm）": (8.9,12.7),
            "6寸（10.1x15.2cm）": (10.1,15.2),
            "身份证社保（2.6x3.2cm）": (2.6, 3.2),
            "驾驶证（2.2x3.2cm）": (2.2, 3.2),
            "日签（4.5x4.5cm）": (4.5, 4.5),
            "美签（5.1x5.1cm）": (5.1, 5.1)
        }

        if 预设尺寸 == "自定义尺寸":
            if 单位 == "像素":
                width = round(自定义宽度)
                height = round(自定义高度)
            elif 单位 == "厘米":
                width = round(自定义宽度 * dpi / 2.54)
                height = round(自定义高度 * dpi / 2.54)
            elif 单位 == "英寸":
                width = round(自定义宽度 * dpi)
                height = round(自定义高度 * dpi)
            return (width, height, dpi,)
        else:
            cm_w, cm_h = size_map[预设尺寸]
            width = round(cm_w * dpi / 2.54)
            height = round(cm_h * dpi / 2.54)
            return (width, height, dpi,)

NODE_CLASS_MAPPINGS = {
    "LoneSeaPresetSize": LoneSeaPresetSize
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoneSeaPresetSize": "孤海预设尺寸"
}