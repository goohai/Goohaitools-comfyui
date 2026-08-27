import os
import numpy as np
import torch
from PIL import Image, ImageOps
from nodes import SaveImage

class ChildPhotoLayoutNode:
    def __init__(self):
        self.dpi = 300
        self.output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')
        os.makedirs(self.output_dir, exist_ok=True)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "layout": ("STRING", {"default": ""}),
                "preserve_alpha": ("BOOLEAN", {"default": True}),
                "filename": ("STRING", {"default": "child_photo_layout"}),
                "save_path": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "layout_images"
    CATEGORY = "孤海定制"

    def cm_to_px(self, cm):
        return int(cm * self.dpi / 2.54 + 0.5)

    def layout_images(self, image, layout, preserve_alpha, filename, save_path):
        # 只处理第一张图像
        img_tensor = image[0].unsqueeze(0)
        img_np = img_tensor.numpy()[0] * 255.0
        img_pil = Image.fromarray(img_np.astype(np.uint8), 'RGBA')
        
        # 默认画布设置
        canvas_width_px = self.cm_to_px(21.0)
        canvas_height_px = self.cm_to_px(29.7)
        bg_color = (0, 0, 0, 0)  # 透明背景
        
        # 处理不同版式
        if layout == "1寸 42张":
            # 1寸42张版式
            photo_height_cm = 3.5
            rows, cols = 7, 6
            h_spacing_cm, v_spacing_cm = 0.28, 0.28
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "1寸 49张":
            # 1寸49张版式
            photo_height_cm = 3.5
            rows, cols = 7, 7
            h_spacing_cm, v_spacing_cm = 0.25, 0.25
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "2寸 25张":
            # 2寸25张版式
            photo_height_cm = 5.0
            rows, cols = 5, 5
            h_spacing_cm, v_spacing_cm = 0.20, 0.28
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "3寸 9张":
            # 3寸9张版式
            photo_height_cm = 8.5
            rows, cols = 3, 3
            h_spacing_cm, v_spacing_cm = 0.40, 0.50
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "1寸 18张 + 2寸 15张":
            # 混合版式
            canvas = Image.new("RGBA", (canvas_width_px, canvas_height_px), bg_color)
            
            # 上半部分：1寸18张
            top_photo_height_cm = 3.5
            top_rows, top_cols = 3, 6
            top_v_spacing_cm = 0.36
            top_section_height = self.cm_to_px(top_photo_height_cm) * top_rows + self.cm_to_px(top_v_spacing_cm) * (top_rows - 1)
            
            top_canvas = self.process_layout(img_pil, top_photo_height_cm, top_rows, top_cols,
                                             0, top_v_spacing_cm,
                                             canvas_width_px, top_section_height, bg_color,
                                             total_width_cm=18)
            
            # 下半部分：2寸15张
            bottom_photo_height_cm = 5.0
            bottom_rows, bottom_cols = 3, 5
            bottom_v_spacing_cm = 0.36
            bottom_section_height = self.cm_to_px(bottom_photo_height_cm) * bottom_rows + self.cm_to_px(bottom_v_spacing_cm) * (bottom_rows - 1)
            
            bottom_canvas = self.process_layout(img_pil, bottom_photo_height_cm, bottom_rows, bottom_cols,
                                               0, bottom_v_spacing_cm,
                                               canvas_width_px, bottom_section_height, bg_color,
                                               total_width_cm=18)
            
            # 合并两个部分（添加0.36cm垂直间距）
            vertical_spacing_px = self.cm_to_px(0.36)
            total_height = top_section_height + bottom_section_height + vertical_spacing_px
            top_offset = (canvas_height_px - total_height) // 2
            canvas.paste(top_canvas, (0, top_offset))
            canvas.paste(bottom_canvas, (0, top_offset + top_section_height + vertical_spacing_px))
        elif layout == "（小份）1寸 14张":
            # 小份1寸14张
            canvas_width_px = self.cm_to_px(21.0)
            canvas_height_px = self.cm_to_px(14.8)
            photo_height_cm = 3.5
            rows, cols = 2, 7
            h_spacing_cm, v_spacing_cm = 0.22, 1.0
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "（小份）1寸 21张":
            # 小份1寸21张
            canvas_width_px = self.cm_to_px(21.0)
            canvas_height_px = self.cm_to_px(14.8)
            photo_height_cm = 3.5
            rows, cols = 3, 7
            h_spacing_cm, v_spacing_cm = 0.22, 0.25
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "（小份）2寸 10张":
            # 小份2寸10张
            canvas_width_px = self.cm_to_px(21.0)
            canvas_height_px = self.cm_to_px(14.8)
            photo_height_cm = 5.0
            rows, cols = 2, 5
            h_spacing_cm, v_spacing_cm = 0.30, 0.80
            canvas = self.process_layout(img_pil, photo_height_cm, rows, cols, 
                                        h_spacing_cm, v_spacing_cm, 
                                        canvas_width_px, canvas_height_px, bg_color)
        elif layout == "（小份）1寸 7张+2寸 5张":
            # 小份混合版式
            canvas_width_px = self.cm_to_px(21.0)
            canvas_height_px = self.cm_to_px(14.8)
            section_spacing_px = self.cm_to_px(1.25)
            canvas = Image.new("RGBA", (canvas_width_px, canvas_height_px), bg_color)
            
            # 上半部分：1寸7张
            top_photo_height_cm = 3.5
            top_rows, top_cols = 1, 7
            top_section_height = self.cm_to_px(top_photo_height_cm)
            
            top_canvas = self.process_layout(img_pil, top_photo_height_cm, top_rows, top_cols,
                                             0, 0,
                                             canvas_width_px, top_section_height, bg_color,
                                             total_width_cm=18.5)
            
            # 下半部分：2寸5张
            bottom_photo_height_cm = 5.0
            bottom_rows, bottom_cols = 1, 5
            bottom_section_height = self.cm_to_px(bottom_photo_height_cm)
            
            bottom_canvas = self.process_layout(img_pil, bottom_photo_height_cm, bottom_rows, bottom_cols,
                                               0, 0,
                                               canvas_width_px, bottom_section_height, bg_color,
                                               total_width_cm=18.5)
            
            # 合并两个部分
            content_height = top_section_height + bottom_section_height + section_spacing_px
            top_offset = (canvas_height_px - content_height) // 2
            canvas.paste(top_canvas, (0, top_offset))
            canvas.paste(bottom_canvas, (0, top_offset + top_section_height + section_spacing_px))
        else:
            raise ValueError(f"未知版式: {layout}")
        
        # 自动保存图像（始终保存为带.png后缀的透明PNG）
        if not filename.lower().endswith('.png'):
            filename += '.png'
        save_fullpath = os.path.join(save_path, filename) if save_path else os.path.join(self.output_dir, filename)
        save_dir = os.path.dirname(save_fullpath)
        os.makedirs(save_dir, exist_ok=True)
        canvas.save(save_fullpath, dpi=(self.dpi, self.dpi), format="PNG")
        
        # 根据开关处理输出图像
        if not preserve_alpha:
            # 创建白底RGB图像
            white_bg = Image.new("RGB", canvas.size, (255, 255, 255))
            white_bg.paste(canvas, (0, 0), canvas.split()[3])  # 使用alpha通道作为遮罩
            canvas = white_bg
        
        # 转换为ComfyUI图像格式
        out_img = np.array(canvas).astype(np.float32) / 255.0
        out_img = torch.from_numpy(out_img).unsqueeze(0)
        
        return (out_img,)
    
    def process_layout(self, img_pil, photo_height_cm, rows, cols, h_spacing_cm, v_spacing_cm,
                      canvas_width, canvas_height, bg_color, total_width_cm=None):
        # 创建画布
        canvas = Image.new("RGBA", (canvas_width, canvas_height), bg_color)
        
        # 计算照片尺寸（像素）
        photo_height_px = self.cm_to_px(photo_height_cm)
        w_percent = photo_height_px / img_pil.height
        photo_width_px = int(img_pil.width * w_percent)
        
        # 等比例缩放照片
        resized_photo = img_pil.resize((photo_width_px, photo_height_px), Image.LANCZOS)
        
        # 计算间距（像素）
        h_spacing_px = self.cm_to_px(h_spacing_cm) if total_width_cm is None else 0
        v_spacing_px = self.cm_to_px(v_spacing_cm)
        
        # 计算水平间距（混合版式的特殊处理）
        if total_width_cm is not None:
            total_width_px = self.cm_to_px(total_width_cm)
            available_width = total_width_px
            cell_width = photo_width_px
            spacing_count = cols - 1
            h_spacing_px = max(0, (available_width - cols * cell_width) // spacing_count) if spacing_count > 0 else 0
        
        # 计算网格总尺寸
        grid_width = cols * photo_width_px + (cols - 1) * h_spacing_px
        grid_height = rows * photo_height_px + (rows - 1) * v_spacing_px
        
        # 计算起始位置（居中）
        start_x = (canvas_width - grid_width) // 2
        start_y = (canvas_height - grid_height) // 2
        
        # 排列照片
        for row in range(rows):
            for col in range(cols):
                x = start_x + col * (photo_width_px + h_spacing_px)
                y = start_y + row * (photo_height_px + v_spacing_px)
                canvas.paste(resized_photo, (x, y), resized_photo)
        
        return canvas

# 节点注册
NODE_CLASS_MAPPINGS = {
    "ChildPhotoLayoutNode": ChildPhotoLayoutNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ChildPhotoLayoutNode": "孤海定制-儿童贴拼版-方"
}