import numpy as np
import torch

class GuHaiMaskDetect:
    """
    孤海遮罩检测
    输入遮罩自动检测有效区域
    """
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "遮罩": ("MASK",),
                "过滤最小值": ("FLOAT", {
                    "default": 3.0,
                    "min": 0.0,
                    "max": 10.0,
                    "step": 0.1,
                    "display": "slider"
                }),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("是否存在遮罩",)
    FUNCTION = "detect"
    CATEGORY = "孤海工具箱"

    def detect(self, 遮罩, 过滤最小值):
        # 将遮罩转为numpy数组
        mask_np = 遮罩.cpu().numpy().squeeze()
        
        # 判断是否存在大于0.5的像素
        has_mask = np.any(mask_np > 0.5)
        
        # 当过滤最小值为0时直接返回
        if 过滤最小值 == 0:
            return (bool(has_mask),)  # 修正括号闭合
        
        # 需要计算面积的情况
        if has_mask:
            # 计算有效面积（像素值>0.5的视为有效）
            valid_area = np.sum(mask_np > 0.5)
            total_pixels = mask_np.size
            area_ratio = (valid_area / total_pixels) * 100
            
            # 判断面积是否达到阈值
            return (bool(area_ratio >= 过滤最小值),)  # 修正括号闭合
        
        return (False,)

NODE_CLASS_MAPPINGS = {
    "GuHaiMaskDetect": GuHaiMaskDetect
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHaiMaskDetect": "孤海遮罩检测"
}