import numpy as np
import torch
from PIL import Image, ImageFilter
from collections import defaultdict
import comfy
from scipy.ndimage import binary_dilation

class RemoveSolidBackground:
    """
    孤海-移除纯色背景 v2.1
    智能主色检测与背景移除
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "颜色阈值": ("FLOAT", {
                    "default": 0.1,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "display": "slider"
                }),
                "边缘采样密度": ("INT", {
                    "default": 30,
                    "min": 10,
                    "max": 100,
                    "step": 5
                }),
                "移除扩展": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 10,
                    "step": 1
                }),
                "模糊半径": ("FLOAT", {
                    "default": 0.5,
                    "min": 0.0,
                    "max": 5.0,
                    "step": 0.1,
                    "display": "slider"
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("透明背景图像", "遮罩")
    FUNCTION = "remove_background"
    CATEGORY = "孤海定制"

    def remove_background(self, image, 颜色阈值, 边缘采样密度, 移除扩展, 模糊半径):
        # 转换图像格式
        image_pil = Image.fromarray((image[0].numpy() * 255).astype(np.uint8))
        
        # 检测主背景色
        bg_color = self.detect_dominant_color(image_pil, 边缘采样密度)
        
        # 设置实际阈值
        threshold = int(颜色阈值 * 255)
        
        # 执行背景移除
        rgba_image = self.remove_color(image_pil, bg_color, threshold)
        
        # 处理扩展和模糊
        img_array = np.array(rgba_image)
        alpha = img_array[:, :, 3]
        
        # 移除扩展处理
        if 移除扩展 > 0:
            mask = alpha == 0
            structure = np.ones((3,3), dtype=bool)
            mask = binary_dilation(mask, structure=structure, iterations=移除扩展)
            alpha[mask] = 0
        
        # 模糊处理
        if 模糊半径 > 0:
            alpha_pil = Image.fromarray(alpha).convert('L')
            alpha_blur = alpha_pil.filter(ImageFilter.GaussianBlur(radius=模糊半径))
            alpha = np.array(alpha_blur)
        
        # 更新alpha通道
        img_array[:, :, 3] = alpha
        rgba_image = Image.fromarray(img_array)
        
        # 转换回ComfyUI格式
        result_image = torch.from_numpy(np.array(rgba_image).astype(np.float32) / 255.0)
        
        # 生成遮罩
        mask_array = alpha.astype(np.float32) / 255.0
        mask_tensor = torch.from_numpy(mask_array)
        
        return (result_image.unsqueeze(0), mask_tensor.unsqueeze(0))

    def detect_dominant_color(self, image, sample_step):
        """改进的主色检测算法"""
        width, height = image.size
        pixels = []
        
        # 边缘采样模式
        for y in [0, height-1]:
            for x in range(0, width, sample_step):
                pixels.append(image.getpixel((x, y)))
        
        for x in [0, width-1]:
            for y in range(0, height, sample_step):
                pixels.append(image.getpixel((x, y)))

        # 颜色量化处理
        color_bins = defaultdict(list)
        for color in pixels:
            quantized = tuple(c // 51 for c in color[:3])
            color_bins[quantized].append(color)

        # 筛选有效颜色区间
        total_samples = len(pixels)
        valid_bins = {k: v for k, v in color_bins.items() if len(v)/total_samples > 0.1}

        # 找到最大颜色区间
        max_bin = max(valid_bins.values(), key=len) if valid_bins else max(color_bins.values(), key=len)
        dominant_color = np.mean(max_bin, axis=0)
        return tuple(dominant_color.astype(int))

    def remove_color(self, image, target_color, threshold):
        """向量化颜色移除算法"""
        img_array = np.array(image.convert("RGBA"))
        diff = np.sum(np.abs(img_array[:,:,:3] - target_color), axis=2)
        alpha = np.where(diff <= threshold, 0, 255)
        img_array[:,:,3] = alpha
        return Image.fromarray(img_array)

NODE_CLASS_MAPPINGS = {
    "RemoveSolidBackground_孤海V2": RemoveSolidBackground
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RemoveSolidBackground_孤海V2": "孤海-移除纯色背景 v2"
}