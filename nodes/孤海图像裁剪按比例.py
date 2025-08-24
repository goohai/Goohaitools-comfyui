import torch
import numpy as np
import math
from PIL import Image, ImageOps
from nodes import MAX_RESOLUTION
import folder_paths

class 孤海图像裁剪按比例:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "图像": ("IMAGE",),
                "缩放方法": (["原始像素", "宽度不变", "高度不变", "总像素不变"], {"default": "原始像素"}),
                "比例宽": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 100.0, "step": 0.1}),
                "比例高": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 100.0, "step": 0.1}),
                "缩放插值": (["双线性插值", "双三次插值", "区域", "邻近-精确", "Lanczos"], {"default": "Lanczos"}),
                "缩放模式": (["裁剪", "填充"], {"default": "裁剪"}),
                "启用填充色": ("BOOLEAN", {"default": True}),
                "填充颜色": ("COLOR", {"default": "#ffffff"}),
                "自适应旋转": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "遮罩": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "MASK", "MASK", "BOOLEAN")
    RETURN_NAMES = ("图像", "宽度", "高度", "遮罩", "扩展遮罩", "布尔")
    FUNCTION = "process_image"
    CATEGORY = "孤海工具箱"

    def process_image(self, 图像, 缩放方法, 比例宽, 比例高, 缩放插值, 缩放模式, 启用填充色, 填充颜色, 自适应旋转, 遮罩=None):
        插值映射 = {
            "双线性插值": Image.BILINEAR,
            "双三次插值": Image.BICUBIC,
            "区域": Image.BOX,
            "邻近-精确": Image.NEAREST,
            "Lanczos": Image.LANCZOS
        }
        插值 = 插值映射[缩放插值]
        
        img = tensor2pil(图像)
        original_w, original_h = img.size
        rotated = False

        # 图像自适应旋转处理
        if 自适应旋转:
            target_ratio = 比例宽 / 比例高
            src_ratio = original_w / original_h
            if (target_ratio >= 1 and src_ratio < 1) or (target_ratio < 1 and src_ratio >= 1):
                if not (0.9 < target_ratio < 1.1) and not (0.9 < src_ratio < 1.1):
                    img = img.rotate(90, expand=True)
                    rotated = True
        w, h = img.size

        # 计算目标尺寸
        a, b = 比例宽, 比例高
        if 缩放方法 == "原始像素":
            if 缩放模式 == "裁剪":
                if w/h <= a/b:
                    new_w = w
                    new_h = int(b * w / a)
                else:
                    new_h = h
                    new_w = int(a * h / b)
            else:
                if w/h <= a/b:
                    new_h = h
                    new_w = int(a * h / b)
                else:
                    new_w = w
                    new_h = int(b * w / a)
        elif 缩放方法 == "宽度不变":
            new_w = w
            new_h = int(b * w / a)
        elif 缩放方法 == "高度不变":
            new_h = h
            new_w = int(a * h / b)
        else:  # 总像素不变
            total = w * h
            new_w = int(math.sqrt(total * a / b))
            new_h = int(math.sqrt(total * b / a))

        new_w, new_h = max(1, new_w), max(1, new_h)

        # 处理扩展遮罩
        if 缩放模式 == "裁剪":
            填充区域 = False
            mask = torch.zeros((new_h, new_w), dtype=torch.float32)
            img = ImageOps.fit(img, (new_w, new_h), method=插值, centering=(0.5, 0.5))
        else:
            scale = min(new_w/w, new_h/h)
            scaled_w = int(w * scale)
            scaled_h = int(h * scale)
            img = img.resize((scaled_w, scaled_h), resample=插值)
            
            pad_w = new_w - scaled_w
            pad_h = new_h - scaled_h
            left = pad_w // 2
            top = pad_h // 2
            right = pad_w - left
            bottom = pad_h - top
            
            if 启用填充色:
                color = Image.new("RGB", (1,1), 填充颜色).getpixel((0,0))
            else:
                color = (128, 128, 128)
            
            if max(pad_w, pad_h) > 0 and max(pad_w/new_w, pad_h/new_h) > 0.025:
                img = ImageOps.expand(img, (left, top, right, bottom), fill=color)
                填充区域 = True
                mask = torch.zeros((new_h, new_w), dtype=torch.float32)
                mask[top:top+scaled_h, left:left+scaled_w] = 1.0
                mask = 1 - mask
            else:
                填充区域 = False
                mask = torch.zeros((new_h, new_w), dtype=torch.float32)

        # 处理输入遮罩
        if 遮罩 is not None:
            mask_pil = mask2pil(遮罩)
            if rotated:
                mask_pil = mask_pil.rotate(90, expand=True)
            if 缩放模式 == "裁剪":
                mask_pil = ImageOps.fit(mask_pil, (new_w, new_h), method=Image.NEAREST, centering=(0.5, 0.5))
            else:
                original_mask_w, original_mask_h = mask_pil.size
                scale = min(new_w/original_mask_w, new_h/original_mask_h)
                scaled_w = int(original_mask_w * scale)
                scaled_h = int(original_mask_h * scale)
                mask_pil = mask_pil.resize((scaled_w, scaled_h), resample=Image.NEAREST)
                pad_w = new_w - scaled_w
                pad_h = new_h - scaled_h
                mask_pil = ImageOps.expand(mask_pil, 
                    (pad_w//2, pad_h//2, pad_w-pad_w//2, pad_h-pad_h//2), 
                    fill=0)
            output_mask = pil2mask(mask_pil)
        else:
            output_mask = torch.zeros((new_h, new_w), dtype=torch.float32)

        return (pil2tensor(img), new_w, new_h, output_mask.unsqueeze(0), mask.unsqueeze(0), 填充区域)

def tensor2pil(image):
    return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

def pil2tensor(image):
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def mask2pil(mask):
    return Image.fromarray(np.clip(255. * mask.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

def pil2mask(image):
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0)

NODE_CLASS_MAPPINGS = {
    "孤海图像裁剪按比例": 孤海图像裁剪按比例
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海图像裁剪按比例": "孤海图像裁剪按比例"
}