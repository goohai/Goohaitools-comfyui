import os
import torch
import numpy as np
from PIL import Image
import folder_paths
import math

class ChildrenStickerRound:
    """
    孤海定制-儿童贴拼版-圆
    """
    
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "尺寸": ("STRING", {"default": "2.5cm 63贴", "multiline": False}),
                "保留透明通道": ("BOOLEAN", {"default": True}),
                "文件名": ("STRING", {"default": "儿童贴拼版", "multiline": False}),
                "保存路径": ("STRING", {"default": "儿童贴", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "process"
    CATEGORY = "孤海定制"
    
    def process(self, 图像, 尺寸, 保留透明通道, 文件名, 保存路径):
        # 只取第一张图像
        if 图像.dim() == 4:
            图像 = 图像[0]
        
        # 转换Tensor为PIL图像
        i = 255. * 图像.cpu().numpy()
        img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        
        # 定义版式参数
        layouts = {
            "2.5cm 63贴": {
                "image_size": 2.5,
                "canvas_size": (21, 29.7),
                "rows": 9,
                "cols": 7,
                "h_spacing": 0.1,
                "v_spacing": 0.4
            },
            "3.0cm 42贴": {
                "image_size": 3.0,
                "canvas_size": (21, 29.7),
                "rows": 7,
                "cols": 6,
                "h_spacing": 0.2,
                "v_spacing": 0.35
            },
            "3.5cm 35贴": {
                "image_size": 3.5,
                "canvas_size": (21, 29.7),
                "rows": 7,
                "cols": 5,
                "h_spacing": 0.3,
                "v_spacing": 0.25
            },
            "4.0cm 24贴": {
                "image_size": 4.0,
                "canvas_size": (21, 29.7),
                "rows": 6,
                "cols": 4,
                "h_spacing": 0.4,
                "v_spacing": 0.20
            },
            "5.0cm 15贴": {
                "image_size": 5.0,
                "canvas_size": (21, 29.7),
                "rows": 5,
                "cols": 3,
                "h_spacing": 0.5,
                "v_spacing": 0.20
            },
            "2.5cm 10贴": {
                "image_size": 2.5,
                "canvas_size": (21, 14.8),
                "rows": 2,
                "cols": 5,
                "h_spacing": 0.6,
                "v_spacing": 1.60
            }
        }
        
        # 检查输入的尺寸是否有效
        if 尺寸 not in layouts:
            raise ValueError(f"不支持的尺寸: {尺寸}。请使用以下之一: {list(layouts.keys())}")
        
        layout = layouts[尺寸]
        
        # 厘米转像素 (300 DPI) - 使用round确保精确取整
        cm_to_px = lambda cm: int(round(cm * 300 / 2.54))
        
        # 计算图像和画布尺寸 - 严格确保尺寸正确
        img_size_px = cm_to_px(layout["image_size"])
        canvas_width_px = cm_to_px(layout["canvas_size"][0])
        canvas_height_px = cm_to_px(layout["canvas_size"][1])
        h_spacing_px = cm_to_px(layout["h_spacing"])
        v_spacing_px = cm_to_px(layout["v_spacing"])
        
        # 验证A4尺寸（21x29.7cm@300dpi应为2480×3508）
        if layout["canvas_size"] == (21, 29.7):
            assert canvas_width_px == 2480, f"宽度应为2480px，实际为{canvas_width_px}px"
            assert canvas_height_px == 3508, f"高度应为3508px，实际为{canvas_height_px}px"
        
        # 调整图像大小 - 使用精确尺寸
        img = img.resize((img_size_px, img_size_px), Image.LANCZOS)
        
        # 创建画布 - 使用精确计算尺寸
        if 保留透明通道:
            canvas_output = Image.new("RGBA", (canvas_width_px, canvas_height_px), (0, 0, 0, 0))
        else:
            canvas_output = Image.new("RGB", (canvas_width_px, canvas_height_px), (255, 255, 255))
        
        # 创建用于保存的画布（始终RGBA透明背景）
        canvas_save = Image.new("RGBA", (canvas_width_px, canvas_height_px), (0, 0, 0, 0))
        
        # 计算总排列区域宽度和高度
        total_width = layout["cols"] * img_size_px + (layout["cols"] - 1) * h_spacing_px
        total_height = layout["rows"] * img_size_px + (layout["rows"] - 1) * v_spacing_px
        
        # 计算起始位置（居中）
        start_x = max(0, (canvas_width_px - total_width) // 2)
        start_y = max(0, (canvas_height_px - total_height) // 2)
        
        # 排列图像到输出画布
        for row in range(layout["rows"]):
            for col in range(layout["cols"]):
                x = start_x + col * (img_size_px + h_spacing_px)
                y = start_y + row * (img_size_px + v_spacing_px)
                canvas_output.paste(img, (x, y), img if img.mode == 'RGBA' else None)
        
        # 排列图像到保存画布
        for row in range(layout["rows"]):
            for col in range(layout["cols"]):
                x = start_x + col * (img_size_px + h_spacing_px)
                y = start_y + row * (img_size_px + v_spacing_px)
                canvas_save.paste(img, (x, y), img if img.mode == 'RGBA' else None)
        
        # 转换回Tensor - 确保尺寸一致
        canvas_array = np.array(canvas_output).astype(np.float32) / 255.0
        canvas_tensor = torch.from_numpy(canvas_array).unsqueeze(0)
        
        # 处理保存路径
        if not os.path.isabs(保存路径):
            output_dir = folder_paths.get_output_directory()
            保存路径 = os.path.join(output_dir, 保存路径)
        
        # 确保目录存在
        os.makedirs(保存路径, exist_ok=True)
        
        # 处理文件名
        base_name, ext = os.path.splitext(文件名)
        if not ext:
            ext = ".png"
        
        # 查找可用的文件名
        counter = 1
        final_filename = f"{base_name}{ext}"
        while os.path.exists(os.path.join(保存路径, final_filename)):
            final_filename = f"{base_name}{counter:02d}{ext}"
            counter += 1
        
        # 完全无损保存（无压缩参数）
        canvas_save.save(
            os.path.join(保存路径, final_filename), 
            "PNG", 
            dpi=(300, 300)
        )
        
        return (canvas_tensor,)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "儿童贴拼版-圆": ChildrenStickerRound
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "儿童贴拼版-圆": "孤海定制-儿童贴拼版-圆"
}