import torch
import numpy as np
from PIL import Image
import math
import nodes
import os

# 单位转换函数
def cm_to_pixels(cm, dpi=300):
    return int(cm * dpi / 2.54 + 0.5)

# 排版辅助函数
def create_collage(canvas_width_px, canvas_height_px, rows, cols, 
                   total_width_cm, total_height_cm, image, target_width_cm):
    # 计算目标宽度（像素）
    target_width_px = cm_to_pixels(target_width_cm)
    
    # 等比例缩放图片
    w, h = image.size
    aspect_ratio = h / w
    target_height_px = int(target_width_px * aspect_ratio)
    resized_img = image.resize((target_width_px, target_height_px), Image.LANCZOS)
    
    # 计算网格总尺寸（像素）
    grid_width_px = cm_to_pixels(total_width_cm)
    grid_height_px = cm_to_pixels(total_height_cm)
    
    # 计算可用空间（减去图片占用的空间）
    available_width = grid_width_px - cols * target_width_px
    available_height = grid_height_px - rows * target_height_px
    
    # 计算间距
    spacing_x = available_width // (cols - 1) if cols > 1 else 0
    spacing_y = available_height // (rows - 1) if rows > 1 else 0
    
    # 创建网格图像
    grid = Image.new("RGBA", (grid_width_px, grid_height_px), (0, 0, 0, 0))
    
    # 粘贴所有图片
    for row in range(rows):
        for col in range(cols):
            x = col * (target_width_px + spacing_x)
            y = row * (target_height_px + spacing_y)
            grid.paste(resized_img, (x, y), resized_img)
    
    # 居中网格
    result = Image.new("RGBA", (canvas_width_px, canvas_height_px), (0, 0, 0, 0))
    x_offset = (canvas_width_px - grid.width) // 2
    y_offset = (canvas_height_px - grid.height) // 2
    result.paste(grid, (x_offset, y_offset))
    
    return result

