import torch
import numpy as np
from PIL import Image, ImageFilter

class GulfSeaImageMergeMask:
    """
    孤海-图像合并（遮罩）
    将覆盖图根据遮罩叠加到背景图上
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "背景图": ("IMAGE",),
                "覆盖图": ("IMAGE",),
                "透明度": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "display": "slider"
                }),
                "遮罩扩展": ("INT", {
                    "default": 0,
                    "min": -100,
                    "max": 100,
                    "step": 1
                }),
                "模糊半径": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 100,
                    "step": 1
                }),
                "匹配图像大小": ("BOOLEAN", {
                    "default": False
                }),
            },
            "optional": {
                "遮罩": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "merge_images"
    CATEGORY = "孤海工具箱"
    
    def tensor_to_pil(self, tensor):
        """将张量转换为PIL图像"""
        if len(tensor.shape) == 4:
            tensor = tensor[0]
        tensor = tensor.clone().detach()
        tensor = tensor * 255.0
        tensor = tensor.clamp(0, 255)
        tensor = tensor.to(torch.uint8)
        tensor = tensor.cpu().numpy()
        return Image.fromarray(tensor)
    
    def pil_to_tensor(self, image):
        """将PIL图像转换为张量"""
        if image.mode == 'RGBA':
            image = image.convert('RGBA')
        else:
            image = image.convert('RGB')
        
        image = np.array(image).astype(np.float32) / 255.0
        image = torch.from_numpy(image)
        if len(image.shape) == 3:
            image = image.unsqueeze(0)
        return image
    
    def expand_mask(self, mask, expand_pixels):
        """扩展或收缩遮罩"""
        if expand_pixels == 0:
            return mask
        
        if expand_pixels > 0:
            # 膨胀操作
            for _ in range(expand_pixels):
                mask = mask.filter(ImageFilter.MaxFilter(3))
        else:
            # 腐蚀操作
            for _ in range(abs(expand_pixels)):
                mask = mask.filter(ImageFilter.MinFilter(3))
        
        return mask
    
    def blur_mask(self, mask, blur_radius):
        """模糊遮罩"""
        if blur_radius > 0:
            return mask.filter(ImageFilter.GaussianBlur(blur_radius))
        return mask
    
    def resize_to_match(self, image, target_size, method=Image.LANCZOS):
        """调整图像大小以匹配目标尺寸"""
        return image.resize(target_size, method)
    
    def center_overlay(self, background, overlay):
        """将覆盖图居中放置在背景图上"""
        bg_width, bg_height = background.size
        ov_width, ov_height = overlay.size
        
        # 创建新的背景图像
        result = background.copy()
        
        # 计算居中位置
        x = (bg_width - ov_width) // 2
        y = (bg_height - ov_height) // 2
        
        # 确保覆盖图在背景图范围内
        if x < 0:
            x = 0
        if y < 0:
            y = 0
        if x + ov_width > bg_width:
            ov_width = bg_width - x
        if y + ov_height > bg_height:
            ov_height = bg_height - y
        
        # 如果覆盖图超出范围，裁剪覆盖图
        if ov_width != overlay.width or ov_height != overlay.height:
            overlay = overlay.crop((0, 0, ov_width, ov_height))
        
        # 合并图像
        if overlay.mode == 'RGBA':
            result.paste(overlay, (x, y), overlay)
        else:
            result.paste(overlay, (x, y))
        
        return result
    
    def merge_images(self, 背景图, 覆盖图, 透明度, 遮罩扩展, 模糊半径, 匹配图像大小, 遮罩=None):
        # 转换为PIL图像
        bg_pil = self.tensor_to_pil(背景图)
        ov_pil = self.tensor_to_pil(覆盖图)
        
        # 确保都是RGBA模式
        if bg_pil.mode != 'RGBA':
            bg_pil = bg_pil.convert('RGBA')
        if ov_pil.mode != 'RGBA':
            ov_pil = ov_pil.convert('RGBA')
        
        # 处理遮罩：如果没有提供遮罩，创建全白遮罩（整个画布范围）
        if 遮罩 is None:
            # 创建与背景图相同大小的全白遮罩
            mask_np = np.ones(bg_pil.size[::-1], dtype=np.uint8) * 255  # 注意：PIL大小是(width, height)，numpy是(height, width)
            mask_pil = Image.fromarray(mask_np, mode='L')
        else:
            # 处理提供的遮罩
            if len(遮罩.shape) == 4:
                遮罩 = 遮罩[0]
            if len(遮罩.shape) == 3:
                遮罩 = 遮罩[0]
            
            mask_np = (遮罩.cpu().numpy() * 255).astype(np.uint8)
            mask_pil = Image.fromarray(mask_np, mode='L')
            
            # 调整遮罩大小以匹配背景图
            mask_pil = mask_pil.resize(bg_pil.size, Image.LANCZOS)
        
        # 应用遮罩扩展
        if 遮罩扩展 != 0:
            mask_pil = self.expand_mask(mask_pil, 遮罩扩展)
        
        # 应用模糊
        if 模糊半径 > 0:
            mask_pil = self.blur_mask(mask_pil, 模糊半径)
        
        # 调整覆盖图大小
        if 匹配图像大小:
            ov_pil = self.resize_to_match(ov_pil, bg_pil.size)
        else:
            # 如果不匹配大小，将覆盖图居中放置
            temp_bg = Image.new('RGBA', bg_pil.size, (0, 0, 0, 0))
            ov_pil = self.center_overlay(temp_bg, ov_pil)
        
        # 应用透明度到遮罩
        if 透明度 < 1.0:
            mask_array = np.array(mask_pil).astype(np.float32) * 透明度
            mask_pil = Image.fromarray(mask_array.astype(np.uint8), mode='L')
        
        # 如果透明度为0，直接返回背景图
        if 透明度 == 0:
            return (self.pil_to_tensor(bg_pil),)
        
        # 创建结果图像
        result = bg_pil.copy()
        
        # 应用遮罩合并
        if mask_pil.size != result.size:
            mask_pil = mask_pil.resize(result.size, Image.LANCZOS)
        
        # 确保覆盖图大小与背景图一致
        if ov_pil.size != result.size:
            ov_pil = self.resize_to_match(ov_pil, result.size)
        
        # 使用遮罩合并图像
        result = Image.composite(ov_pil, result, mask_pil)
        
        # 转换回张量
        result_tensor = self.pil_to_tensor(result)
        
        return (result_tensor,)

# 注册节点
NODE_CLASS_MAPPINGS = {
    "GulfSeaImageMergeMask": GulfSeaImageMergeMask
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GulfSeaImageMergeMask": "孤海-图像合并（遮罩）"
}