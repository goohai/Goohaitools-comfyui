import torch
import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np
import comfy.utils

def cm_to_pixels(cm, dpi):
    return int(cm * dpi / 2.54)

class SingleImageLayoutNode:
    def __init__(self):
        pass
    
    @classmethod
    def get_font_list(cls):
        """获取fonts目录下的所有字体文件"""
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        font_dir = os.path.join(parent_dir, "fonts")
        font_list = []
        if os.path.exists(font_dir):
            for file in os.listdir(font_dir):
                if file.lower().endswith((".ttf", ".otf", ".ttc")):
                    font_list.append(file)
        return font_list
    
    @classmethod
    def load_font(cls, font_name, font_size):
        """加载指定字体"""
        if not font_name or font_name == "默认字体":
            return ImageFont.load_default()
        
        try:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(current_dir)
            font_path = os.path.join(parent_dir, "fonts", font_name)

            return ImageFont.truetype(font_path, font_size)
        except:
            return ImageFont.load_default()
    
    @classmethod
    def add_border_to_image(cls, image, border_width):
        """为图片添加黑色描边"""
        if border_width <= 0:
            return image
        
        # 创建带有描边的图片
        bordered_img = ImageOps.expand(
            image, 
            border=border_width, 
            fill='black'
        )
        
        # 将原图粘贴在描边层上面，保留原图尺寸
        result = Image.new('RGB', bordered_img.size, (0, 0, 0))
        result.paste(image, (border_width, border_width))
        return result

    @classmethod
    def INPUT_TYPES(cls):
        # 获取可用字体列表
        fonts = cls.get_font_list()
        fonts.insert(0, "默认字体")  # 添加默认选项
        
        return {
            "required": {
                "image": ("IMAGE",),
                "相纸宽": ("FLOAT", {"default": 8.9, "min": 1.0, "max": 100.0, "step": 0.1}),
                "相纸高": ("FLOAT", {"default": 12.7, "min": 1.0, "max": 100.0, "step": 0.1}),
                "分辨率": ("INT", {"default": 350, "min": 72, "max": 1000, "step": 1}),
                "文件名": ("STRING", {"default": "孤海排版"}),
                "照片间距": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 2.0, "step": 0.01}),
                "字体": (fonts, {"default": fonts[0]}),
                "字体大小": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
                "描边": ("INT", {"default": 0, "min": 0, "max": 10, "step": 1}),
                "安全边距": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 5.0, "step": 0.1}),
                "自动切换横竖版": ("BOOLEAN", {"default": False})
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("排版图像",)
    FUNCTION = "layout_image"
    CATEGORY = "孤海工具箱"

    def layout_image(self, image, 相纸宽, 相纸高, 分辨率, 文件名, 照片间距, 字体, 字体大小, 描边, 安全边距, 自动切换横竖版):
        # 将输入图像转换为PIL图像
        img = self.tensor_to_pil(image)
        img_w, img_h = img.size
        
        # 为照片添加描边（如果需要）
        if 描边 > 0:
            img = self.add_border_to_image(img, 描边)
        
        # 计算文件名区域高度（如有需要）
        filename_area = 0
        if 字体大小 > 0:
            # 估算文本高度（实际文本高度可能会略小于字体大小）
            filename_area = 字体大小 + cm_to_pixels(0.1, 分辨率)  # 0.1厘米间距
            
        # 计算最佳布局方向（包含文件名区域）
        if 自动切换横竖版:
            landscape = self.calculate_best_layout(
                相纸宽, 相纸高, 分辨率, 安全边距, 照片间距, 
                字体大小, img_w, img_h, filename_area
            )
            if landscape:
                相纸宽, 相纸高 = 相纸高, 相纸宽
        
        # 创建画布
        canvas_width = cm_to_pixels(相纸宽, 分辨率)
        canvas_height = cm_to_pixels(相纸高, 分辨率)
        margin_px = cm_to_pixels(安全边距, 分辨率)
        spacing_px = cm_to_pixels(照片间距, 分辨率)
        
        # 计算实际可用空间（完整包含文件名区域）
        usable_width = canvas_width - 2 * margin_px
        usable_height = canvas_height - 2 * margin_px - filename_area
        
        # 计算行列数量（确保不超过可用空间）
        cols = max(1, math.floor((usable_width + spacing_px) / (img_w + spacing_px)))
        rows = max(1, math.floor((usable_height + spacing_px) / (img_h + spacing_px)))
        
        # 如果内容过多，自动减少行数
        max_rows = max(1, math.floor((usable_height + spacing_px) / (img_h + spacing_px)))
        if rows > max_rows:
            rows = max_rows
        
        # 计算照片区域总大小
        total_img_width = cols * img_w + (cols - 1) * spacing_px
        total_img_height = rows * img_h + (rows - 1) * spacing_px
        
        # 计算整个内容区域的大小（包括文件名）
        content_width = total_img_width
        content_height = total_img_height + filename_area
        
        # 计算内容区域在画布上的起始位置（确保完整居中）
        start_x = margin_px + (canvas_width - 2 * margin_px - content_width) // 2
        start_y = margin_px + (canvas_height - 2 * margin_px - content_height) // 2
        
        # 计算照片在内容区域中的起始位置
        img_start_x = start_x + (content_width - total_img_width) // 2
        img_start_y = start_y
        
        # 创建新画布
        canvas = Image.new("RGB", (canvas_width, canvas_height), (255, 255, 255))
        
        # 放置图片（确保不超出安全区域）
        for r in range(rows):
            for c in range(cols):
                x = img_start_x + c * (img_w + spacing_px)
                y = img_start_y + r * (img_h + spacing_px)
                
                # 验证是否在安全区域内
                if (x >= margin_px and y >= margin_px and 
                    x + img_w <= canvas_width - margin_px and 
                    y + img_h <= start_y + total_img_height):
                    canvas.paste(img, (int(x), int(y)))
        
        # 添加文件名（居中）
        if 字体大小 > 0:
            # 加载字体
            font = self.load_font(字体, 字体大小)
            
            if font:
                draw = ImageDraw.Draw(canvas)
                
                # 计算文本位置（在照片区域下方居中）
                try:
                    # 新版本Pillow方法
                    left, top, right, bottom = font.getbbox(文件名)
                    text_width = right - left
                    text_height = bottom - top
                except:
                    try:
                        # 旧版本方法
                        bbox = draw.textbbox((0, 0), 文件名, font=font)
                        text_width = bbox[2] - bbox[0]
                        text_height = bbox[3] - bbox[1]
                    except:
                        # 保守估计
                        text_width = len(文件名) * 字体大小
                        text_height = 字体大小
                
                # 确保文件名位置在安全区域内
                text_x = start_x + (content_width - text_width) // 2
                text_y = start_y + total_img_height + cm_to_pixels(0.1, 分辨率)
                
                if text_x >= margin_px and text_x + text_width <= canvas_width - margin_px:
                    # 绘制文本
                    draw.text((text_x, text_y), 文件名, font=font, fill=(0, 0, 0))
        
        return (self.pil_to_tensor(canvas),)
    
    def calculate_best_layout(self, width_cm, height_cm, dpi, margin_cm, spacing_cm, font_size, img_w, img_h, filename_area=0):
        # 计算原始方向布局数量
        count_normal = self.calculate_layout_count(
            width_cm, height_cm, dpi, margin_cm, spacing_cm, 
            font_size, img_w, img_h, filename_area
        )
        # 计算横版方向布局数量
        count_landscape = self.calculate_layout_count(
            height_cm, width_cm, dpi, margin_cm, spacing_cm, 
            font_size, img_w, img_h, filename_area
        )
        
        return count_landscape > count_normal
    
    def calculate_layout_count(self, width_cm, height_cm, dpi, margin_cm, spacing_cm, font_size, img_w, img_h, filename_area=0):
        # 计算画布尺寸
        canvas_width = cm_to_pixels(width_cm, dpi)
        canvas_height = cm_to_pixels(height_cm, dpi)
        margin_px = cm_to_pixels(margin_cm, dpi)
        spacing_px = cm_to_pixels(spacing_cm, dpi)
        
        # 计算文件名区域高度（如有需要）
        filename_area_height = filename_area if font_size > 0 else 0
        
        # 计算可用空间
        usable_width = canvas_width - 2 * margin_px
        usable_height = canvas_height - 2 * margin_px - filename_area_height
        
        # 计算行列数量
        cols = max(1, math.floor((usable_width + spacing_px) / (img_w + spacing_px)))
        rows = max(1, math.floor((usable_height + spacing_px) / (img_h + spacing_px)))
        
        # 如果内容过多，自动减少行数
        max_rows = max(1, math.floor((usable_height + spacing_px) / (img_h + spacing_px)))
        if rows > max_rows:
            rows = max_rows
        
        return cols * rows
    
    def tensor_to_pil(self, tensor):
        # 将四维张量转换为三维
        if len(tensor.shape) == 4:
            tensor = tensor[0]
        # 转换为0-255范围的整数
        tensor = tensor * 255.0
        tensor = tensor.clamp(0, 255)
        # 转换为NumPy数组
        array = tensor.cpu().numpy().astype(np.uint8)
        # 创建PIL图像
        return Image.fromarray(array)
    
    def pil_to_tensor(self, image):
        # 转换为NumPy数组
        array = np.array(image).astype(np.float32) / 255.0
        # 转换为张量
        tensor = torch.from_numpy(array).unsqueeze(0)
        return tensor

NODE_CLASS_MAPPINGS = {
    "SingleImageLayoutNode": SingleImageLayoutNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SingleImageLayoutNode": "孤海-单尺寸排版"
}