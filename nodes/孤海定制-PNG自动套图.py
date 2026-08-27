import numpy as np
import torch
from PIL import Image, ImageDraw
import cv2

class GuHaiPNGAutoMask:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "template_image": ("IMAGE",),
                "portrait_image": ("IMAGE",),
            },
        }
    
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process_images"
    CATEGORY = "孤海工具箱"
    TITLE = "孤海定制-PNG自动套图"
    
    def process_images(self, template_image, portrait_image):
        # 扩展像素数
        EXPANSION_PIXELS = 2
        # 最小透明区域像素面积阈值
        MIN_AREA_THRESHOLD = 50
        
        # 将输入的tensor转换为PIL图像
        # 转换模板图(RGBA)
        template_np = (template_image[0].cpu().numpy() * 255).astype(np.uint8)
        template_pil = Image.fromarray(template_np, mode='RGBA')
        
        # 转换人像图(RGB转RGBA)
        portrait_np = (portrait_image[0].cpu().numpy() * 255).astype(np.uint8)
        if portrait_np.shape[-1] == 3:
            portrait_pil = Image.fromarray(portrait_np, mode='RGB').convert('RGBA')
        else:
            portrait_pil = Image.fromarray(portrait_np, mode='RGBA')
        
        # 提取模板图的alpha通道
        alpha = template_pil.split()[-1]
        alpha_np = np.array(alpha)
        
        # 找到内部透明区域（闭合的透明区域）
        # 将alpha通道转换为二值图像（0表示透明，255表示不透明）
        _, binary = cv2.threshold(alpha_np, 1, 255, cv2.THRESH_BINARY)
        
        # 反转二值图像，以便找到透明区域
        binary_inv = cv2.bitwise_not(binary)
        
        # 查找轮廓，使用RETR_CCOMP获取所有轮廓（包括内部轮廓）
        contours, hierarchy = cv2.findContours(binary_inv, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        
        # 筛选内部轮廓（子轮廓）并过滤小面积区域
        inner_contours = []
        if hierarchy is not None:
            for i, contour in enumerate(contours):
                # 子轮廓的parentIdx >= 0（内部轮廓）
                if hierarchy[0][i][3] >= 0:
                    # 计算轮廓面积（像素数），过滤小于阈值的区域
                    area = cv2.contourArea(contour)
                    if area >= MIN_AREA_THRESHOLD:
                        # 检查轮廓是否闭合（OpenCV的findContours返回的轮廓默认是闭合的，这里做二次确认）
                        if len(contour) >= 3:  # 至少3个点才能构成封闭区域
                            inner_contours.append(contour)
        
        # 如果没有找到符合条件的内部轮廓，尝试从所有轮廓中筛选大面积区域
        if not inner_contours and contours:
            # 计算所有轮廓面积并过滤小面积
            valid_contours = [
                c for c in contours 
                if cv2.contourArea(c) >= MIN_AREA_THRESHOLD and len(c) >= 3
            ]
            if valid_contours:
                # 按面积排序取最大的
                valid_contours.sort(reverse=True, key=lambda x: cv2.contourArea(x))
                inner_contours = [valid_contours[0]]
        
        if not inner_contours:
            raise ValueError("未找到符合条件的内部透明区域（封闭、连续且面积≥50像素）")
        
        # 取最大的内部轮廓
        contour_areas = [cv2.contourArea(c) for c in inner_contours]
        max_contour = inner_contours[np.argmax(contour_areas)]
        
        # 计算轮廓的边界框，确定透明区域的范围
        x, y, w, h = cv2.boundingRect(max_contour)
        
        # 计算内部透明区域的中心点
        center_x = x + w // 2
        center_y = y + h // 2
        
        # 处理人像图：调整大小并居中
        portrait_w, portrait_h = portrait_pil.size
        
        # 计算考虑扩展像素后的目标尺寸（比透明区域大2像素）
        target_w = w + 2 * EXPANSION_PIXELS
        target_h = h + 2 * EXPANSION_PIXELS
        
        # 缩放逻辑：基于扩展后的目标尺寸计算，确保人像足够大
        # 计算人像宽高比
        portrait_ratio = portrait_w / portrait_h
        # 计算扩展后目标区域的宽高比
        target_ratio = target_w / target_h
        
        # 确定缩放比例：让最短边刚好超过透明区域，考虑扩展像素
        if portrait_ratio > target_ratio:
            # 人像更宽，按高度缩放
            scale = target_h / portrait_h
        else:
            # 人像更高或比例相同，按宽度缩放
            scale = target_w / portrait_w
        
        # 计算新尺寸
        new_w = int(portrait_w * scale)
        new_h = int(portrait_h * scale)
        
        # 缩放人像图，使用高质量缩放算法
        resized_portrait = portrait_pil.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # 计算放置位置（居中对齐）
        paste_x = center_x - new_w // 2
        paste_y = center_y - new_h // 2
        
        # 创建一个与模板图大小相同的透明图像作为中间层
        temp_image = Image.new('RGBA', template_pil.size, (0, 0, 0, 0))
        
        # 将缩放后的人像图粘贴到中间层
        temp_image.paste(resized_portrait, (paste_x, paste_y))
        
        # 创建内部透明区域的掩码，并扩展2个像素
        mask = Image.new('L', template_pil.size, 0)
        draw = ImageDraw.Draw(mask)
        
        # 将轮廓转换为适合PIL的格式
        contour_points = [(point[0][0], point[0][1]) for point in max_contour]
        
        # 转换轮廓为适合OpenCV处理的格式
        contour_np = np.array(contour_points, dtype=np.int32).reshape((-1, 1, 2))
        
        # 创建原始掩码
        mask_np = np.zeros(alpha_np.shape, dtype=np.uint8)
        cv2.fillPoly(mask_np, [contour_np], 255)
        
        # 扩展掩码边界2个像素
        kernel = np.ones((2*EXPANSION_PIXELS + 1, 2*EXPANSION_PIXELS + 1), np.uint8)
        expanded_mask_np = cv2.dilate(mask_np, kernel, iterations=1)
        
        # 转换回PIL图像
        expanded_mask = Image.fromarray(expanded_mask_np)
        
        # 将人像图限制在扩展后的掩码区域内
        temp_image.putalpha(expanded_mask)
        
        # 调整图层顺序，将人像放在模板下方
        # 创建一个背景透明的新图像
        result = Image.new('RGBA', template_pil.size, (0, 0, 0, 0))
        # 先粘贴人像
        result.paste(temp_image, (0, 0))
        # 再粘贴模板（模板会覆盖人像，只有透明区域能看到下方的人像）
        result.paste(template_pil, (0, 0), mask=template_pil.split()[-1])
        
        # 转换回tensor格式
        result_np = np.array(result).astype(np.float32) / 255.0
        result_tensor = torch.from_numpy(result_np).unsqueeze(0)
        
        return (result_tensor,)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "GuHaiPNGAutoMask": GuHaiPNGAutoMask
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHaiPNGAutoMask": "孤海定制-PNG自动套图"
}