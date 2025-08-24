import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths

class 孤海图像亮度比较:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像1": ("IMAGE",),
                "阈值": ("INT", {
                    "default": 128,
                    "min": 0,
                    "max": 255,
                    "step": 1
                }),
            },
            "optional": {
                "遮罩1": ("MASK",),
                "图像2": ("IMAGE",),
                "遮罩2": ("MASK",),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("比较结果",)
    FUNCTION = "compare_brightness"
    CATEGORY = "孤海工具箱"

    def calculate_brightness(self, image, mask=None):
        # 转换为PIL图像
        i = 255. * image.cpu().numpy().squeeze()
        img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        
        # 转换为黑白图像
        gray_img = ImageOps.grayscale(img)
        np_img = np.array(gray_img)
        
        # 处理遮罩
        if mask is not None:
            mask_np = mask.cpu().numpy().squeeze()
            mask_np = (mask_np * 255).astype(np.uint8)
            if np.all(mask_np == 0):
                valid_pixels = np_img.flatten()
            else:
                mask_resized = Image.fromarray(mask_np).resize(gray_img.size)
                mask_array = np.array(mask_resized) > 128
                valid_pixels = np_img[mask_array]
        else:
            valid_pixels = np_img.flatten()
        
        return np.mean(valid_pixels) if len(valid_pixels) > 0 else 0.0

    def compare_brightness(self, 图像1, 阈值, 图像2=None, 遮罩1=None, 遮罩2=None):
        # 处理单图像比较
        图像2 = 图像1 if 图像2 is None else 图像2
        
        # 计算亮度
        b1 = self.calculate_brightness(图像1, 遮罩1)
        b2 = self.calculate_brightness(图像2, 遮罩2)
        
        # 比较结果
        return (bool((b1 > b2) and ((b1 - b2) > 阈值)), )

NODE_CLASS_MAPPINGS = {
    "孤海图像亮度比较": 孤海图像亮度比较
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海图像亮度比较": "孤海-图像亮度比较"
}