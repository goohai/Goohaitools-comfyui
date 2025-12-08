import os
import sys
import math
import numpy as np  # 新增导入
import torch  # 新增导入
from PIL import Image, ImageDraw, ImageFont
import comfy
import folder_paths

class GuhaiBatchProgress:
    """
    孤海批处理进度条
    输入总数和当前序号，生成进度条图像
    """
    @classmethod
    def INPUT_TYPES(cls):
        # 获取字体目录

        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        font_dir = os.path.join(parent_dir, "fonts")
        fonts = []
        if os.path.exists(font_dir):
            for f in os.listdir(font_dir):
                if f.lower().endswith(('.ttf', '.otf')):
                    fonts.append(f)
        
        return {
            "required": {
                "total": ("INT", {"default": 5, "min": 1}),
                "current": ("INT", {"default": 1, "min": 1}),
                "background_color": ("COLORCODE", {"default": "#242730"}),
                "progress_color": ("COLORCODE", {"default": "#1aeaac"}),
                "text_color": ("COLORCODE", {"default": "#1aeaac"}),
                "font_size": ("INT", {"default": 300, "min": 100, "max": 512}),
                "font_name": (fonts if fonts else ["default"],),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "generate_progress"
    CATEGORY = "孤海工具箱"

    def generate_progress(self, total, current, background_color, progress_color, text_color, font_size, font_name):
        # 创建画布
        width, height = 1024, 384
        image = Image.new("RGB", (width, height), self.hex_to_rgb(background_color))
        draw = ImageDraw.Draw(image)

        # 绘制进度条
        progress_width = width * min(current, total) // total
        progress_height = 5
        radius = progress_height // 2
        draw.rounded_rectangle(
            [(0, 0), (progress_width, progress_height)],
            radius=radius,
            fill=self.hex_to_rgb(progress_color)
        )

        # 处理文字
        text = f"{min(current, total)}/{total}"
        font_path = None
        
        # 加载字体
        if font_name != "default" and font_name:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(current_dir)
            font_path = os.path.join(parent_dir, "fonts", font_name)        

        try:
            if font_path and os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
            else:
                font = ImageFont.load_default()
                font = font.font_variant(size=font_size)
        except:
            font = ImageFont.load_default()
            font = font.font_variant(size=font_size)

        # 计算文字位置
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_w = text_bbox[2] - text_bbox[0]
        text_h = text_bbox[3] - text_bbox[1]
        x = (width - text_w) // 2
        y = progress_height + 10  # 距离进度条10px

        # 绘制文字
        draw.text((x, y), text, fill=self.hex_to_rgb(text_color), font=font)

         # 转换为ComfyUI兼容格式
        pil_image = image.convert("RGB")
        numpy_image = np.array(pil_image).astype(np.float32) / 255.0
        tensor_image = torch.from_numpy(numpy_image)[None,]
        return (tensor_image, )

    def hex_to_rgb(self, hex_color):
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

# 注册节点
NODE_CLASS_MAPPINGS = {
    "GuhaiBatchProgress_孤海批处理进度条": GuhaiBatchProgress
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuhaiBatchProgress_孤海批处理进度条": "孤海批处理进度条 🐋"
}