from comfy.sd import *
import numpy as np
import torch
import comfy.utils

class 孤海遮罩分析:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "遮罩": ("MASK",),
                "上扩百分比": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1, "display": "上扩%"}),
                "下扩百分比": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1, "display": "下扩%"}),
                "左扩百分比": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1, "display": "左扩%"}),
                "右扩百分比": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1, "display": "右扩%"}),
            }
        }

    RETURN_TYPES = ("MASK", "INT", "INT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("遮罩", "画布宽", "画布高", "遮罩宽", "遮罩高", "遮罩中心x", "遮罩中心y")
    CATEGORY = "孤海工具箱"
    FUNCTION = "analyze_mask"

    def analyze_mask(self, 遮罩, 上扩百分比, 下扩百分比, 左扩百分比, 右扩百分比):
        # 转换原始遮罩
        mask_np = 遮罩.cpu().numpy()[0]
        orig_h, orig_w = mask_np.shape
        new_mask = np.zeros_like(mask_np)

        # 获取原始有效区域
        y_indices, x_indices = np.where(mask_np >= 0.5)
        
        if len(x_indices) == 0 or len(y_indices) == 0:
            new_mask = mask_np
            return (遮罩, int(orig_w), int(orig_h), int(orig_w), int(orig_h), 
                    int(orig_w//2), int(orig_h//2))
        
        # 计算原始有效区域
        x_min, x_max = np.min(x_indices), np.max(x_indices)
        y_min, y_max = np.min(y_indices), np.max(y_indices)
        orig_mask_w = x_max - x_min + 1
        orig_mask_h = y_max - y_min + 1

        # 计算扩展量（基于原始有效区域尺寸）
        top_ext = max(0, int(orig_mask_h * 上扩百分比 / 100))
        bottom_ext = max(0, int(orig_mask_h * 下扩百分比 / 100))
        left_ext = max(0, int(orig_mask_w * 左扩百分比 / 100))
        right_ext = max(0, int(orig_mask_w * 右扩百分比 / 100))

        # 计算新区域边界（限制在画布范围内）
        new_y_min = max(0, y_min - top_ext)
        new_y_max = min(orig_h-1, y_max + bottom_ext)
        new_x_min = max(0, x_min - left_ext)
        new_x_max = min(orig_w-1, x_max + right_ext)

        # 创建扩展后的遮罩
        new_mask[new_y_min:new_y_max+1, new_x_min:new_x_max+1] = 1.0

        # 转换回tensor格式
        new_mask_tensor = torch.from_numpy(new_mask).unsqueeze(0)

        # 计算新参数
        new_mask_w = new_x_max - new_x_min + 1
        new_mask_h = new_y_max - new_y_min + 1
        new_center_x = (new_x_min + new_x_max) // 2
        new_center_y = (new_y_min + new_y_max) // 2

        return (
            new_mask_tensor,
            int(orig_w),
            int(orig_h),
            int(new_mask_w),
            int(new_mask_h),
            int(new_center_x),
            int(new_center_y)
        )

NODE_CLASS_MAPPINGS = {"孤海遮罩分析": 孤海遮罩分析}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海遮罩分析": "孤海-遮罩分析"}