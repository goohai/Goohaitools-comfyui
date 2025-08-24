import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import torch

class 孤海_图像添加水印:
    def __init__(self):
        # 修改为上级目录下的fonts文件夹
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        self.font_dir = os.path.join(parent_dir, "fonts")
        # 确保字体文件夹存在
        if not os.path.exists(self.font_dir):
            os.makedirs(self.font_dir)
        
    @classmethod
    def INPUT_TYPES(cls):
        # 获取可用字体列表 - 同样修改为上级目录下的fonts文件夹
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        font_dir = os.path.join(parent_dir, "fonts")
        font_files = []
        if os.path.exists(font_dir):
            font_files = [f for f in os.listdir(font_dir) if f.endswith(('.ttf', '.otf', '.ttc'))]
        
        return {
            "required": {
                "图像": ("IMAGE",),
                "水印文本": ("STRING", {"default": "水印"}),
                "字体": (font_files,),
                "水印大小百分比": ("INT", {"default": 5, "min": 0, "max": 100, "step": 1}),
                "水印不透明度": ("INT", {"default": 50, "min": 0, "max": 100, "step": 1}),
                "水平位置": (["居中", "靠左", "靠右"],),
                "垂直位置": (["居中", "靠上", "靠下"],),
                "X偏移百分比": ("INT", {"default": 0, "min": 0, "max": 50, "step": 1}),
                "Y偏移百分比": ("INT", {"default": 0, "min": 0, "max": 50, "step": 1}),
                "文字颜色": ("COLOR", {"default": "#FFFFFF"}),
                "水印平铺": ("BOOLEAN", {"default": False}),
                "水印角度": ("INT", {"default": 0, "min": -90, "max": 90, "step": 1}),
                "水印间距": ("INT", {"default": 10, "min": 0, "max": 50, "step": 1}),
                "输出透明通道": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "水印图像": ("IMAGE",),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "添加水印"
    CATEGORY = "孤海工具箱"
    
    def 添加水印(self, 图像, 水印文本, 字体, 水印大小百分比, 水印不透明度,
                  水平位置, 垂直位置, X偏移百分比, Y偏移百分比,
                  文字颜色, 水印平铺, 水印角度, 水印间距, 输出透明通道,
                  水印图像=None):
        # 将PyTorch张量转换为PIL图像
        img = self.张量转PIL(图像)
        
        # 确保图像有Alpha通道用于处理透明度
        if img.mode in ('RGB', 'L'):
            img = img.convert('RGBA')
        
        # 处理水印
        if 水印图像 is not None:
            # 使用图像水印
            watermark = self.张量转PIL(水印图像)
            result = self.应用图像水印(img, watermark, 水印大小百分比, 
                                        水印不透明度, 水平位置, 
                                        垂直位置, X偏移百分比, 
                                        Y偏移百分比, 水印角度)
        else:
            # 使用文字水印
            result = self.应用文字水印(img, 水印文本, 字体, 水印大小百分比, 
                                       水印不透明度, 水平位置, 
                                       垂直位置, X偏移百分比, 
                                       Y偏移百分比, 文字颜色, 水印平铺, 
                                       水印角度, 水印间距)
        
        # 处理输出通道
        if not 输出透明通道 and result.mode == 'RGBA':
            result = result.convert('RGB')
        
        # 将PIL图像转换回PyTorch张量
        return (self.PIL转张量(result),)
    
    def 应用图像水印(self, 原图, 水印图, 大小百分比, 不透明度, 
                     水平位置, 垂直位置, X偏移, Y偏移, 角度):
        # 调整水印大小 - 修改为按水印图像自身的百分比
        水印宽, 水印高 = 水印图.size
        比例 = 大小百分比 / 100.0
        新水印尺寸 = (int(水印宽 * 比例), int(水印高 * 比例))
        水印 = 水印图.resize(新水印尺寸, Image.Resampling.LANCZOS)
        
        # 确保水印有Alpha通道
        if 水印.mode != 'RGBA':
            水印 = 水印.convert('RGBA')
        
        # 调整水印透明度
        alpha = 水印.split()[3]
        alpha = ImageEnhance.Brightness(alpha).enhance(不透明度 / 100)
        水印.putalpha(alpha)
        
        # 旋转水印
        if 角度 != 0:
            水印 = 水印.rotate(角度, expand=True, resample=Image.Resampling.BICUBIC)
        
        # 计算水印位置
        水印宽, 水印高 = 水印.size
        原图宽, 原图高 = 原图.size
        x, y = self.计算位置(原图宽, 原图高, 水印宽, 水印高,
                            水平位置, 垂直位置, X偏移, Y偏移)
        
        # 创建一个临时图像来应用水印
        临时图层 = Image.new('RGBA', 原图.size, (0, 0, 0, 0))
        临时图层.paste(水印, (x, y), 水印)
        
        # 合并水印和原图
        return Image.alpha_composite(原图, 临时图层)
    
    def 应用文字水印(self, 原图, 文字, 字体名, 大小百分比, 不透明度, 
                    水平位置, 垂直位置, X偏移, Y偏移, 颜色, 
                    平铺, 角度, 间距):
        # 文字水印保持原来的逻辑 - 按底图高度的百分比
        原图宽, 原图高 = 原图.size
        文字大小 = int(原图高 * (大小百分比 / 100))
        
        # 加载字体（使用修改后的上级目录路径）
        字体路径 = os.path.join(self.font_dir, 字体名)
        try:
            字体 = ImageFont.truetype(字体路径, 文字大小)
        except:
            # 加载失败时使用默认字体
            字体 = ImageFont.load_default()
        
        # 获取文字大小和偏移量
        文字宽, 文字高, 偏移_y = self.获取文字大小(文字, 字体)
        
        # 创建足够大的文字图层（增加一些安全边距）
        安全边距 = int(文字大小 * 0.1)  # 10%的安全边距
        文字图层 = Image.new('RGBA', 
                             (文字宽 + 2 * 安全边距, 
                              文字高 + 2 * 安全边距), 
                             (0, 0, 0, 0))
        draw = ImageDraw.Draw(文字图层)
        
        # 解析颜色
        颜色带透明 = self.十六进制转RGBA(颜色, 不透明度)
        
        # 绘制文字（调整位置以避免截断）
        draw.text((安全边距, 安全边距 - 偏移_y), 文字, font=字体, fill=颜色带透明)
        
        # 旋转文字
        if 角度 != 0:
            文字图层 = 文字图层.rotate(角度, expand=True, resample=Image.Resampling.BICUBIC)
            文字宽, 文字高 = 文字图层.size
        
        # 创建临时图像来应用水印
        临时图层 = Image.new('RGBA', 原图.size, (0, 0, 0, 0))
        
        if 平铺:
            # 平铺水印
            间距像素 = int(原图高 * (间距 / 100))
            # 计算每行每列可以放置多少水印
            列数 = (原图宽 // (文字宽 + 间距像素)) + 2
            行数 = (原图高 // (文字高 + 间距像素)) + 2
            
            for i in range(列数):
                for j in range(行数):
                    x = i * (文字宽 + 间距像素) - 文字宽
                    y = j * (文字高 + 间距像素) - 文字高
                    临时图层.paste(文字图层, (x, y), 文字图层)
        else:
            # 单一水印
            x, y = self.计算位置(原图宽, 原图高, 文字宽, 文字高,
                                水平位置, 垂直位置, X偏移, Y偏移)
            临时图层.paste(文字图层, (x, y), 文字图层)
        
        # 合并水印和原图
        return Image.alpha_composite(原图, 临时图层)
    
    def 计算位置(self, 原图宽, 原图高, 水印宽, 水印高,
                水平位置, 垂直位置, X偏移, Y偏移):
        # 计算X偏移像素
        X偏移像素 = int(原图宽 * (X偏移 / 100))
        
        # 计算水平位置
        if 水平位置 == "靠左":
            x = X偏移像素
        elif 水平位置 == "靠右":
            x = 原图宽 - 水印宽 - X偏移像素
        else:  # 居中
            x = (原图宽 - 水印宽) // 2 + X偏移像素
        
        # 计算Y偏移像素
        Y偏移像素 = int(原图高 * (Y偏移 / 100))
        
        # 计算垂直位置
        if 垂直位置 == "靠上":
            y = Y偏移像素
        elif 垂直位置 == "靠下":
            y = 原图高 - 水印高 - Y偏移像素
        else:  # 居中
            y = (原图高 - 水印高) // 2 + Y偏移像素
        
        return x, y
    
    def 获取文字大小(self, 文字, 字体):
        # 改进的文字尺寸计算方法，考虑基线偏移
        临时图像 = Image.new('RGBA', (1000, 1000), (0, 0, 0, 0))  # 使用较大的临时图像
        draw = ImageDraw.Draw(临时图像)
        
        # 获取文本边界框
        bbox = draw.textbbox((0, 0), 文字, font=字体)
        left, top, right, bottom = bbox
        
        # 计算文字实际宽高
        文字宽 = right - left
        文字高 = bottom - top
        
        # 计算基线偏移（文字实际顶部到绘制点的距离）
        偏移_y = top
        
        return 文字宽, 文字高, 偏移_y
    
    def 十六进制转RGBA(self, 十六进制颜色, 不透明度):
        # 移除#号
        十六进制颜色 = 十六进制颜色.lstrip('#')
        # 解析RGB值
        r = int(十六进制颜色[0:2], 16)
        g = int(十六进制颜色[2:4], 16)
        b = int(十六进制颜色[4:6], 16)
        # 计算透明度
        a = int(255 * (不透明度 / 100))
        return (r, g, b, a)
    
    def 张量转PIL(self, 张量):
        # 将ComfyUI的张量格式转换为PIL图像
        if len(张量.shape) == 4:
            张量 = 张量[0]  # 取第一个图像
        img = 张量.cpu().numpy()
        img = np.clip(img * 255.0, 0, 255).astype(np.uint8)
        img = Image.fromarray(img)
        return img
    
    def PIL转张量(self, img):
        # 将PIL图像转换为ComfyUI的张量格式
        img_np = np.array(img).astype(np.float32) / 255.0
        if len(img_np.shape) == 3:
            img_np = img_np[None, ...]
        return torch.from_numpy(img_np)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "孤海-图像添加水印": 孤海_图像添加水印
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-图像添加水印": "孤海-图像添加水印"
}