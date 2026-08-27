import torch
import math
from PIL import Image, ImageDraw
import numpy as np
import nodes

class GH_18x6_Layout:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "画布宽mm": ("FLOAT", {"default": 180.0, "min": 10.0, "max": 1000.0, "step": 0.1, "round": 0.01}),
                "画布高mm": ("FLOAT", {"default": 60.0, "min": 10.0, "max": 1000.0, "step": 0.1, "round": 0.01}),
                "DPI": ("INT", {"default": 350, "min": 72, "max": 3000, "step": 1}),
                "边框x": ("INT", {"default": 20, "min": 0, "max": 1000, "step": 1}),
                "边框y": ("INT", {"default": 20, "min": 0, "max": 1000, "step": 1}),
            },
            "optional": {
                "logo": ("IMAGE",),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "layout_images"
    CATEGORY = "孤海定制/排版"
    
    def mm_to_pixels(self, mm, dpi):
        """将毫米转换为像素"""
        return int(mm * dpi / 25.4)
    
    def layout_images(self, image, 画布宽mm, 画布高mm, DPI, 边框x, 边框y, logo=None):
        # 转换单位为像素
        画布宽_px = self.mm_to_pixels(画布宽mm, DPI)
        画布高_px = self.mm_to_pixels(画布高mm, DPI)
        安全边距_px = self.mm_to_pixels(5, DPI)  # 5mm安全边距
        图片间距_px = self.mm_to_pixels(2, DPI)  # 2mm图片间距
        边框长度_px = self.mm_to_pixels(3, DPI)  # 3mm直角边框长度
        边框线宽 = 1  # 1像素边框
        
        # 创建空白画布
        canvas = Image.new('RGB', (画布宽_px, 画布高_px), color='white')
        
        # 获取输入图像（只取第一张）
        if len(image.shape) == 4:  # 批处理维度
            input_img = image[0]
        else:
            input_img = image
            
        # 转换张量为PIL图像
        input_img_np = input_img.cpu().numpy()
        if input_img_np.shape[0] == 3:  # 通道在前
            input_img_np = input_img_np.transpose(1, 2, 0)
        
        input_img_pil = Image.fromarray((input_img_np * 255).astype(np.uint8))
        图片宽, 图片高 = input_img_pil.size
        
        # 处理Logo
        logo_width_px = 0
        logo_height_px = 0
        logo_resized = None
        
        if logo is not None:
            # 获取Logo图像
            if len(logo.shape) == 4:
                logo_img = logo[0]
            else:
                logo_img = logo
                
            # 转换Logo张量为PIL图像
            logo_img_np = logo_img.cpu().numpy()
            if logo_img_np.shape[0] == 3:
                logo_img_np = logo_img_np.transpose(1, 2, 0)
            
            logo_img_pil = Image.fromarray((logo_img_np * 255).astype(np.uint8))
            
            # Logo目标尺寸
            logo_width_px = self.mm_to_pixels(12, DPI)
            logo_height_px = self.mm_to_pixels(50, DPI)
            
            # 调整Logo尺寸
            logo_resized = logo_img_pil.resize((logo_width_px, logo_height_px), Image.LANCZOS)
        
        # 计算可用宽度
        可用宽度 = 画布宽_px - 2 * 安全边距_px
        
        if logo_resized is not None:
            # 有Logo的情况
            # 计算可放置的图片数量（扣除Logo宽度和Logo与图片的间距）
            可用宽度_仅图片 = 可用宽度 - logo_width_px - 图片间距_px
            可放置图片数 = 1
            if 图片宽 + 图片间距_px <= 可用宽度_仅图片:
                可放置图片数 = int((可用宽度_仅图片 + 图片间距_px) / (图片宽 + 图片间距_px))
            
            # 计算总宽度
            总宽度 = logo_width_px + 图片间距_px + 可放置图片数 * 图片宽 + (可放置图片数 - 1) * 图片间距_px
            
            # 计算起始x位置（水平居中）
            起始x = (画布宽_px - 总宽度) // 2
            当前x = 起始x
            
            # 绘制Logo
            logo_y = (画布高_px - logo_height_px) // 2
            canvas.paste(logo_resized, (当前x, logo_y))
            当前x += logo_width_px + 图片间距_px
            
            # 绘制多张图片
            for i in range(可放置图片数):
                img_y = (画布高_px - 图片高) // 2
                canvas.paste(input_img_pil, (当前x, img_y))
                当前x += 图片宽 + 图片间距_px
        else:
            # 没有Logo的情况
            # 计算可放置的图片数量
            可放置图片数 = 1
            if 图片宽 + 图片间距_px <= 可用宽度:
                可放置图片数 = int((可用宽度 + 图片间距_px) / (图片宽 + 图片间距_px))
            
            # 计算总宽度
            总宽度 = 可放置图片数 * 图片宽 + (可放置图片数 - 1) * 图片间距_px
            
            # 计算起始x位置（水平居中）
            起始x = (画布宽_px - 总宽度) // 2
            当前x = 起始x
            
            # 绘制多张图片
            for i in range(可放置图片数):
                img_y = (画布高_px - 图片高) // 2
                canvas.paste(input_img_pil, (当前x, img_y))
                当前x += 图片宽 + 图片间距_px
        
        # 添加直角边框
        draw = ImageDraw.Draw(canvas)
        
        # 左上角直角
        draw.line([(边框x, 边框y), (边框x + 边框长度_px, 边框y)], fill="green", width=边框线宽)
        draw.line([(边框x, 边框y), (边框x, 边框y + 边框长度_px)], fill="green", width=边框线宽)
        
        # 右上角直角
        draw.line([(画布宽_px - 边框x, 边框y), (画布宽_px - 边框x - 边框长度_px, 边框y)], fill="green", width=边框线宽)
        draw.line([(画布宽_px - 边框x, 边框y), (画布宽_px - 边框x, 边框y + 边框长度_px)], fill="green", width=边框线宽)
        
        # 左下角直角
        draw.line([(边框x, 画布高_px - 边框y), (边框x + 边框长度_px, 画布高_px - 边框y)], fill="green", width=边框线宽)
        draw.line([(边框x, 画布高_px - 边框y), (边框x, 画布高_px - 边框y - 边框长度_px)], fill="green", width=边框线宽)
        
        # 右下角直角
        draw.line([(画布宽_px - 边框x, 画布高_px - 边框y), (画布宽_px - 边框x - 边框长度_px, 画布高_px - 边框y)], fill="green", width=边框线宽)
        draw.line([(画布宽_px - 边框x, 画布高_px - 边框y), (画布宽_px - 边框x, 画布高_px - 边框y - 边框长度_px)], fill="green", width=边框线宽)
        
        # 将PIL图像转换回张量
        canvas_np = np.array(canvas).astype(np.float32) / 255.0
        canvas_tensor = torch.from_numpy(canvas_np)[None,]
        
        return (canvas_tensor,)

# 节点映射代码
NODE_CLASS_MAPPINGS = {
    "GH_18x6_Layout": GH_18x6_Layout
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GH_18x6_Layout": "孤海定制-谢旭中排版"
}