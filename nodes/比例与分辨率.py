import math


class GoohaiRatioAndResolution:
    """根据目标比例和模式计算输出图像尺寸。"""

    RATIO_OPTIONS = [
        "原始比例",
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "5:7",
        "9:16",
        "16:9",
        "21:9",
        "1:2",
        "2:1",
        "自定义宽高",
    ]

    MODE_OPTIONS = [
        "固定长边",
        "固定短边",
        "固定宽度",
        "固定高度",
        "总像素",
    ]

    RATIO_VALUES = {
        "1:1": (1.0, 1.0),
        "2:3": (2.0, 3.0),
        "3:2": (3.0, 2.0),
        "3:4": (3.0, 4.0),
        "4:3": (4.0, 3.0),
        "5:7": (5.0, 7.0),
        "9:16": (9.0, 16.0),
        "16:9": (16.0, 9.0),
        "21:9": (21.0, 9.0),
        "1:2": (1.0, 2.0),
        "2:1": (2.0, 1.0),
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "比例": (cls.RATIO_OPTIONS, {"default": "原始比例"}),
                "模式": (cls.MODE_OPTIONS, {"default": "固定长边"}),
                "固定边像素": ("INT", {"default": 1024, "min": 8, "max": 10240, "step": 1}),
                "百万像素": ("FLOAT", {"default": 2.0, "min": 0.2, "max": 50.0, "step": 0.1}),
                "自定宽度": ("INT", {"default": 1024, "min": 8, "max": 10240, "step": 1}),
                "自定高度": ("INT", {"default": 1024, "min": 8, "max": 10240, "step": 1}),
                "倍数取整": ("INT", {"default": 16, "min": 0, "max": 1024, "step": 1}),
            },
            "optional": {
                "图像": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("FLOAT", "INT", "INT")
    RETURN_NAMES = ("比值", "宽度", "高度")
    FUNCTION = "calculate"
    CATEGORY = "孤海工具箱"

    @staticmethod
    def _image_size(图像):
        """读取 ComfyUI IMAGE 的最后一个有效图像尺寸。"""
        if 图像 is None:
            return 1, 1

        try:
            shape = tuple(图像.shape)
        except AttributeError:
            return 1, 1

        # ComfyUI IMAGE 通常为 [batch, height, width, channels]。
        if len(shape) >= 3:
            height = int(shape[-3])
            width = int(shape[-2])
            if width > 0 and height > 0:
                return width, height
        return 1, 1

    @staticmethod
    def _round_to_multiple(value, multiple):
        value = max(1.0, float(value))
        multiple = int(multiple)
        if multiple <= 0:
            return max(1, int(round(value)))

        # 保持尺寸有效：目标值小于一个倍数时仍输出一个倍数，而不是 0。
        return max(multiple, int(round(value / multiple)) * multiple)

    @staticmethod
    def _round_to_multiple(value, multiple):
        value = max(1.0, float(value))
        multiple = int(multiple)
        if multiple <= 0:
            return max(1, int(round(value)))
        return max(multiple, int(round(value / multiple)) * multiple)

    @classmethod
    def _ratio(cls, 比例, 图像):
        if 比例 == "原始比例":
            原宽度, 原高度 = cls._image_size(图像)
            return float(原宽度), float(原高度)
        if 比例 == "自定义宽高":
            return None
        return cls.RATIO_VALUES.get(比例, (1.0, 1.0))

    def calculate(
        self,
        比例,
        模式,
        固定边像素,
        百万像素,
        自定宽度,
        自定高度,
        倍数取整,
        图像=None,
    ):
        if 比例 == "自定义宽高":
            宽度 = float(自定宽度)
            高度 = float(自定高度)
        else:
            比例宽, 比例高 = self._ratio(比例, 图像)
            比例宽 = max(1.0, float(比例宽))
            比例高 = max(1.0, float(比例高))

            if 模式 == "固定长边":
                缩放 = float(固定边像素) / max(比例宽, 比例高)
                宽度, 高度 = 比例宽 * 缩放, 比例高 * 缩放
            elif 模式 == "固定短边":
                缩放 = float(固定边像素) / min(比例宽, 比例高)
                宽度, 高度 = 比例宽 * 缩放, 比例高 * 缩放
            elif 模式 == "固定宽度":
                宽度 = float(固定边像素)
                高度 = 宽度 * 比例高 / 比例宽
            elif 模式 == "固定高度":
                高度 = float(固定边像素)
                宽度 = 高度 * 比例宽 / 比例高
            elif 模式 == "总像素":
                # 与 ComfyUI 官方 Resolution Selector 一致：MP 按 1024²
                # 计算目标面积，随后每条边按倍数就近取整。
                面积 = max(0.2, float(百万像素)) * 1024.0 * 1024.0
                缩放 = math.sqrt(面积 / (比例宽 * 比例高))
                宽度, 高度 = 比例宽 * 缩放, 比例高 * 缩放
            else:
                # 容错：未知模式按固定长边处理。
                缩放 = float(固定边像素) / max(比例宽, 比例高)
                宽度, 高度 = 比例宽 * 缩放, 比例高 * 缩放

        if 模式 == "总像素" and 比例 != "自定义宽高":
            最终宽度 = self._round_to_multiple(宽度, 倍数取整)
            最终高度 = self._round_to_multiple(高度, 倍数取整)
        else:
            最终宽度 = self._round_to_multiple(宽度, 倍数取整)
            最终高度 = self._round_to_multiple(高度, 倍数取整)
        最终比值 = round(float(最终宽度) / float(最终高度), 10)
        # 通过 UI 执行事件把实际后端结果回传给前端节点，
        # 这样中间经过其他图像节点、运行前无法读取尺寸时，
        # 执行完成后仍能显示真实的最终宽高。
        return {
            "result": (最终比值, 最终宽度, 最终高度),
            "ui": {
                "ratio_resolution": [{
                    "width": 最终宽度,
                    "height": 最终高度,
                    "ratio": 最终比值,
                }]
            },
        }


NODE_CLASS_MAPPINGS = {
    "GoohaiRatioAndResolution": GoohaiRatioAndResolution,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GoohaiRatioAndResolution": "比例与分辨率",
}
