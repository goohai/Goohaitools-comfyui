import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import cv2

class 孤海图像与遮罩描边:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "单位": (["像素", "百分比"],),
                "模式": (["外部", "居中", "内部"],),
                "描边宽度": ("INT", {"default": 20, "min": 0, "max": 500, "step": 1}),
                "描边颜色": ("COLOR", {"default": "#FFFFFF"}),
                "模糊": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
                "平滑": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
                "输出通道": (["跟随输入", "RGB", "RGBA"],),
            },
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("图像", "遮罩")
    FUNCTION = "apply_stroke"
    CATEGORY = "孤海工具箱"

    def apply_stroke(self, 单位, 模式, 描边宽度, 描边颜色, 模糊, 平滑, 输出通道, image=None, mask=None):
        # 处理图像批次
        result_images = []
        result_masks = []
        
        # 如果没有图像但有遮罩，创建空白图像
        if image is None and mask is not None:
            # 使用遮罩创建灰度图像
            mask_np = mask.cpu().numpy().squeeze()
            if mask_np.ndim == 3:
                mask_np = mask_np[0]  # 取第一个通道
            # 创建RGB图像，三个通道都使用遮罩值
            image = torch.stack([
                torch.tensor(mask_np),
                torch.tensor(mask_np),
                torch.tensor(mask_np)
            ], dim=-1).unsqueeze(0)  # 添加批次维度
        
        # 如果没有图像也没有遮罩，返回空
        if image is None and mask is None:
            return (torch.zeros((1, 64, 64, 3)), torch.zeros((1, 64, 64)))
        
        # 确定批次大小
        batch_size = image.shape[0] if image is not None else mask.shape[0]
        
        for i in range(batch_size):
            # 处理单张图像
            img_tensor = image[i] if image is not None else None
            mask_tensor = mask[i] if mask is not None and i < mask.shape[0] else None
            
            # 转换输入图像为PIL格式
            image_pil = self.tensor_to_pil(img_tensor) if img_tensor is not None else None
            orig_size = image_pil.size if image_pil is not None else None
            
            # 处理描边颜色
            stroke_color = self.hex_to_rgb(描边颜色)
            
            # 检查遮罩
            if mask_tensor is not None:
                mask_np = mask_tensor.cpu().numpy().squeeze()
                if image_pil is not None and mask_np.shape[:2] != (img_tensor.shape[0], img_tensor.shape[1]):
                    raise ValueError(f"图像和遮罩尺寸不一致: 图像 {img_tensor.shape[:2]}, 遮罩 {mask_np.shape[:2]}")
                mask_pil = Image.fromarray((mask_np * 255).astype(np.uint8))
            else:
                mask_pil = None
            
            # 如果没有图像但有遮罩，创建空白图像
            if image_pil is None and mask_pil is not None:
                # 将遮罩转换为RGB图像
                mask_array = np.array(mask_pil)
                if len(mask_array.shape) == 2:
                    mask_array = np.stack([mask_array] * 3, axis=-1)
                image_pil = Image.fromarray(mask_array.astype(np.uint8))
                orig_size = image_pil.size
            
            # 计算实际描边宽度和模糊值
            stroke_width = self.calculate_stroke_width(image_pil, 单位, 描边宽度)
            blur_radius = self.calculate_blur_radius(image_pil, 单位, 模糊)
            smooth_radius = self.calculate_smooth_radius(平滑)
            
            # 处理图像描边 - 如果是RGB模式，使用简单粗暴的方式
            if image_pil.mode == 'RGB':
                result_image = self.apply_simple_rgb_stroke(image_pil, stroke_width, stroke_color)
            else:
                result_image = self.process_image(image_pil, 模式, stroke_width, stroke_color, blur_radius, smooth_radius, 输出通道)
            
            # 处理遮罩描边
            result_mask = self.process_mask(mask_pil, orig_size, 模式, stroke_width, blur_radius, smooth_radius)
            
            # 如果没有图像输入，只有遮罩输入，则将处理后的遮罩转换为RGB图像
            if img_tensor is None and mask_tensor is not None:
                # 将遮罩转换为RGB图像
                mask_array = np.array(result_mask)
                if len(mask_array.shape) == 2:
                    mask_array = np.stack([mask_array] * 3, axis=-1)
                result_image = Image.fromarray(mask_array.astype(np.uint8))
            
            # 转换回tensor格式
            result_image_tensor = self.pil_to_tensor(result_image)
            result_images.append(result_image_tensor)
            
            if result_mask is not None:
                result_mask_np = np.array(result_mask).astype(np.float32) / 255.0
                result_masks.append(torch.tensor(result_mask_np))
            else:
                # 如果没有遮罩，创建全黑遮罩
                result_masks.append(torch.zeros((orig_size[1], orig_size[0]), dtype=torch.float32))
        
        # 合并批次结果
        result_image_batch = torch.cat(result_images, dim=0)
        result_mask_batch = torch.stack(result_masks, dim=0).unsqueeze(1)  # 添加通道维度
        
        return (result_image_batch, result_mask_batch)

    def apply_simple_rgb_stroke(self, image, stroke_width, stroke_color):
        """简单粗暴的RGB图像描边方式"""
        if stroke_width <= 0:
            return image.copy()
        
        # 创建描边图层
        stroke_layer = Image.new('RGB', image.size, stroke_color[:3])
        
        # 计算挖空区域
        left = stroke_width
        top = stroke_width
        right = image.width - stroke_width
        bottom = image.height - stroke_width
        
        # 确保挖空区域有效
        if left < right and top < bottom:
            # 挖空中间区域
            cropped_image = image.crop((left, top, right, bottom))
            stroke_layer.paste(cropped_image, (left, top))
        
        return stroke_layer

    def tensor_to_pil(self, tensor):
        # 将ComfyUI的tensor转换为PIL图像
        # tensor形状: (H, W, C)
        if tensor is None:
            return None
            
        tensor = tensor.clone().detach().cpu()
        tensor = tensor * 255
        tensor = tensor.numpy().astype(np.uint8)
        return Image.fromarray(tensor)

    def pil_to_tensor(self, pil_image):
        # 将PIL图像转换为ComfyUI的tensor
        # 返回形状: (1, H, W, C)
        img = np.array(pil_image).astype(np.float32) / 255.0
        return torch.from_numpy(img)[None,]

    def hex_to_rgb(self, hex_color):
        # 将十六进制颜色转换为RGB元组
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 6:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return (r, g, b)
        elif len(hex_color) == 8:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            a = int(hex_color[6:8], 16)
            return (r, g, b, a)
        else:
            return (255, 255, 255)  # 默认白色

    def calculate_stroke_width(self, image, unit, width):
        # 计算实际描边宽度
        if unit == "像素":
            return width
        
        # 百分比计算
        if image is None:
            return width
            
        if image.mode == 'RGBA':
            # 计算非透明区域的最小边
            alpha = np.array(image.split()[-1])
            non_transparent = np.where(alpha > 0)
            if non_transparent[0].size == 0:
                return 0
            min_x, max_x = np.min(non_transparent[1]), np.max(non_transparent[1])
            min_y, max_y = np.min(non_transparent[0]), np.max(non_transparent[0])
            width_px = max_x - min_x
            height_px = max_y - min_y
            min_side = min(width_px, height_px)
        else:
            # RGB图像使用整个图像尺寸
            min_side = min(image.width, image.height)
        
        return int(min_side * width / 100)

    def calculate_blur_radius(self, image, unit, blur):
        # 计算实际模糊半径
        if unit == "像素":
            return blur
        
        # 百分比计算
        if image is None:
            return blur
            
        min_side = min(image.width, image.height)
        return int(min_side * blur / 100)
    
    def calculate_smooth_radius(self, smooth):
        # 平滑半径（固定像素）
        return smooth

    def process_image(self, image, mode, stroke_width, stroke_color, blur_radius, smooth_radius, output_channel):
        # 处理图像描边
        if image.mode == 'RGB':
            # RGB图像使用简单粗暴的方式
            result = self.apply_simple_rgb_stroke(image, stroke_width, stroke_color)
        else:
            # RGBA图像根据模式处理
            if mode == "外部":
                result = self.apply_external_stroke(image, stroke_width, stroke_color, blur_radius, smooth_radius)
            elif mode == "居中":
                result = self.apply_center_stroke(image, stroke_width, stroke_color, blur_radius, smooth_radius)
            else:  # 内部
                result = self.apply_internal_stroke(image, stroke_width, stroke_color, blur_radius, smooth_radius)
        
        # 处理输出通道
        if output_channel == "RGB":
            if result.mode == 'RGBA':
                # 使用白色背景合成
                background = Image.new('RGB', result.size, (255, 255, 255))
                background.paste(result, mask=result.split()[3])
                result = background
            else:
                result = result.convert("RGB")
        elif output_channel == "RGBA":
            if result.mode != "RGBA":
                result = result.convert("RGBA")
        # "跟随输入" - 保持原样
        
        return result
    
    def apply_stroke_to_rgb(self, image, stroke_width, stroke_color, blur_radius, smooth_radius):
        """处理RGB图像的描边（所有模式都在内部描边）"""
        if stroke_width <= 0 and blur_radius <= 0 and smooth_radius <= 0:
            return image.copy()
        
        # 创建一个临时RGBA图像
        rgba_image = image.convert('RGBA')
        alpha = Image.new('L', image.size, 255)
        rgba_image.putalpha(alpha)
        
        # 创建一个全不透明的alpha通道
        alpha_np = np.full((image.height, image.width), 255, dtype=np.uint8)
        
        # 创建描边遮罩（内部描边）
        stroke_mask = self.create_stroke_mask(alpha_np, stroke_width, "internal", smooth_radius)
        
        # 创建描边图像
        stroke_image = Image.new('RGBA', image.size, (0, 0, 0, 0))
        stroke_draw = ImageDraw.Draw(stroke_image)
        stroke_draw.bitmap((0, 0), Image.fromarray(stroke_mask), fill=stroke_color + (255,))
        
        # 应用模糊
        if blur_radius > 0:
            stroke_image = stroke_image.filter(ImageFilter.GaussianBlur(blur_radius))
        
        # 合成图像（描边在上面）
        result = Image.alpha_composite(rgba_image, stroke_image)
        
        return result.convert('RGB')

    def apply_external_stroke(self, image, stroke_width, stroke_color, blur_radius, smooth_radius):
        # 外部描边处理
        if stroke_width <= 0 and blur_radius <= 0 and smooth_radius <= 0:
            return image.copy()
        
        # 提取alpha通道
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        alpha = image.split()[-1]
        alpha_np = np.array(alpha)
        
        # 创建描边遮罩
        stroke_mask = self.create_stroke_mask(alpha_np, stroke_width, "external", smooth_radius)
        
        # 创建描边图像
        stroke_image = Image.new('RGBA', image.size, (0, 0, 0, 0))
        stroke_draw = ImageDraw.Draw(stroke_image)
        stroke_draw.bitmap((0, 0), Image.fromarray(stroke_mask), fill=stroke_color + (255,))
        
        # 应用模糊
        if blur_radius > 0:
            stroke_image = stroke_image.filter(ImageFilter.GaussianBlur(blur_radius))
        
        # 合成图像（描边在下面）
        result = Image.alpha_composite(stroke_image, image)
        return result

    def apply_center_stroke(self, image, stroke_width, stroke_color, blur_radius, smooth_radius):
        # 居中描边处理
        if stroke_width <= 0 and blur_radius <= 0 and smooth_radius <= 0:
            return image.copy()
        
        # 提取alpha通道
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        alpha = image.split()[-1]
        alpha_np = np.array(alpha)
        
        # 创建描边遮罩
        stroke_mask = self.create_stroke_mask(alpha_np, stroke_width, "center", smooth_radius)
        
        # 创建描边图像
        stroke_image = Image.new('RGBA', image.size, (0, 0, 0, 0))
        stroke_draw = ImageDraw.Draw(stroke_image)
        stroke_draw.bitmap((0, 0), Image.fromarray(stroke_mask), fill=stroke_color + (255,))
        
        # 应用模糊
        if blur_radius > 0:
            stroke_image = stroke_image.filter(ImageFilter.GaussianBlur(blur_radius))
        
        # 合成图像（描边在上面）
        result = Image.alpha_composite(image, stroke_image)
        return result

    def apply_internal_stroke(self, image, stroke_width, stroke_color, blur_radius, smooth_radius):
        # 内部描边处理
        if stroke_width <= 0 and blur_radius <= 0 and smooth_radius <= 0:
            return image.copy()
        
        # 提取alpha通道
        if image.mode == 'RGB':
            # 对于RGB图像，使用简单粗暴的方式
            return self.apply_simple_rgb_stroke(image, stroke_width, stroke_color)
        else:
            rgba_image = image.copy()
            alpha = rgba_image.split()[-1]
        
        alpha_np = np.array(alpha)
        
        # 创建描边遮罩
        stroke_mask = self.create_stroke_mask(alpha_np, stroke_width, "internal", smooth_radius)
        
        # 创建描边图像
        stroke_image = Image.new('RGBA', image.size, (0, 0, 0, 0))
        stroke_draw = ImageDraw.Draw(stroke_image)
        stroke_draw.bitmap((0, 0), Image.fromarray(stroke_mask), fill=stroke_color + (255,))
        
        # 应用模糊
        if blur_radius > 0:
            stroke_image = stroke_image.filter(ImageFilter.GaussianBlur(blur_radius))
        
        # 合成图像（描边在上面）
        result = Image.alpha_composite(rgba_image, stroke_image)
        
        # 如果是RGB输入，转换回RGB
        if image.mode == 'RGB':
            result = result.convert('RGB')
        
        return result

    def create_stroke_mask(self, alpha_np, stroke_width, stroke_type, smooth_radius=0):
        """创建描边遮罩，并在最后应用平滑处理"""
        if stroke_width <= 0:
            return np.zeros_like(alpha_np)
        
        # 二值化alpha
        binary_mask = (alpha_np > 0).astype(np.uint8) * 255
        
        # 根据描边类型处理
        if stroke_type == "external":
            # 外部描边：膨胀后减去原遮罩
            dilated = self.dilate_mask(binary_mask, stroke_width)
            stroke_mask = dilated - binary_mask
        elif stroke_type == "internal":
            # 内部描边：原遮罩减去腐蚀后
            eroded = self.erode_mask(binary_mask, stroke_width)
            stroke_mask = binary_mask - eroded
        else:  # center
            # 居中描边：膨胀一半减去腐蚀一半
            half_width = max(1, stroke_width // 2)
            dilated = self.dilate_mask(binary_mask, half_width)
            eroded = self.erode_mask(binary_mask, half_width)
            stroke_mask = dilated - eroded
        
        # 应用平滑（在描边遮罩生成后）
        if smooth_radius > 0:
            # 只对描边区域进行平滑处理
            stroke_mask = cv2.GaussianBlur(stroke_mask, (0, 0), smooth_radius)
            # 重新二值化，保留描边效果
            _, stroke_mask = cv2.threshold(stroke_mask, 10, 255, cv2.THRESH_BINARY)
        
        return np.clip(stroke_mask, 0, 255).astype(np.uint8)

    def dilate_mask(self, mask, iterations):
        # 膨胀操作
        if iterations <= 0:
            return mask.copy()
        
        kernel = np.ones((3, 3), np.uint8)
        return cv2.dilate(mask, kernel, iterations=iterations)

    def erode_mask(self, mask, iterations):
        # 腐蚀操作
        if iterations <= 0:
            return mask.copy()
        
        kernel = np.ones((3, 3), np.uint8)
        return cv2.erode(mask, kernel, iterations=iterations)

    def process_mask(self, mask_pil, orig_size, mode, stroke_width, blur_radius, smooth_radius):
        # 处理遮罩描边
        if mask_pil is None:
            return None
        
        # 确保遮罩是二值图像
        mask_np = np.array(mask_pil)
        if mask_np.ndim == 3:
            mask_np = mask_np[:, :, 0]
        
        # 创建描边遮罩
        if stroke_width <= 0:
            stroke_mask = np.zeros_like(mask_np)
        else:
            binary_mask = (mask_np > 127).astype(np.uint8) * 255
            
            if mode == "外部":
                dilated = self.dilate_mask(binary_mask, stroke_width)
                stroke_mask = dilated - binary_mask
            elif mode == "内部":
                eroded = self.erode_mask(binary_mask, stroke_width)
                stroke_mask = binary_mask - eroded
            else:  # 居中
                half_width = max(1, stroke_width // 2)
                dilated = self.dilate_mask(binary_mask, half_width)
                eroded = self.erode_mask(binary_mask, half_width)
                stroke_mask = dilated - eroded
        
        # 应用平滑（在描边遮罩生成后）
        if smooth_radius > 0:
            stroke_mask = cv2.GaussianBlur(stroke_mask, (0, 0), smooth_radius)
            # 重新二值化，保留描边效果
            _, stroke_mask = cv2.threshold(stroke_mask, 10, 255, cv2.THRESH_BINARY)
        
        # 应用模糊
        if blur_radius > 0:
            stroke_mask = cv2.GaussianBlur(stroke_mask, (0, 0), blur_radius)
        
        return Image.fromarray(stroke_mask.astype(np.uint8))

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海-图像与遮罩描边": 孤海图像与遮罩描边
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-图像与遮罩描边": "孤海-图像与遮罩描边"
}