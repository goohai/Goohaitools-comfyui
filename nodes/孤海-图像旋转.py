import torch
import numpy as np
import math

class RotateImageNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "旋转角度": (["-90", "0", "90", "180"], {"default": "0"})
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("旋转后图像",)
    FUNCTION = "rotate_image"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "孤海-图像旋转节点"

    def rotate_image(self, image, 旋转角度):
        angle = int(旋转角度)
        
        # 0度直接返回原图
        if angle == 0:
            return (image,)
        
        # 将图像转换为tensor格式 (B,H,W,C)
        image_tensor = image.clone().detach()
        
        # 旋转操作字典
        rotations = {
            90: lambda x: torch.rot90(x, k=-1, dims=[1,2]),    # 顺时针90度
            -90: lambda x: torch.rot90(x, k=1, dims=[1,2]),  # 逆时针90度
            180: lambda x: torch.rot90(torch.rot90(x, k=1, dims=[1,2]), k=1, dims=[1,2])  # 180度
        }
        
        # 执行旋转操作
        rotated = rotations[angle](image_tensor)
        
        return (rotated,)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "RotateImageNode": RotateImageNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RotateImageNode": "孤海-图像旋转"
}