class ChildrenCollageNode:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "版式": ("STRING", {"multiline": False, "default": "小号 78贴"}),
                "保留透明通道": ("BOOLEAN", {"default": True}),
                "文件名": ("STRING", {"multiline": False, "default": "儿童贴拼版"}),
                "保存路径": ("STRING", {"multiline": False, "default": "output/排版"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "layout_images"
    CATEGORY = "孤海定制"
    
    def layout_images(self, image, 版式, 保留透明通道, 文件名, 保存路径):
        # 只取批次中的第一张图像
        img_tensor = image[0]
        img_pil = Image.fromarray(np.clip(255. * img_tensor.cpu().numpy(), 0, 255).astype(np.uint8))
        
        # 根据版式名称处理不同排版
        result = None
        # 记录画布尺寸（厘米），用于DPI设置
        canvas_width_cm = 21.0
        canvas_height_cm = 29.7
        
        if 版式 == "小号 78贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    13, 6, 18, 23, img_pil, 2.8)
            
        elif 版式 == "中号 60贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    12, 5, 18, 23, img_pil, 3.4)
            
        elif 版式 == "大号 44贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    11, 4, 18, 26, img_pil, 4.3)
            
        elif 版式 == "特大号 30贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    10, 3, 17.5, 27.4, img_pil, 5.5)
            
        elif 版式 == "超大号 20贴":
            canvas_width_px = cm_to_pixels(29.7)
            canvas_height_px = cm_to_pixels(21)
            canvas_width_cm = 29.7
            canvas_height_cm = 21.0
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    5, 4, 27, 18, img_pil, 6.5)
            
        elif 版式 == "（小份） 小号 36贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(14.8)
            canvas_height_cm = 14.8
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    6, 6, 18, 10, img_pil, 2.8)
            
        elif 版式 == "（小份） 中号 30贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(14.8)
            canvas_height_cm = 14.8
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    6, 5, 18, 11, img_pil, 3.4)
            
        elif 版式 == "（小份） 大号 20贴":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(14.8)
            canvas_height_cm = 14.8
            result = create_collage(canvas_width_px, canvas_height_px, 
                                    5, 4, 18, 11, img_pil, 4.3)
            
        elif 版式 == "（组合） 大24 + 中30":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            
            # 上半部分 - 大号
            big_width_px = cm_to_pixels(4.3)
            big_img = img_pil.copy()
            big_img = big_img.resize((big_width_px, int(img_pil.height * big_width_px / img_pil.width)), Image.LANCZOS)
            
            # 上半部分网格（6行4列）
            top_grid = Image.new("RGBA", (cm_to_pixels(18), cm_to_pixels(14.5)), (0, 0, 0, 0))
            top_grid_rows, top_grid_cols = 6, 4
            top_target_width_px = cm_to_pixels(4.3)
            top_target_height_px = int(img_pil.height * top_target_width_px / img_pil.width)
            top_spacing_x = (top_grid.width - top_grid_cols * top_target_width_px) // (top_grid_cols - 1)
            top_spacing_y = (top_grid.height - top_grid_rows * top_target_height_px) // (top_grid_rows - 1)
            
            for row in range(top_grid_rows):
                for col in range(top_grid_cols):
                    x = col * (top_target_width_px + top_spacing_x)
                    y = row * (top_target_height_px + top_spacing_y)
                    big_img_copy = big_img.copy()
                    big_img_copy = big_img_copy.resize((top_target_width_px, top_target_height_px), Image.LANCZOS)
                    top_grid.paste(big_img_copy, (x, y), big_img_copy)
            
            # 下半部分 - 中号
            mid_width_px = cm_to_pixels(3.4)
            mid_img = img_pil.copy()
            mid_img = mid_img.resize((mid_width_px, int(img_pil.height * mid_width_px / img_pil.width)), Image.LANCZOS)
            
            # 下半部分网格（6行5列）
            bottom_grid = Image.new("RGBA", (cm_to_pixels(18), cm_to_pixels(12)), (0, 0, 0, 0))
            bottom_grid_rows, bottom_grid_cols = 6, 5
            bottom_target_width_px = cm_to_pixels(3.4)
            bottom_target_height_px = int(img_pil.height * bottom_target_width_px / img_pil.width)
            bottom_spacing_x = (bottom_grid.width - bottom_grid_cols * bottom_target_width_px) // (bottom_grid_cols - 1)
            bottom_spacing_y = (bottom_grid.height - bottom_grid_rows * bottom_target_height_px) // (bottom_grid_rows - 1)
            
            for row in range(bottom_grid_rows):
                for col in range(bottom_grid_cols):
                    x = col * (bottom_target_width_px + bottom_spacing_x)
                    y = row * (bottom_target_height_px + bottom_spacing_y)
                    mid_img_copy = mid_img.copy()
                    mid_img_copy = mid_img_copy.resize((bottom_target_width_px, bottom_target_height_px), Image.LANCZOS)
                    bottom_grid.paste(mid_img_copy, (x, y), mid_img_copy)
            
            # 合并两部分
            composite_grid = Image.new("RGBA", (canvas_width_px, canvas_height_px), (0, 0, 0, 0))
            space_px = cm_to_pixels(0.7)
            
            # 计算垂直居中位置
            total_height = top_grid.height + bottom_grid.height + space_px
            start_y = (composite_grid.height - total_height) // 2
            
            # 水平居中粘贴
            composite_grid.paste(
                top_grid, 
                ((composite_grid.width - top_grid.width) // 2, start_y)
            )
            composite_grid.paste(
                bottom_grid, 
                ((composite_grid.width - bottom_grid.width) // 2, 
                 start_y + top_grid.height + space_px)
            )
            
            result = composite_grid
            
        elif 版式 == "（组合） 大16 + 中20 + 小24":
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            
            # 上部分 - 小号
            small_width_px = cm_to_pixels(2.8)
            small_img = img_pil.copy()
            small_img = small_img.resize((small_width_px, int(img_pil.height * small_width_px / img_pil.width)), Image.LANCZOS)
            
            # 上部分网格（4行6列）
            top_grid = Image.new("RGBA", (cm_to_pixels(18.5), cm_to_pixels(6.5)), (0, 0, 0, 0))
            top_grid_rows, top_grid_cols = 4, 6
            top_target_width_px = cm_to_pixels(2.8)
            top_target_height_px = int(img_pil.height * top_target_width_px / img_pil.width)
            top_spacing_x = (top_grid.width - top_grid_cols * top_target_width_px) // (top_grid_cols - 1)
            top_spacing_y = (top_grid.height - top_grid_rows * top_target_height_px) // (top_grid_rows - 1)
            
            for row in range(top_grid_rows):
                for col in range(top_grid_cols):
                    x = col * (top_target_width_px + top_spacing_x)
                    y = row * (top_target_height_px + top_spacing_y)
                    small_img_copy = small_img.copy()
                    small_img_copy = small_img_copy.resize((top_target_width_px, top_target_height_px), Image.LANCZOS)
                    top_grid.paste(small_img_copy, (x, y), small_img_copy)
            
            # 中部分 - 中号
            mid_width_px = cm_to_pixels(3.4)
            mid_img = img_pil.copy()
            mid_img = mid_img.resize((mid_width_px, int(img_pil.height * mid_width_px / img_pil.width)), Image.LANCZOS)
            
            # 中部分网格（4行5列）
            mid_grid = Image.new("RGBA", (cm_to_pixels(18.5), cm_to_pixels(7.6)), (0, 0, 0, 0))
            mid_grid_rows, mid_grid_cols = 4, 5
            mid_target_width_px = cm_to_pixels(3.4)
            mid_target_height_px = int(img_pil.height * mid_target_width_px / img_pil.width)
            mid_spacing_x = (mid_grid.width - mid_grid_cols * mid_target_width_px) // (mid_grid_cols - 1)
            mid_spacing_y = (mid_grid.height - mid_grid_rows * mid_target_height_px) // (mid_grid_rows - 1)
            
            for row in range(mid_grid_rows):
                for col in range(mid_grid_cols):
                    x = col * (mid_target_width_px + mid_spacing_x)
                    y = row * (mid_target_height_px + mid_spacing_y)
                    mid_img_copy = mid_img.copy()
                    mid_img_copy = mid_img_copy.resize((mid_target_width_px, mid_target_height_px), Image.LANCZOS)
                    mid_grid.paste(mid_img_copy, (x, y), mid_img_copy)
            
            # 下部分 - 大号
            big_width_px = cm_to_pixels(4.3)
            big_img = img_pil.copy()
            big_img = big_img.resize((big_width_px, int(img_pil.height * big_width_px / img_pil.width)), Image.LANCZOS)
            
            # 下部分网格（4行4列）
            bottom_grid = Image.new("RGBA", (cm_to_pixels(18.5), cm_to_pixels(9.2)), (0, 0, 0, 0))
            bottom_grid_rows, bottom_grid_cols = 4, 4
            bottom_target_width_px = cm_to_pixels(4.3)
            bottom_target_height_px = int(img_pil.height * bottom_target_width_px / img_pil.width)
            bottom_spacing_x = (bottom_grid.width - bottom_grid_cols * bottom_target_width_px) // (bottom_grid_cols - 1)
            bottom_spacing_y = (bottom_grid.height - bottom_grid_rows * bottom_target_height_px) // (bottom_grid_rows - 1)
            
            for row in range(bottom_grid_rows):
                for col in range(bottom_grid_cols):
                    x = col * (bottom_target_width_px + bottom_spacing_x)
                    y = row * (bottom_target_height_px + bottom_spacing_y)
                    big_img_copy = big_img.copy()
                    big_img_copy = big_img_copy.resize((bottom_target_width_px, bottom_target_height_px), Image.LANCZOS)
                    bottom_grid.paste(big_img_copy, (x, y), big_img_copy)
            
            # 合并三部分
            composite_grid = Image.new("RGBA", (canvas_width_px, canvas_height_px), (0, 0, 0, 0))
            space_px = cm_to_pixels(0.6)
            
            # 计算垂直居中位置
            total_height = top_grid.height + mid_grid.height + bottom_grid.height + 2 * space_px
            start_y = (composite_grid.height - total_height) // 2
            
            # 水平居中粘贴
            composite_grid.paste(
                top_grid, 
                ((composite_grid.width - top_grid.width) // 2, start_y)
            )
            composite_grid.paste(
                mid_grid, 
                ((composite_grid.width - mid_grid.width) // 2, 
                 start_y + top_grid.height + space_px)
            )
            composite_grid.paste(
                bottom_grid, 
                ((composite_grid.width - bottom_grid.width) // 2, 
                 start_y + top_grid.height + space_px + mid_grid.height + space_px)
            )
            
            result = composite_grid
            
        else:
            # 默认为空白图像
            canvas_width_px = cm_to_pixels(21)
            canvas_height_px = cm_to_pixels(29.7)
            result = Image.new("RGBA", (canvas_width_px, canvas_height_px), (0, 0, 0, 0))
        
        # 自动保存图像（始终保存为RGBA模式的PNG，DPI=300）
        if 保存路径.strip() != "":
            # 根据操作系统转换路径分隔符
            保存路径 = 保存路径.replace("/", os.path.sep).replace("\\", os.path.sep)
            
            # 创建目录（如果不存在）
            os.makedirs(保存路径, exist_ok=True)
            
            # 处理文件名（确保以.png结尾）
            基础文件名 = 文件名.strip()
            if not 基础文件名:
                基础文件名 = "儿童贴拼版"
            
            # 移除可能存在的扩展名
            if 基础文件名.lower().endswith('.png'):
                基础文件名 = 基础文件名[:-4]
            
            # 生成不重复的文件名
            序号 = 1
            while True:
                if 序号 == 1:
                    完整路径 = os.path.join(保存路径, f"{基础文件名}.png")
                else:
                    完整路径 = os.path.join(保存路径, f"{基础文件名}{序号:02d}.png")
                
                if not os.path.exists(完整路径):
                    break
                序号 += 1
            
            # 保存图像（始终RGBA模式，DPI=300）
            # 计算DPI元数据（基于画布尺寸）
            x_dpi = int(300)
            y_dpi = int(300)
            
            # 保存图像并设置DPI
            result.save(完整路径, "PNG", dpi=(x_dpi, y_dpi))
        
        # 处理透明通道（仅影响输出，不影响保存）
        if not 保留透明通道:
            background = Image.new("RGB", result.size, (255, 255, 255))
            background.paste(result, mask=result.split()[3])  # 使用alpha通道作为mask
            result = background
        
        # 转换为ComfyUI图像格式
        result = np.array(result).astype(np.float32) / 255.0
        result = torch.from_numpy(result)[None,]
        return (result,)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海定制-儿童贴拼版-长": ChildrenCollageNode
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海定制-儿童贴拼版-长": "孤海定制 - 儿童贴拼版 - 长"
}