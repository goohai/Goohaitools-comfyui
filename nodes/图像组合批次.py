import torch
import numpy as np
from PIL import Image
import torchvision.transforms.functional as TF

class 孤海图像组合批次:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "统一尺寸模式": (["裁剪", "填充"], {"default": "裁剪"}),
            },
            "optional": {
                "图像1": ("IMAGE",),
                "图像2": ("IMAGE",),
                "图像3": ("IMAGE",),
                "图像4": ("IMAGE",),
                "图像5": ("IMAGE",),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "BOOLEAN", "INT")
    RETURN_NAMES = ("批次图像", "布尔", "批次总数")
    FUNCTION = "combine_images"
    CATEGORY = "孤海工具箱"

    def combine_images(self, 统一尺寸模式="裁剪", **kwargs):
        valid_images = []
        target_size = None
        batch_count = 0
        
        # 第一轮遍历：收集有效图像并确定目标尺寸
        for i in range(1, 6):
            img = kwargs.get(f"图像{i}")
            if img is not None and img.numel() > 0:
                valid_images.append(img)
                # 设置第一个有效图像的第一张作为目标尺寸
                if target_size is None:
                    target_size = img[0].shape[:2]  # 获取(H, W)
                batch_count += img.shape[0]  # 累加批次
        
        # 无有效图像处理
        if not valid_images:
            black_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (black_image, False, 0)
        
        # 第二轮遍历：调整所有图像尺寸
        processed_images = []
        for img_batch in valid_images:
            resized_batch = []
            for img in img_batch:
                # 将张量转换为PIL图像
                img_np = img.numpy() * 255.0
                pil_img = Image.fromarray(img_np.astype(np.uint8))
                
                # 原始尺寸和目标尺寸
                orig_width, orig_height = pil_img.size
                target_height, target_width = target_size
                
                # 根据模式计算不同的缩放比例
                if 统一尺寸模式 == "裁剪":
                    # 裁剪模式：使用最大比例确保覆盖整个区域
                    ratio = max(target_width / orig_width, target_height / orig_height)
                else:
                    # 填充模式：使用最小比例确保图像完整显示
                    ratio = min(target_width / orig_width, target_height / orig_height)
                
                # 计算新的尺寸
                new_width = int(orig_width * ratio + 0.5)
                new_height = int(orig_height * ratio + 0.5)
                
                # Lanczos缩放
                pil_img = pil_img.resize((new_width, new_height), resample=Image.LANCZOS)
                
                if 统一尺寸模式 == "裁剪":
                    # 裁剪模式：居中裁剪
                    left = max(0, (new_width - target_width) // 2)
                    top = max(0, (new_height - target_height) // 2)
                    right = left + target_width
                    bottom = top + target_height
                    pil_img = pil_img.crop((left, top, right, bottom))
                else:
                    # 填充模式：创建白色背景图像
                    new_img = Image.new("RGB", (target_width, target_height), (255, 255, 255))
                    # 计算居中粘贴位置
                    paste_x = max(0, (target_width - new_width) // 2)
                    paste_y = max(0, (target_height - new_height) // 2)
                    # 将缩放后的图像粘贴到白色背景上
                    new_img.paste(pil_img, (paste_x, paste_y))
                    pil_img = new_img
                
                # 转换回张量
                img_np = np.array(pil_img).astype(np.float32) / 255.0
                tensor_img = torch.from_numpy(img_np)
                resized_batch.append(tensor_img)
            
            # 合并批次并恢复原始格式
            resized_batch = torch.stack(resized_batch, dim=0)
            processed_images.append(resized_batch)
        
        # 组合所有处理后的图像
        combined = torch.cat(processed_images, dim=0)
        return (combined, True, batch_count)

# 注册节点
NODE_CLASS_MAPPINGS = {
    "孤海图像组合批次": 孤海图像组合批次
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海图像组合批次": "孤海-图像组合批次"
}