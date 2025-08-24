import numpy as np
import torch
from PIL import Image, ImageDraw
from nodes import PreviewImage
import comfy.utils
import matplotlib.colors as mcolors

class 孤海自定义颜色:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽度": ("INT", {"default": 512, "min": 1, "max": 8192}),
                "高度": ("INT", {"default": 512, "min": 1, "max": 8192}),
                "模式": (["纯色", "上下渐变", "中心渐变"], {"default": "纯色"}),
                "颜色1": ("COLOR", {"default": "#FFFFFF"}),
                "颜色2": ("COLOR", {"default": "#000000"}),
                "缩放": ("INT", {"default": 100, "min": 0, "max": 300, "step": 1}),
                "颗粒": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "生成颜色"
    CATEGORY = "孤海工具箱"

    def 生成颜色(self, 宽度, 高度, 模式, 颜色1, 颜色2, 缩放, 颗粒):
        # 转换颜色格式
        def hex_to_rgb(hex_color):
            return tuple(int(hex_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))

        color1 = hex_to_rgb(颜色1)
        color2 = hex_to_rgb(颜色2)

        # 创建新图像
        image = Image.new("RGB", (宽度, 高度))
        draw = ImageDraw.Draw(image)

        # 处理缩放参数
        scale_factor = 缩放 / 100.0

        if 模式 == "纯色":
            draw.rectangle([(0,0), (宽度, 高度)], fill=color1)
        elif 模式 == "上下渐变":
            for y in range(高度):
                ratio = y / 高度
                adjusted_ratio = (ratio * scale_factor) if scale_factor != 0 else ratio
                r = int(color1[0] + (color2[0] - color1[0]) * adjusted_ratio)
                g = int(color1[1] + (color2[1] - color1[1]) * adjusted_ratio)
                b = int(color1[2] + (color2[2] - color1[2]) * adjusted_ratio)
                draw.line([(0, y), (宽度, y)], fill=(r, g, b))
        elif 模式 == "中心渐变":
            center_x = 宽度 // 2
            center_y = 高度 // 2
            max_radius = ((宽度**2 + 高度**2)**0.5) / 2
            current_radius = max_radius * scale_factor

            for y in range(高度):
                for x in range(宽度):
                    distance = ((x - center_x)**2 + (y - center_y)**2)**0.5
                    ratio = min(distance / current_radius, 1.0) if current_radius != 0 else 1.0
                    r = int(color2[0] + (color1[0] - color2[0]) * ratio)
                    g = int(color2[1] + (color1[1] - color2[1]) * ratio)
                    b = int(color2[2] + (color1[2] - color2[2]) * ratio)
                    draw.point((x, y), fill=(r, g, b))

        # 转换为numpy数组
        image_np = np.array(image).astype(np.float32) / 255.0

        # 添加颗粒效果
        if 颗粒 > 0:
            strength = 颗粒 / 100.0 * 0.15  # 颗粒强度系数
            # 生成高斯噪声（单通道）
            noise = np.random.normal(scale=strength, size=(高度, 宽度, 1))
            # 扩展为RGB三通道
            noise_rgb = np.repeat(noise, 3, axis=2)
            # 叠加噪声并裁剪值域
            image_np = np.clip(image_np + noise_rgb, 0, 1)

        # 转换为Tensor
        image_tensor = torch.from_numpy(image_np)[None,]

        return (image_tensor,)

NODE_CLASS_MAPPINGS = {"孤海-自定义颜色": 孤海自定义颜色}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海-自定义颜色": "孤海-自定义颜色"}