import torch
import numpy as np
from PIL import Image
from collections import defaultdict

class ExtractDominantColor:
    @classmethod
    def INPUT_TYPES(cls):
        # 多版本兼容的滑块定义
        slider_config = {
            "min": 1,
            "max": 16,
            "step": 1
        }
        if hasattr(torch, 'version') and torch.version.__version__ >= "2.0":  # 版本特征检测
            slider_config["display"] = "slider"
        
        return {
            "required": {
                "image": ("IMAGE",),
                "降采样系数": ("INT", dict({"default": 8}, **slider_config)),
                "颜色容差": ("INT", {
                    "default": 15,
                    "min": 0,
                    "max": 100,
                    "step": 1,
                    "display": "slider" if hasattr(torch, 'version') else "number"
                }),
            },
        }

    RETURN_TYPES = ("STRING",)  # 显式声明单一输出
    RETURN_NAMES = ("主色HEX",)
    FUNCTION = "extract_color"
    CATEGORY = "孤海工具箱"

    def extract_color(self, image, 降采样系数, 颜色容差):
        # 多版本张量处理兼容
        if isinstance(image, torch.Tensor):
            img_np = image.cpu().numpy()[0] * 255
        else:  # 兼容旧版本可能的数据格式
            img_np = np.array(image) * 255
        
        # 确保图像数据有效性
        img_np = np.clip(img_np, 0, 255).astype(np.uint8)
        img = Image.fromarray(img_np.squeeze())

        # 安全降采样
        w, h = img.size
        new_size = (
            max(w // 降采样系数, 4),
            max(h // 降采样系数, 4)
        )
        img = img.resize(new_size, Image.Resampling.LANCZOS)

        # 颜色处理管道
        pixels = np.array(img)
        if pixels.ndim == 3 and pixels.shape[-1] == 4:
            pixels = self._handle_alpha_channel(pixels)
        pixels = pixels.reshape(-1, 3)

        # 智能颜色过滤
        filtered = [p for p in pixels if not self._is_extreme_color(p)]
        if not filtered:  # 回退机制
            filtered = pixels

        # 精确颜色统计
        color_counts = defaultdict(int)
        for p in filtered:
            q = self._quantize_color(p, 颜色容差)
            color_counts[q] += 1

        dominant = max(color_counts, key=lambda k: (color_counts[k], sum(k)))  # 频率+亮度排序
        return (f"#{dominant[0]:02X}{dominant[1]:02X}{dominant[2]:02X}",)

    def _handle_alpha_channel(self, pixels):
        """处理透明通道的优化方法"""
        alpha = pixels[..., 3:] / 255.0
        rgb = pixels[..., :3].astype(np.float32)
        blended = (rgb * alpha).astype(np.uint8)
        return blended

    def _is_extreme_color(self, pixel):
        """智能过滤极端颜色"""
        avg = np.mean(pixel)
        return avg < 15 or avg > 240

    def _quantize_color(self, color, tolerance):
        """精确颜色量化方法"""
        if tolerance == 0:
            return tuple(color)
        return tuple((c // tolerance) * tolerance for c in color)

NODE_CLASS_MAPPINGS = {"ExtractDominantColor": ExtractDominantColor}
NODE_DISPLAY_NAME_MAPPINGS = {"ExtractDominantColor": "孤海-主色提取 (多版本兼容)"}