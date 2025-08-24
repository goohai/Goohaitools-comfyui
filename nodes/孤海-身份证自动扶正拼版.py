import numpy as np
import torch
import cv2
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageFont
import math
import os
import glob

def cm_to_pixels(cm, dpi=350):
    return int(cm * dpi / 2.54)

def create_rounded_rectangle_mask(width, height, radius):
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (width, height)], radius, fill=255)
    return mask

def create_rounded_rectangle_shadow(width, height, radius, shadow_offset=5, shadow_blur=5, shadow_opacity=128):
    shadow = Image.new('RGBA', (width + shadow_offset*2, height + shadow_offset*2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    
    draw.rounded_rectangle(
        [(shadow_offset, shadow_offset), (shadow_offset + width, shadow_offset + height)],
        radius, fill=(0, 0, 0, shadow_opacity)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
    return shadow

def adjust_orientation(image_tensor, mask_tensor):
    _, height, width, _ = image_tensor.shape
    _, h_mask, w_mask = mask_tensor.shape
    
    assert height == h_mask and width == w_mask
    
    if height > width:
        rotated_image = torch.rot90(image_tensor.squeeze(0), k=1, dims=[0, 1]).unsqueeze(0)
        rotated_mask = torch.rot90(mask_tensor.squeeze(0), k=1, dims=[0, 1]).unsqueeze(0)
        return rotated_image, rotated_mask
    else:
        return image_tensor, mask_tensor

def perspective_transform(image, mask, target_width, target_height):
    img_np = image.numpy().squeeze(0) * 255.0
    img_np = img_np.astype(np.uint8)
    
    mask_np = mask.numpy().squeeze(0) * 255.0
    mask_np = mask_np.astype(np.uint8)
    
    contours, _ = cv2.findContours(mask_np, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    
    max_contour = max(contours, key=cv2.contourArea)
    
    epsilon = 0.02 * cv2.arcLength(max_contour, True)
    approx = cv2.approxPolyDP(max_contour, epsilon, True)
    
    if len(approx) < 4:
        rect = cv2.minAreaRect(max_contour)
        box = cv2.boxPoints(rect)
        approx = np.array(box, dtype=np.float32)
    else:
        approx = approx.reshape(-1, 2)[:4]
    
    center = np.mean(approx, axis=0)
    angles = np.arctan2(approx[:,1] - center[1], approx[:,0] - center[0])
    sorted_indices = np.argsort(angles)
    src_points = approx[sorted_indices]
    
    dst_points = np.array([
        [0, 0],
        [target_width-1, 0],
        [target_width-1, target_height-1],
        [0, target_height-1]
    ], dtype=np.float32)
    
    M = cv2.getPerspectiveTransform(src_points.astype(np.float32), dst_points)
    warped = cv2.warpPerspective(img_np, M, (target_width, target_height))
    
    warped_rgba = cv2.cvtColor(warped, cv2.COLOR_RGB2RGBA)
    radius = int(min(target_width, target_height) * 0.07)
    mask_pil = create_rounded_rectangle_mask(target_width, target_height, radius)
    mask_np = np.array(mask_pil)
    warped_rgba[:, :, 3] = mask_np
    
    return warped_rgba

def apply_auto_contrast(image_pil, intensity):
    """应用自动对比度调整"""
    if intensity == 0:
        return image_pil
    
    # 计算调整因子 (0-1)
    factor = intensity / 100.0
    
    # 自动对比度
    auto_img = ImageOps.autocontrast(image_pil)
    
    # 根据强度混合原图和调整后的图像
    return Image.blend(image_pil, auto_img, factor)

def apply_auto_tone(image_pil, intensity):
    """应用自动色调调整（白平衡）"""
    if intensity == 0:
        return image_pil
    
    # 计算调整因子 (0-1)
    factor = intensity / 100.0
    
    # 转换为RGB数组
    img_arr = np.array(image_pil).astype(np.float32)
    
    # 灰度世界算法白平衡
    avg_b = np.mean(img_arr[:, :, 0])
    avg_g = np.mean(img_arr[:, :, 1])
    avg_r = np.mean(img_arr[:, :, 2])
    avg_gray = (avg_b + avg_g + avg_r) / 3.0
    
    # 计算增益并限制范围 (0.7-1.3)
    gain_b = np.clip(avg_gray / (avg_b + 1e-6), 0.7, 1.3)
    gain_g = np.clip(avg_gray / (avg_g + 1e-6), 0.7, 1.3)
    gain_r = np.clip(avg_gray / (avg_r + 1e-6), 0.7, 1.3)
    
    # 应用白平衡
    img_arr[:, :, 0] = np.clip(img_arr[:, :, 0] * gain_b, 0, 255)
    img_arr[:, :, 1] = np.clip(img_arr[:, :, 1] * gain_g, 0, 255)
    img_arr[:, :, 2] = np.clip(img_arr[:, :, 2] * gain_r, 0, 255)
    
    # 创建调整后的图像
    adjusted_img = Image.fromarray(img_arr.astype(np.uint8))
    
    # 根据强度混合原图和调整后的图像
    return Image.blend(image_pil, adjusted_img, factor)

def preprocess_image(image_tensor, contrast_intensity, tone_intensity):
    """预处理图像：应用自动对比度和色调调整"""
    # 将Tensor转换为PIL图像
    img_np = (image_tensor.squeeze(0).numpy() * 255).astype(np.uint8)
    image_pil = Image.fromarray(img_np)
    
    # 应用自动对比度调整
    if contrast_intensity > 0:
        image_pil = apply_auto_contrast(image_pil, contrast_intensity)
    
    # 应用自动色调调整
    if tone_intensity > 0:
        image_pil = apply_auto_tone(image_pil, tone_intensity)
    
    # 转换回Tensor
    img_np = np.array(image_pil).astype(np.float32) / 255.0
    return torch.from_numpy(img_np).unsqueeze(0)

def apply_watermark(canvas, text, font_path, font_size, color, opacity, spacing, angle):
    """在整个画布上添加水印"""
    if not text or font_size <= 0 or opacity <= 0:
        return canvas
    
    # 尝试加载字体
    try:
        if font_path == "默认字体":
            font = ImageFont.load_default()
        else:
            # 获取当前脚本所在目录的上级目录
            script_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(script_dir)
            font_path = os.path.join(parent_dir, "fonts", font_path)

            font = ImageFont.truetype(font_path, font_size)
    except Exception as e:
        print(f"加载字体失败: {e}, 使用默认字体")
        font = ImageFont.load_default()
    
    # 创建水印层
    watermark = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(watermark)
    
    # 使用textbbox替代弃用的textsize方法
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # 计算水印单元尺寸（包括间距）
    unit_width = text_width + spacing
    unit_height = text_height + spacing
    
    # 创建水印单元
    unit = Image.new('RGBA', (unit_width, unit_height), (0, 0, 0, 0))
    unit_draw = ImageDraw.Draw(unit)
    
    # 绘制水印文本
    unit_draw.text((0, 0), text, font=font, fill=color + (int(opacity * 2.55),))
    
    # 旋转水印单元
    unit = unit.rotate(angle, expand=True, resample=Image.BICUBIC)
    
    # 获取旋转后的单元尺寸
    unit_width, unit_height = unit.size
    
    # 计算需要的水印单元数量
    cols = int(canvas.width / unit_width) + 2
    rows = int(canvas.height / unit_height) + 2
    
    # 创建平铺水印
    tile_width = cols * unit_width
    tile_height = rows * unit_height
    tile = Image.new('RGBA', (tile_width, tile_height), (0, 0, 0, 0))
    
    # 平铺水印单元
    for y in range(rows):
        for x in range(cols):
            tile.paste(unit, (x * unit_width, y * unit_height), unit)
    
    # 裁剪到画布大小
    tile = tile.crop((0, 0, canvas.width, canvas.height))
    
    # 合并水印和原图
    canvas_rgba = canvas.convert('RGBA')
    result = Image.alpha_composite(canvas_rgba, tile)
    return result.convert('RGB')

def get_font_list():
    """获取fonts目录下的字体文件列表"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(script_dir)
    fonts_dir = os.path.join(parent_dir, "fonts")
    
    if not os.path.exists(fonts_dir):
        return ["默认字体"]
    
    font_files = []
    for ext in ["*.ttf", "*.otf", "*.ttc", "*.TTF", "*.OTF", "*.TTC"]:
        font_files.extend(glob.glob(os.path.join(fonts_dir, ext)))
    
    # 只获取文件名
    font_names = [os.path.basename(f) for f in font_files]
    font_names.insert(0, "默认字体")
    return font_names

class IDCardCorrectionAndComposition:
    @classmethod
    def INPUT_TYPES(cls):
        # 获取可用字体列表
        font_list = get_font_list()
        
        return {
            "required": {
                "front_image": ("IMAGE",),
                "front_mask": ("MASK",),
                "画布宽_cm": ("FLOAT", {"default": 21.0, "min": 1.0, "max": 100.0, "step": 0.1}),
                "画布高_cm": ("FLOAT", {"default": 29.7, "min": 1.0, "max": 100.0, "step": 0.1}),
                "图像间距_cm": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 50.0, "step": 0.1}),
                "阴影大小": ("INT", {"default": 5, "min": 0, "max": 20, "step": 1}),
                "阴影模糊": ("INT", {"default": 5, "min": 0, "max": 20, "step": 1}),
                "阴影不透明度": ("INT", {"default": 128, "min": 0, "max": 255, "step": 10}),
                "自动对比度强度": ("INT", {"default": 0, "min": 0, "max": 200, "step": 1}),
                "自动色调强度": ("INT", {"default": 0, "min": 0, "max": 200, "step": 1}),
                "黑白": ("BOOLEAN", {"default": False}),
                "水印开关": ("BOOLEAN", {"default": False}),
                "水印文字": ("STRING", {"default": "机密文件", "multiline": True}),
                "水印字体": (font_list, {"default": font_list[0]}),
                "水印大小": ("INT", {"default": 48, "min": 0, "max": 1000, "step": 1}),
                "水印颜色": ("COLOR", {"default": "#808080"}),
                "水印不透明度": ("INT", {"default": 50, "min": 0, "max": 100, "step": 1}),
                "水印间距": ("INT", {"default": 150, "min": 10, "max": 1000, "step": 10}),
                "水印角度": ("INT", {"default": 45, "min": -90, "max": 90, "step": 1}),
            },
            "optional": {
                "back_image": ("IMAGE",),
                "back_mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "孤海工具箱"

    def process(self, front_image, front_mask, 
                back_image=None, back_mask=None,
                自动对比度强度=0, 自动色调强度=0,
                画布宽_cm=21.0, 画布高_cm=29.7, 图像间距_cm=1.0,
                阴影大小=5, 阴影模糊=5, 阴影不透明度=128, 黑白=False,
                水印开关=False, 水印文字="机密文件", 水印字体="默认字体", 水印大小=48, 
                水印颜色="#808080", 水印不透明度=50, 水印间距=150, 水印角度=45):
        
        dpi = 450
        id_width_cm = 8.56
        id_height_cm = 5.4
        
        # 计算像素尺寸
        id_width_px = cm_to_pixels(id_width_cm, dpi)
        id_height_px = cm_to_pixels(id_height_cm, dpi)
        canvas_width_px = cm_to_pixels(画布宽_cm, dpi)
        canvas_height_px = cm_to_pixels(画布高_cm, dpi)
        spacing_px = cm_to_pixels(图像间距_cm, dpi)
        
        # 应用自动对比度和色调调整
        if 自动对比度强度 > 0 or 自动色调强度 > 0:
            front_image = preprocess_image(front_image, 自动对比度强度, 自动色调强度)
            if back_image is not None:
                back_image = preprocess_image(back_image, 自动对比度强度, 自动色调强度)
        
        # 横竖版检测与旋转
        front_image, front_mask = adjust_orientation(front_image, front_mask)
        if back_image is not None and back_mask is not None:
            back_image, back_mask = adjust_orientation(back_image, back_mask)
        
        # 处理正面身份证
        front_corrected = perspective_transform(front_image, front_mask, id_width_px, id_height_px)
        if front_corrected is None:
            raise ValueError("无法处理正面身份证图像")
        
        # 处理背面身份证（如果存在）
        if back_image is not None and back_mask is not None:
            back_corrected = perspective_transform(back_image, back_mask, id_width_px, id_height_px)
            if back_corrected is None:
                raise ValueError("无法处理背面身份证图像")
        
        # 创建白色画布
        canvas = Image.new('RGBA', (canvas_width_px, canvas_height_px), (255, 255, 255, 255))
        
        # 计算圆角半径（用于阴影）
        radius = int(min(id_width_px, id_height_px) * 0.07)
        
        # 计算水平和垂直居中位置
        x_center = (canvas_width_px - id_width_px) // 2
        
        # 计算总高度和起始位置
        if back_image is not None and back_mask is not None:
            # 双面模式：计算两张图片的总高度（包括间距）
            total_height = 2 * id_height_px + spacing_px
            start_y = (canvas_height_px - total_height) // 2
            
            # 正面位置
            front_y = start_y
            # 背面位置
            back_y = start_y + id_height_px + spacing_px
        else:
            # 单面模式：居中放置
            start_y = (canvas_height_px - id_height_px) // 2
            front_y = start_y
            back_y = None
        
        # 创建阴影
        front_shadow = create_rounded_rectangle_shadow(
            id_width_px, id_height_px, radius, 
            shadow_offset=阴影大小, 
            shadow_blur=阴影模糊, 
            shadow_opacity=阴影不透明度)
        
        # 粘贴正面
        canvas.paste(front_shadow, (x_center + 阴影大小, front_y + 阴影大小), front_shadow)
        front_img = Image.fromarray(front_corrected)
        canvas.paste(front_img, (x_center, front_y), front_img)
        
        # 粘贴背面（如果存在）
        if back_image is not None and back_mask is not None:
            back_shadow = create_rounded_rectangle_shadow(
                id_width_px, id_height_px, radius, 
                shadow_offset=阴影大小, 
                shadow_blur=阴影模糊, 
                shadow_opacity=阴影不透明度)
            
            canvas.paste(back_shadow, (x_center + 阴影大小, back_y + 阴影大小), back_shadow)
            back_img = Image.fromarray(back_corrected)
            canvas.paste(back_img, (x_center, back_y), back_img)
        
        # 转换为RGB（移除alpha通道）
        canvas = canvas.convert('RGB')
        
        # 如果黑白开关打开，转换为灰度图
        if 黑白:
            canvas = canvas.convert('L').convert('RGB')
        
        # 新增水印功能
        if 水印开关 and 水印文字 and 水印大小 > 0 and 水印不透明度 > 0:
            # 将颜色从十六进制转换为RGB元组
            color_hex = 水印颜色.lstrip('#')
            if len(color_hex) == 6:
                color_rgb = tuple(int(color_hex[i:i+2], 16) for i in (0, 2, 4))
            else:
                # 默认中性灰
                color_rgb = (128, 128, 128)
            
            # 应用水印
            canvas = apply_watermark(
                canvas, 
                text=水印文字,
                font_path=水印字体,
                font_size=水印大小,
                color=color_rgb,
                opacity=水印不透明度,
                spacing=水印间距,
                angle=水印角度
            )
        
        # 转换为Tensor
        result = torch.from_numpy(np.array(canvas).astype(np.float32) / 255.0).unsqueeze(0)
        return (result,)

# 节点名称映射
NODE_CLASS_MAPPINGS = {
    "IDCardCorrectionAndComposition": IDCardCorrectionAndComposition
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "IDCardCorrectionAndComposition": "孤海-身份证自动扶正拼版"
}