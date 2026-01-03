import os
import re
import numpy as np
from PIL import Image
import torch
import folder_paths

def auto_crop_image(image):
    img = image.convert("RGB")
    img_array = np.array(img)
    
    # 检测背景颜色（取四个角的颜色）
    corners = [
        img_array[0, 0], 
        img_array[0, -1], 
        img_array[-1, 0], 
        img_array[-1, -1]
    ]
    bg_color = np.median(corners, axis=0)
    
    # 定义颜色差异阈值
    threshold = 30
    
    # 上边界
    top = 0
    for row in img_array:
        if np.any(np.abs(row - bg_color) > threshold):
            break
        top += 1
    
    # 下边界
    bottom = img_array.shape[0] - 1
    for row in reversed(img_array):
        if np.any(np.abs(row - bg_color) > threshold):
            break
        bottom -= 1
    
    # 左边界
    left = 0
    for col in img_array.transpose(1, 0, 2):
        if np.any(np.abs(col - bg_color) > threshold):
            break
        left += 1
    
    # 右边界
    right = img_array.shape[1] - 1
    for col in reversed(img_array.transpose(1, 0, 2)):
        if np.any(np.abs(col - bg_color) > threshold):
            break
        right -= 1
    
    return img.crop((left, top, right+1, bottom+1))

class GuHaiAutoImageSplit:
    CATEGORY = "孤海工具箱"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("分割图像",)
    FUNCTION = "split_image"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "保存目录": ("STRING", {"default": "output"}),
                "水平张数": ("INT", {"default": 4, "min": 1}),
                "垂直张数": ("INT", {"default": 2, "min": 1}),
                "移除画布边缘": ("BOOLEAN", {"default": True}),
                "移除描边": ("INT", {"default": 0, "min": 0}),
                "文件名前缀": ("STRING", {"default": "孤海图像分割_"}),
                "保存格式": (["PNG", "JPG"], {"default": "PNG"}),
            }
        }

    def split_image(self, 图像, 保存目录, 水平张数, 垂直张数, 移除画布边缘, 移除描边, 文件名前缀, 保存格式):
        # 处理空文件名前缀
        if not 文件名前缀.strip():
            文件名前缀 = "孤海图像分割_"
        
        # 转换张量为PIL图像
        img_tensor = 图像[0].cpu().numpy()
        img_array = np.clip(img_tensor * 255.0, 0, 255).astype(np.uint8)
        img = Image.fromarray(img_array)
        
        # 根据开关处理图像
        if 移除画布边缘:
            processed_img = auto_crop_image(img)
        else:
            processed_img = img  # 直接使用原始图像
        
        img_width, img_height = processed_img.size
        
        # 计算分块尺寸
        tile_width = img_width // 水平张数
        tile_height = img_height // 垂直张数
        
        # 创建保存目录
        full_path = os.path.join(folder_paths.get_output_directory(), 保存目录)
        os.makedirs(full_path, exist_ok=True)
        
        # 处理保存格式
        format_map = {
            "JPG": ("JPEG", "jpg"),
            "PNG": ("PNG", "png")
        }
        save_format, ext = format_map[保存格式]
        save_args = {"format": save_format}
        if save_format == "JPEG":
            save_args["quality"] = 95
        
        # 获取现有文件最大编号
        max_counter = 0
        pattern = re.compile(rf"^{re.escape(文件名前缀)}(\d{{2,}})\.{ext}$", re.IGNORECASE)
        for filename in os.listdir(full_path):
            match = pattern.match(filename)
            if match:
                current_num = int(match.group(1))
                if current_num > max_counter:
                    max_counter = current_num
        
        # 分割并保存图像
        output_images = []
        counter = max_counter + 1
        for y in range(垂直张数):
            for x in range(水平张数):
                # 计算原始分块位置
                left = x * tile_width
                upper = y * tile_height
                right = left + tile_width
                lower = upper + tile_height
                
                # 裁剪原始分块
                tile = processed_img.crop((left, upper, right, lower))
                
                # 应用移除描边
                if 移除描边 > 0:
                    w, h = tile.size
                    # 确保裁剪后尺寸有效
                    trim_size = min(移除描边, w//2-1, h//2-1)
                    if trim_size > 0:
                        tile = tile.crop((
                            trim_size,
                            trim_size,
                            w - trim_size,
                            h - trim_size
                        ))
                
                # 转换模式兼容JPG
                if save_format == "JPEG" and tile.mode in ("RGBA", "LA"):
                    tile = tile.convert("RGB")
                
                # 生成文件名
                filename = f"{文件名前缀}{counter:02d}.{ext}"
                save_path = os.path.join(full_path, filename)
                tile.save(save_path, **save_args)
                
                # 转换回张量格式
                tile_np = np.array(tile).astype(np.float32) / 255.0
                tile_tensor = torch.from_numpy(tile_np).unsqueeze(0)
                output_images.append(tile_tensor)
                counter += 1
        
        return (torch.cat(output_images, dim=0),)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "GuHaiAutoImageSplit": GuHaiAutoImageSplit
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHaiAutoImageSplit": "孤海自动分割图像"
}