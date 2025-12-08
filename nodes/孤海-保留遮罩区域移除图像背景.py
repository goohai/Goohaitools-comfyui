import torch
import numpy as np
from PIL import Image, ImageDraw, ImageOps, ImageFilter
import nodes
import folder_paths

class RemoveBackgroundWithMask:
    """
    孤海-保留遮罩区域移除图像背景
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "遮罩": ("MASK",),
                "遮罩填充漏洞": ("BOOLEAN", {"default": True}),
                "遮罩裁剪": ("BOOLEAN", {"default": True}),
                "裁剪系数": ("FLOAT", {"default": 1.2, "min": 1.0, "max": 2.0, "step": 0.1}),
                "图像描边": ("INT", {"default": 0, "min": 0, "max": 512}),
                "描边颜色": ("COLORCODE", {"default": "#364254"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("RGBA图像", "RGB图像", "遮罩")
    FUNCTION = "remove_background"
    CATEGORY = "孤海工具箱"
    
    def remove_background(self, 图像, 遮罩, 遮罩填充漏洞, 遮罩裁剪, 裁剪系数, 图像描边, 描边颜色):
        # 获取批次大小
        batch_size = 图像.shape[0]
        
        # 处理每个图像
        rgba_results = []
        rgb_results = []
        mask_results = []
        
        for i in range(batch_size):
            # 获取当前图像和遮罩
            image_tensor = 图像[i]  # [H, W, 3]
            mask_tensor = 遮罩[0] if i >= 遮罩.shape[0] else 遮罩[i]  # [H, W]
            
            # 处理单个图像
            rgba_tensor, rgb_tensor, mask_tensor = self.process_single_image(
                image_tensor, mask_tensor, 遮罩填充漏洞, 遮罩裁剪, 裁剪系数, 图像描边, 描边颜色
            )
            
            rgba_results.append(rgba_tensor)
            rgb_results.append(rgb_tensor)
            mask_results.append(mask_tensor)
        
        # 合并批次结果
        rgba_batch = torch.cat(rgba_results, dim=0)
        rgb_batch = torch.cat(rgb_results, dim=0)
        mask_batch = torch.cat(mask_results, dim=0)
        
        return (rgba_batch, rgb_batch, mask_batch)
    
    def process_single_image(self, image_tensor, mask_tensor, fill_holes, crop_mask, crop_factor, stroke_width, stroke_color):
        # 将tensor转换为PIL图像
        image_pil = self.tensor2pil(image_tensor)
        
        # 处理遮罩tensor
        if len(mask_tensor.shape) == 3:
            mask_tensor = mask_tensor.squeeze(0)
        
        # 将遮罩tensor转换为PIL图像
        mask_array = (mask_tensor.cpu().numpy() * 255).astype(np.uint8)
        mask_pil = Image.fromarray(mask_array, mode="L")
        
        # 转换为RGBA模式
        image_rgba = image_pil.convert("RGBA")
        
        # 1. 遮罩填充漏洞处理
        if fill_holes:
            mask_array = np.array(mask_pil)
            mask_array = self.fill_mask_holes(mask_array)
            mask_pil = Image.fromarray(mask_array, mode="L")
        
        # 2. 遮罩裁剪处理（考虑描边宽度）
        if crop_mask:
            # 计算描边需要的额外扩展（确保描边完全可见）
            stroke_expansion = max(0, stroke_width) if stroke_width > 0 else 0
            image_rgba, mask_pil = self.crop_with_expansion(
                image_rgba, mask_pil, crop_factor, stroke_expansion
            )
        else:
            # 如果不裁剪，确保遮罩与图像尺寸一致
            if mask_pil.size != image_rgba.size:
                mask_pil = mask_pil.resize(image_rgba.size, Image.NEAREST)
        
        # 3. 应用遮罩到图像
        result_rgba = self.apply_mask_to_image(image_rgba, mask_pil)
        
        # 4. 图像描边处理
        if stroke_width > 0:
            result_rgba = self.add_image_stroke(result_rgba, mask_pil, stroke_width, stroke_color)
        
        # 5. 生成RGB图像（透明背景填充为描边颜色）
        rgb_image = self.rgba_to_rgb(result_rgba, stroke_color)
        
        # 6. 处理输出遮罩
        output_mask = self.pil_to_mask(mask_pil)
        
        # 转换回tensor格式（符合ComfyUI标准格式）
        rgba_tensor = self.pil2tensor(result_rgba)
        rgb_tensor = self.pil2tensor(rgb_image)
        mask_tensor = output_mask.unsqueeze(0)  # [1, H, W]
        
        return rgba_tensor, rgb_tensor, mask_tensor
    
    def fill_mask_holes(self, mask_array):
        """填充遮罩内部的孔洞"""
        try:
            from scipy import ndimage
            # 使用形态学操作填充孔洞
            filled_mask = ndimage.binary_fill_holes(mask_array > 128)
            return (filled_mask * 255).astype(np.uint8)
        except ImportError:
            # 如果scipy不可用，使用简单的填充方法
            print("警告: scipy不可用，使用简单孔洞填充方法")
            return self.simple_fill_holes(mask_array)
    
    def simple_fill_holes(self, mask_array):
        """简单的孔洞填充方法（不使用scipy）"""
        # 创建一个副本
        filled = mask_array.copy()
        h, w = filled.shape
        
        # 简单的洪水填充方法
        def flood_fill(x, y, target, replacement):
            stack = [(x, y)]
            while stack:
                x, y = stack.pop()
                if x < 0 or x >= w or y < 0 or y >= h:
                    continue
                if filled[y, x] != target:
                    continue
                filled[y, x] = replacement
                stack.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1)])
        
        # 从边缘开始填充背景
        for x in range(w):
            if filled[0, x] < 128:
                flood_fill(x, 0, filled[0, x], 255)
            if filled[h-1, x] < 128:
                flood_fill(x, h-1, filled[h-1, x], 255)
        
        for y in range(h):
            if filled[y, 0] < 128:
                flood_fill(0, y, filled[y, 0], 255)
            if filled[y, w-1] < 128:
                flood_fill(w-1, y, filled[y, w-1], 255)
        
        # 反转填充结果
        filled = 255 - filled
        return filled
    
    def crop_with_expansion(self, image, mask, expansion_factor, stroke_expansion=0):
        """根据遮罩区域裁剪图像并进行扩展，确保描边可见"""
        mask_array = np.array(mask)
        
        # 找到遮罩的非零区域
        coords = np.column_stack(np.where(mask_array > 128))
        if len(coords) == 0:
            return image, mask
        
        y_min, x_min = coords.min(axis=0)
        y_max, x_max = coords.max(axis=0)
        
        # 计算原始区域尺寸
        width = x_max - x_min
        height = y_max - y_min
        
        # 计算扩展后的区域（考虑裁剪系数和描边扩展）
        expand_w = int(width * (expansion_factor - 1.0) / 2) + stroke_expansion
        expand_h = int(height * (expansion_factor - 1.0) / 2) + stroke_expansion
        
        new_x_min = max(0, x_min - expand_w)
        new_y_min = max(0, y_min - expand_h)
        new_x_max = min(image.width, x_max + expand_w)
        new_y_max = min(image.height, y_max + expand_h)
        
        # 计算需要的画布扩展（当裁剪区域超出原图边界时）
        left_expand = max(0, expand_w - x_min)  # 左边需要扩展的像素
        top_expand = max(0, expand_h - y_min)   # 上边需要扩展的像素
        right_expand = max(0, (x_max + expand_w) - image.width)   # 右边需要扩展的像素
        bottom_expand = max(0, (y_max + expand_h) - image.height) # 下边需要扩展的像素
        
        # 如果有任何一边需要扩展，创建新画布
        if left_expand > 0 or top_expand > 0 or right_expand > 0 or bottom_expand > 0:
            # 计算新画布尺寸
            canvas_width = (new_x_max - new_x_min) + left_expand + right_expand
            canvas_height = (new_y_max - new_y_min) + top_expand + bottom_expand
            
            # 创建新画布（透明背景）
            new_image = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
            new_mask = Image.new("L", (canvas_width, canvas_height), 0)
            
            # 计算原图内容在新画布中的粘贴位置
            # 确保内容居中，且描边完全可见
            paste_x = left_expand
            paste_y = top_expand
            
            # 计算从原图中裁剪的区域
            crop_x_min = max(0, new_x_min)
            crop_y_min = max(0, new_y_min)
            crop_x_max = min(image.width, new_x_max)
            crop_y_max = min(image.height, new_y_max)
            
            # 裁剪原图内容
            if crop_x_max > crop_x_min and crop_y_max > crop_y_min:
                cropped_image = image.crop((crop_x_min, crop_y_min, crop_x_max, crop_y_max))
                cropped_mask = mask.crop((crop_x_min, crop_y_min, crop_x_max, crop_y_max))
                
                # 粘贴到新画布
                new_image.paste(cropped_image, (paste_x, paste_y))
                new_mask.paste(cropped_mask, (paste_x, paste_y))
            
            return new_image, new_mask
        else:
            # 直接裁剪（不需要扩展画布）
            crop_box = (new_x_min, new_y_min, new_x_max, new_y_max)
            return image.crop(crop_box), mask.crop(crop_box)
    
    def apply_mask_to_image(self, image, mask):
        """应用遮罩到图像，挖空背景"""
        # 确保遮罩与图像尺寸一致
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.NEAREST)
        
        # 创建alpha通道
        alpha = np.array(mask)
        alpha = np.where(alpha > 128, 255, 0).astype(np.uint8)
        
        # 分离RGB和A通道
        rgb = np.array(image.convert("RGB"))
        rgba = np.dstack((rgb, alpha))
        
        return Image.fromarray(rgba, "RGBA")
    
    def add_image_stroke(self, image, mask, stroke_width, stroke_color):
        """添加图像描边，确保描边宽度一致且完全可见"""
        if stroke_width <= 0:
            return image
        
        # 确保遮罩与图像尺寸一致
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.NEAREST)
        
        # 将颜色字符串转换为RGB元组
        if isinstance(stroke_color, str):
            stroke_rgb = self.hex_to_rgb(stroke_color)
        else:
            stroke_rgb = self.parse_color_object(stroke_color)
        
        # 创建描边图像（使用更精确的方法）
        stroke_image = Image.new("RGBA", image.size, (0, 0, 0, 0))
        
        # 使用图像膨胀创建描边效果
        # 先创建一个临时遮罩用于生成描边
        temp_mask = mask.copy()
        
        # 多次膨胀来创建描边宽度
        for i in range(stroke_width):
            temp_mask = temp_mask.filter(ImageFilter.MaxFilter(3))
        
        # 从膨胀后的遮罩中减去原始遮罩，得到纯描边区域
        stroke_only = Image.new("L", mask.size, 0)
        stroke_only_array = np.array(temp_mask) - np.array(mask)
        stroke_only_array = np.clip(stroke_only_array, 0, 255).astype(np.uint8)
        stroke_only = Image.fromarray(stroke_only_array, "L")
        
        # 在描边图像上绘制描边
        stroke_data = np.array(stroke_image)
        stroke_only_array = np.array(stroke_only)
        
        # 应用描边颜色
        stroke_positions = stroke_only_array > 0
        stroke_data[stroke_positions, 0] = stroke_rgb[0]  # R
        stroke_data[stroke_positions, 1] = stroke_rgb[1]  # G
        stroke_data[stroke_positions, 2] = stroke_rgb[2]  # B
        stroke_data[stroke_positions, 3] = 255  # A
        
        stroke_image = Image.fromarray(stroke_data, "RGBA")
        
        # 合并描边和原图像（描边在下层，原图像在上层）
        result = Image.alpha_composite(stroke_image, image)
        return result
    
    def rgba_to_rgb(self, rgba_image, stroke_color):
        """将RGBA图像转换为RGB图像，透明背景填充为指定颜色"""
        # 将颜色字符串转换为RGB元组
        if isinstance(stroke_color, str):
            bg_rgb = self.hex_to_rgb(stroke_color)
        else:
            bg_rgb = self.parse_color_object(stroke_color)
        
        # 创建背景图像
        bg_image = Image.new("RGB", rgba_image.size, bg_rgb)
        
        # 将RGBA图像合成到背景上
        rgba_array = np.array(rgba_image)
        rgb_array = np.array(bg_image)
        
        # 使用alpha通道进行混合
        alpha = rgba_array[:, :, 3:] / 255.0
        rgb_result = (rgba_array[:, :, :3] * alpha + rgb_array * (1 - alpha)).astype(np.uint8)
        
        return Image.fromarray(rgb_result, "RGB")
    
    def hex_to_rgb(self, hex_color):
        """将十六进制颜色转换为RGB元组"""
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 3:
            hex_color = ''.join([c*2 for c in hex_color])
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    
    def parse_color_object(self, color_obj):
        """解析ComfyUI颜色对象"""
        # ComfyUI颜色对象可能有不同的表示方式
        # 尝试几种常见的格式
        
        # 如果是字典格式
        if isinstance(color_obj, dict):
            if 'r' in color_obj and 'g' in color_obj and 'b' in color_obj:
                return (color_obj['r'], color_obj['g'], color_obj['b'])
            elif 'hex' in color_obj:
                return self.hex_to_rgb(color_obj['hex'])
        
        # 如果是列表或元组格式
        if isinstance(color_obj, (list, tuple)) and len(color_obj) >= 3:
            return tuple(int(c) for c in color_obj[:3])
        
        # 默认返回白色
        return (255, 255, 255)
    
    def pil_to_mask(self, pil_image):
        """将PIL图像转换为掩码tensor"""
        if pil_image.mode != 'L':
            pil_image = pil_image.convert('L')
        mask_array = np.array(pil_image).astype(np.float32) / 255.0
        return torch.from_numpy(mask_array)
    
    def tensor2pil(self, image_tensor):
        """将tensor转换为PIL图像（符合ComfyUI格式）"""
        # 确保是CPU tensor
        if isinstance(image_tensor, torch.Tensor):
            image_tensor = image_tensor.cpu()
        
        # 转换为numpy数组
        if isinstance(image_tensor, torch.Tensor):
            image_np = image_tensor.numpy()
        else:
            image_np = image_tensor
        
        # 处理不同的维度
        if image_np.ndim == 3:
            # [H, W, C] 格式
            image_np = (image_np * 255).astype(np.uint8)
        elif image_np.ndim == 4:
            # [B, H, W, C] 格式，取第一个
            image_np = (image_np[0] * 255).astype(np.uint8)
        
        return Image.fromarray(image_np)
    
    def pil2tensor(self, image):
        """将PIL图像转换为tensor（符合ComfyUI格式）"""
        # 转换为numpy数组
        if isinstance(image, Image.Image):
            image_np = np.array(image).astype(np.float32) / 255.0
        else:
            image_np = image.astype(np.float32) / 255.0
        
        # 确保是 [B, H, W, C] 格式
        if image_np.ndim == 3:
            image_np = np.expand_dims(image_np, axis=0)
        
        return torch.from_numpy(image_np)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "RemoveBackgroundWithMask": RemoveBackgroundWithMask
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RemoveBackgroundWithMask": "孤海-保留遮罩区域移除图像背景"
}