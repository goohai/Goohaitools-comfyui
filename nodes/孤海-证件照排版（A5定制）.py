import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np
import torch
import folder_paths

class GuHaiIDPhotoLayout:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        # 获取字体文件列表

        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        font_dir = os.path.join(parent_dir, "fonts")
        font_files = []
        if os.path.exists(font_dir) and os.path.isdir(font_dir):
            font_files = [f for f in os.listdir(font_dir) if f.lower().endswith(('.ttf', '.otf', '.ttc'))]
        
        return {
            "required": {
                "image": ("IMAGE",),
                "尺寸选择": (
                    ["小1寸 14张", "标准1寸 12张", "大1寸 8张", "小2寸 8张", 
                     "标准2寸 8张", "大2寸 8张", "小1寸 9张 + 小2寸 4张", 
                     "1寸 8张 + 小2寸 4张", "1寸 8张 + 2寸 4张"],
                ),
                "DPI": ("INT", {"default": 300, "min": 72, "max": 3000, "step": 1}),
                "描边宽度": ("INT", {"default": 1, "min": 0, "max": 50, "step": 1}),
                "描边颜色": ("COLOR", {"default": "#000000"}),
                "文件名": ("STRING", {"default": "证件照"}),
                "字体": (font_files,) if font_files else (["无可用字体"],),
                "文字大小": ("INT", {"default": 12, "min": 0, "max": 100, "step": 1})
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("排版图像",)
    FUNCTION = "layout_photos"
    CATEGORY = "孤海定制"
    
    def cm_to_pixel(self, cm, dpi):
        """将厘米转换为像素"""
        return int(cm * dpi / 2.54)
    
    def crop_image_to_ratio(self, img, target_width_cm, target_height_cm, dpi):
        """按目标比例裁剪图像，居中裁剪"""
        # 转换为像素
        target_width = self.cm_to_pixel(target_width_cm, dpi)
        target_height = self.cm_to_pixel(target_height_cm, dpi)
        target_ratio = target_width / target_height
        
        # 计算原始图像比例
        img_width, img_height = img.size
        img_ratio = img_width / img_height
        
        # 确定缩放比例
        if img_ratio > target_ratio:
            # 图像更宽，按高度缩放
            scale = target_height / img_height
            new_width = int(img_width * scale)
            new_height = target_height
            # 居中裁剪宽度
            crop_x = (new_width - target_width) // 2
            img = img.resize((new_width, new_height), Image.LANCZOS)
            img = img.crop((crop_x, 0, crop_x + target_width, target_height))
        else:
            # 图像更高，按宽度缩放
            scale = target_width / img_width
            new_width = target_width
            new_height = int(img_height * scale)
            # 居中裁剪高度
            crop_y = (new_height - target_height) // 2
            img = img.resize((new_width, new_height), Image.LANCZOS)
            img = img.crop((0, crop_y, target_width, crop_y + target_height))
        
        return img
    
    def add_border(self, img, width, color):
        """为图像添加边框"""
        if width <= 0:
            return img
        return ImageOps.expand(img, border=width, fill=color)
    
    def layout_photos(self, image, 尺寸选择, DPI, 描边宽度, 描边颜色, 文件名, 字体, 文字大小):
        # A5横版尺寸是21 × 14.8厘米
        a5_width_cm = 21  # 横版宽度
        a5_height_cm = 14.8  # 横版高度
        
        # 转换为像素
        canvas_width = self.cm_to_pixel(a5_width_cm, DPI)
        canvas_height = self.cm_to_pixel(a5_height_cm, DPI)
        
        # 创建白色画布
        canvas = Image.new('RGB', (canvas_width, canvas_height), color='white')
        draw = ImageDraw.Draw(canvas)
        
        # 转换颜色格式
        if 描边颜色.startswith('#'):
            描边颜色 = tuple(int(描边颜色[i:i+2], 16) for i in (1, 3, 5))
        
        # 从批次中获取第一张图片
        if isinstance(image, torch.Tensor):
            image = image[0].cpu().numpy()
            image = (image * 255).astype(np.uint8)
            image = Image.fromarray(image)
        else:
            image = image[0]
        
        # 定义各种证件照尺寸(厘米)
        sizes = {
            "小1寸": (2.2, 3.2),
            "标准1寸": (2.5, 3.5),
            "大1寸": (3.3, 4.8),
            "小2寸": (3.5, 4.5),
            "标准2寸": (3.5, 5),
            "大2寸": (3.5, 5.3),
            "2寸": (3.5, 5)  # 标准2寸的别名
        }
        
        # 间距(厘米)
        spacing_cm = 0.4
        spacing = self.cm_to_pixel(spacing_cm, DPI)
        
        # 根据选择的尺寸进行排版
        if 尺寸选择 == "小1寸 14张":
            # 小1寸 14张：水平7张，垂直2张
            w, h = sizes["小1寸"]
            photo_width = self.cm_to_pixel(w, DPI)
            photo_height = self.cm_to_pixel(h, DPI)
            
            # 计算总宽度和高度
            total_width = 7 * photo_width + 6 * spacing
            total_height = 2 * photo_height + 1 * spacing
            
            # 计算起始位置（居中）
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            # 裁剪照片
            cropped_img = self.crop_image_to_ratio(image, w, h, DPI)
            # 添加边框
            if 描边宽度 > 0:
                cropped_img = self.add_border(cropped_img, 描边宽度, 描边颜色)
            
            # 排版
            for row in range(2):
                for col in range(7):
                    x = start_x + col * (photo_width + spacing)
                    y = start_y + row * (photo_height + spacing)
                    canvas.paste(cropped_img, (x, y))
        
        elif 尺寸选择 == "标准1寸 12张":
            # 标准1寸 12张：水平6张，垂直2张
            w, h = sizes["标准1寸"]
            photo_width = self.cm_to_pixel(w, DPI)
            photo_height = self.cm_to_pixel(h, DPI)
            
            total_width = 6 * photo_width + 5 * spacing
            total_height = 2 * photo_height + 1 * spacing
            
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            cropped_img = self.crop_image_to_ratio(image, w, h, DPI)
            if 描边宽度 > 0:
                cropped_img = self.add_border(cropped_img, 描边宽度, 描边颜色)
            
            for row in range(2):
                for col in range(6):
                    x = start_x + col * (photo_width + spacing)
                    y = start_y + row * (photo_height + spacing)
                    canvas.paste(cropped_img, (x, y))
        
        elif 尺寸选择 == "大1寸 8张":
            # 大1寸 8张：水平4张，垂直2张
            w, h = sizes["大1寸"]
            photo_width = self.cm_to_pixel(w, DPI)
            photo_height = self.cm_to_pixel(h, DPI)
            
            total_width = 4 * photo_width + 3 * spacing
            total_height = 2 * photo_height + 1 * spacing
            
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            cropped_img = self.crop_image_to_ratio(image, w, h, DPI)
            if 描边宽度 > 0:
                cropped_img = self.add_border(cropped_img, 描边宽度, 描边颜色)
            
            for row in range(2):
                for col in range(4):
                    x = start_x + col * (photo_width + spacing)
                    y = start_y + row * (photo_height + spacing)
                    canvas.paste(cropped_img, (x, y))
        
        elif 尺寸选择 == "小2寸 8张":
            # 小2寸 8张：水平4张，垂直2张
            w, h = sizes["小2寸"]
            photo_width = self.cm_to_pixel(w, DPI)
            photo_height = self.cm_to_pixel(h, DPI)
            
            total_width = 4 * photo_width + 3 * spacing
            total_height = 2 * photo_height + 1 * spacing
            
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            cropped_img = self.crop_image_to_ratio(image, w, h, DPI)
            if 描边宽度 > 0:
                cropped_img = self.add_border(cropped_img, 描边宽度, 描边颜色)
            
            for row in range(2):
                for col in range(4):
                    x = start_x + col * (photo_width + spacing)
                    y = start_y + row * (photo_height + spacing)
                    canvas.paste(cropped_img, (x, y))
        
        elif 尺寸选择 == "标准2寸 8张":
            # 标准2寸 8张：水平4张，垂直2张
            w, h = sizes["标准2寸"]
            photo_width = self.cm_to_pixel(w, DPI)
            photo_height = self.cm_to_pixel(h, DPI)
            
            total_width = 4 * photo_width + 3 * spacing
            total_height = 2 * photo_height + 1 * spacing
            
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            cropped_img = self.crop_image_to_ratio(image, w, h, DPI)
            if 描边宽度 > 0:
                cropped_img = self.add_border(cropped_img, 描边宽度, 描边颜色)
            
            for row in range(2):
                for col in range(4):
                    x = start_x + col * (photo_width + spacing)
                    y = start_y + row * (photo_height + spacing)
                    canvas.paste(cropped_img, (x, y))
        
        elif 尺寸选择 == "大2寸 8张":
            # 大2寸 8张：水平4张，垂直2张
            w, h = sizes["大2寸"]
            photo_width = self.cm_to_pixel(w, DPI)
            photo_height = self.cm_to_pixel(h, DPI)
            
            total_width = 4 * photo_width + 3 * spacing
            total_height = 2 * photo_height + 1 * spacing
            
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            cropped_img = self.crop_image_to_ratio(image, w, h, DPI)
            if 描边宽度 > 0:
                cropped_img = self.add_border(cropped_img, 描边宽度, 描边颜色)
            
            for row in range(2):
                for col in range(4):
                    x = start_x + col * (photo_width + spacing)
                    y = start_y + row * (photo_height + spacing)
                    canvas.paste(cropped_img, (x, y))
        
        elif 尺寸选择 == "小1寸 9张 + 小2寸 4张":
            # 左侧：小1寸 9张（水平3张，垂直3张）
            w1, h1 = sizes["小1寸"]
            w2, h2 = sizes["小2寸"]
            
            photo1_width = self.cm_to_pixel(w1, DPI)
            photo1_height = self.cm_to_pixel(h1, DPI)
            photo2_width = self.cm_to_pixel(w2, DPI)
            photo2_height = self.cm_to_pixel(h2, DPI)
            
            # 计算左侧总尺寸
            left_width = 3 * photo1_width + 2 * spacing
            left_height = 3 * photo1_height + 2 * spacing
            
            # 计算右侧总尺寸
            right_width = 2 * photo2_width + 1 * spacing
            right_height = 2 * photo2_height + 1 * spacing
            
            # 整体总尺寸
            total_width = left_width + right_width + spacing
            total_height = max(left_height, right_height)
            
            # 起始位置（居中）
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            # 左侧排版
            cropped_img1 = self.crop_image_to_ratio(image, w1, h1, DPI)
            if 描边宽度 > 0:
                cropped_img1 = self.add_border(cropped_img1, 描边宽度, 描边颜色)
            
            for row in range(3):
                for col in range(3):
                    x = start_x + col * (photo1_width + spacing)
                    y = start_y + row * (photo1_height + spacing)
                    canvas.paste(cropped_img1, (x, y))
            
            # 右侧排版
            cropped_img2 = self.crop_image_to_ratio(image, w2, h2, DPI)
            if 描边宽度 > 0:
                cropped_img2 = self.add_border(cropped_img2, 描边宽度, 描边颜色)
            
            right_start_x = start_x + left_width + spacing
            for row in range(2):
                for col in range(2):
                    x = right_start_x + col * (photo2_width + spacing)
                    y = start_y + row * (photo2_height + spacing)
                    canvas.paste(cropped_img2, (x, y))
        
        elif 尺寸选择 == "1寸 8张 + 小2寸 4张":
            # 左侧：标准1寸 8张（旋转90度，水平2张，垂直4张）
            # 右侧：小2寸 4张（水平2张，垂直2张）
            w1, h1 = sizes["标准1寸"]
            w2, h2 = sizes["小2寸"]
            
            # 旋转后尺寸互换
            rotated_w1 = h1
            rotated_h1 = w1
            
            photo1_width = self.cm_to_pixel(rotated_w1, DPI)
            photo1_height = self.cm_to_pixel(rotated_h1, DPI)
            photo2_width = self.cm_to_pixel(w2, DPI)
            photo2_height = self.cm_to_pixel(h2, DPI)
            
            # 计算左侧总尺寸
            left_width = 2 * photo1_width + 1 * spacing
            left_height = 4 * photo1_height + 3 * spacing
            
            # 计算右侧总尺寸
            right_width = 2 * photo2_width + 1 * spacing
            right_height = 2 * photo2_height + 1 * spacing
            
            # 整体总尺寸
            total_width = left_width + right_width + spacing
            total_height = max(left_height, right_height)
            
            # 起始位置（居中）
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            # 左侧排版（旋转90度）
            cropped_img1 = self.crop_image_to_ratio(image, w1, h1, DPI)
            # 逆时针旋转90度
            cropped_img1 = cropped_img1.rotate(90, expand=True)
            if 描边宽度 > 0:
                cropped_img1 = self.add_border(cropped_img1, 描边宽度, 描边颜色)
            
            for row in range(4):
                for col in range(2):
                    x = start_x + col * (photo1_width + spacing)
                    y = start_y + row * (photo1_height + spacing)
                    canvas.paste(cropped_img1, (x, y))
            
            # 右侧排版
            cropped_img2 = self.crop_image_to_ratio(image, w2, h2, DPI)
            if 描边宽度 > 0:
                cropped_img2 = self.add_border(cropped_img2, 描边宽度, 描边颜色)
            
            right_start_x = start_x + left_width + spacing
            for row in range(2):
                for col in range(2):
                    x = right_start_x + col * (photo2_width + spacing)
                    y = start_y + row * (photo2_height + spacing)
                    canvas.paste(cropped_img2, (x, y))
        
        elif 尺寸选择 == "1寸 8张 + 2寸 4张":
            # 左侧：标准1寸 8张（旋转90度，水平2张，垂直4张）
            # 右侧：标准2寸 4张（水平2张，垂直2张）
            w1, h1 = sizes["标准1寸"]
            w2, h2 = sizes["标准2寸"]
            
            # 旋转后尺寸互换
            rotated_w1 = h1
            rotated_h1 = w1
            
            photo1_width = self.cm_to_pixel(rotated_w1, DPI)
            photo1_height = self.cm_to_pixel(rotated_h1, DPI)
            photo2_width = self.cm_to_pixel(w2, DPI)
            photo2_height = self.cm_to_pixel(h2, DPI)
            
            # 计算左侧总尺寸
            left_width = 2 * photo1_width + 1 * spacing
            left_height = 4 * photo1_height + 3 * spacing
            
            # 计算右侧总尺寸
            right_width = 2 * photo2_width + 1 * spacing
            right_height = 2 * photo2_height + 1 * spacing
            
            # 整体总尺寸
            total_width = left_width + right_width + spacing
            total_height = max(left_height, right_height)
            
            # 起始位置（居中）
            start_x = (canvas_width - total_width) // 2
            start_y = (canvas_height - total_height) // 2
            
            # 左侧排版（旋转90度）
            cropped_img1 = self.crop_image_to_ratio(image, w1, h1, DPI)
            # 逆时针旋转90度
            cropped_img1 = cropped_img1.rotate(90, expand=True)
            if 描边宽度 > 0:
                cropped_img1 = self.add_border(cropped_img1, 描边宽度, 描边颜色)
            
            for row in range(4):
                for col in range(2):
                    x = start_x + col * (photo1_width + spacing)
                    y = start_y + row * (photo1_height + spacing)
                    canvas.paste(cropped_img1, (x, y))
            
            # 右侧排版
            cropped_img2 = self.crop_image_to_ratio(image, w2, h2, DPI)
            if 描边宽度 > 0:
                cropped_img2 = self.add_border(cropped_img2, 描边宽度, 描边颜色)
            
            right_start_x = start_x + left_width + spacing
            for row in range(2):
                for col in range(2):
                    x = right_start_x + col * (photo2_width + spacing)
                    y = start_y + row * (photo2_height + spacing)
                    canvas.paste(cropped_img2, (x, y))
        
        # 添加文件名文字（如果文字大小不为0）
        if 文字大小 > 0 and 字体 and 字体 != "无可用字体":
            try:
                # 加载字体
                current_dir = os.path.dirname(os.path.abspath(__file__))
                parent_dir = os.path.dirname(current_dir)
                font_path = os.path.join(parent_dir, "fonts", 字体)
                font_obj = ImageFont.truetype(font_path, 文字大小)
                
                # 计算文字位置（所有照片底部Y值+0.5厘米）
                text_y = start_y + total_height + self.cm_to_pixel(0.5, DPI)
                
                # 水平居中
                text_bbox = draw.textbbox((0, 0), 文件名, font=font_obj)
                text_width = text_bbox[2] - text_bbox[0]
                text_x = (canvas_width - text_width) // 2
                
                # 绘制文字（黑色）
                draw.text((text_x, text_y), 文件名, font=font_obj, fill=(0, 0, 0))
            except Exception as e:
                print(f"添加文字时出错: {e}")
        
        # 转换为ComfyUI所需的格式
        canvas_np = np.array(canvas).astype(np.float32) / 255.0
        canvas_tensor = torch.from_numpy(canvas_np).unsqueeze(0)
        
        return (canvas_tensor,)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海-证件照排版（A5定制）": GuHaiIDPhotoLayout
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-证件照排版（A5定制）": "孤海-证件照排版（A5定制）"
}
    