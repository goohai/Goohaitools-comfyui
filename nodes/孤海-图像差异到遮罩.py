import torch
import numpy as np
from PIL import Image, ImageChops, ImageOps
import cv2
from skimage.measure import label, regionprops

class 孤海_图像差异到遮罩:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像1": ("IMAGE",),
                "图像2": ("IMAGE",),
                "阈值": ("INT", {"default": 25, "min": 0, "max": 255, "step": 1}),
                "最小区域": ("INT", {"default": 100, "min": 0, "max": 102400, "step": 1}),
                "填充漏洞": ("BOOLEAN", {"default": True}),
                "遮罩扩展": ("INT", {"default": 0, "min": -1024, "max": 1024, "step": 1}),
                "遮罩羽化": ("INT", {"default": 0, "min": 0, "max": 1024, "step": 1}),
            }
        }

    RETURN_TYPES = ("MASK",)
    FUNCTION = "calculate_mask"
    CATEGORY = "孤海工具箱"

    def calculate_mask(self, 图像1, 图像2, 阈值, 最小区域, 填充漏洞, 遮罩扩展, 遮罩羽化):
        # 转换张量为PIL图像
        img1 = Image.fromarray(np.clip(图像1[0].cpu().numpy()*255, 0, 255).astype(np.uint8))
        img2 = Image.fromarray(np.clip(图像2[0].cpu().numpy()*255, 0, 255).astype(np.uint8))

        # 确保图像尺寸一致
        if img1.size != img2.size:
            img2 = img2.resize(img1.size)

        # 计算差异（颜色和明度）
        diff_rgb = ImageChops.difference(img1, img2)
        diff_r = diff_rgb.getchannel(0)
        diff_g = diff_rgb.getchannel(1)
        diff_b = diff_rgb.getchannel(2)

        # 计算亮度差异
        gray1 = ImageOps.grayscale(img1)
        gray2 = ImageOps.grayscale(img2)
        diff_l = ImageChops.difference(gray1, gray2)

        # 合并差异（取最大值）
        final_diff = ImageChops.lighter(
            ImageChops.lighter(
                ImageChops.lighter(diff_r, diff_g),
                diff_b
            ),
            diff_l
        )

        # 应用阈值
        mask = final_diff.point(lambda p: 255 if p > 阈值 else 0).convert('1')

        # 转换为numpy数组处理
        mask_np = np.array(mask).astype(np.uint8)*255

        # 过滤小区域（移动到填充漏洞之前）
        if 最小区域 > 0:
            labeled = label(mask_np)
            regions = regionprops(labeled)
            for region in regions:
                if region.area < 最小区域:
                    mask_np[labeled == region.label] = 0

        # 填充漏洞
        if 填充漏洞:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
            mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_CLOSE, kernel)

        # 遮罩扩展/收缩
        if 遮罩扩展 != 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3,3))
            iterations = abs(遮罩扩展)
            if 遮罩扩展 > 0:
                mask_np = cv2.dilate(mask_np, kernel, iterations=iterations)
            else:
                mask_np = cv2.erode(mask_np, kernel, iterations=iterations)

        # 遮罩羽化
        if 遮罩羽化 > 0:
            mask_np = cv2.GaussianBlur(mask_np, (0, 0), sigmaX=遮罩羽化)

        # 转换为遮罩
        mask = Image.fromarray(mask_np).convert("L")
        mask_tensor = torch.from_numpy(np.array(mask).astype(np.float32) / 255.0)
        mask_tensor = mask_tensor.unsqueeze(0)

        return (mask_tensor,)

NODE_CLASS_MAPPINGS = {
    "孤海-图像差异到遮罩": 孤海_图像差异到遮罩
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-图像差异到遮罩": "孤海-图像差异到遮罩"
}