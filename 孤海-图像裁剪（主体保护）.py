import torch
import numpy as np
from PIL import Image, ImageFilter
from collections import Counter

class GohaiImageCropWithMaskProtection:
    """
    孤海-图像裁剪（主体保护）
    通过保护遮罩裁剪出目标尺寸的图像，同时保护遮罩区域完整保留
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "宽度": ("INT", {"default": 1024, "min": 10, "max": 8192, "step": 1}),
                "高度": ("INT", {"default": 1024, "min": 10, "max": 8192, "step": 1}),
            },
            "optional": {
                "保护遮罩": ("MASK",),
                "保护扩展系数": ("FLOAT", {"default": 1.2, "min": 1.0, "max": 3.0, "step": 0.1}),
                "填充模式": (["白色", "黑色", "灰色", "投影", "边框颜色"], {"default": "边框颜色"}),
                "整除数": ("INT", {"default": 0, "min": 0, "max": 512, "step": 1}),
            },
        }
    
    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN")
    RETURN_NAMES = ("图像", "扩展遮罩", "是否扩展")
    FUNCTION = "crop_with_mask_protection"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "通过保护遮罩裁剪图像，保护遮罩区域完整保留"

    def crop_with_mask_protection(self, 图像, 宽度, 高度, 填充模式, 保护遮罩=None, 保护扩展系数=1.0, 整除数=0):
        # 处理整除数
        if 整除数 > 0:
            宽度 = (宽度 // 整除数) * 整除数
            高度 = (高度 // 整除数) * 整除数
            # 确保宽度和高度至少为1
            宽度 = max(1, 宽度)
            高度 = max(1, 高度)
        
        # 转换为PIL图像方便处理
        图像_pil = self.tensor_to_pil(图像)
        
        # 获取原图尺寸
        W, H = 图像_pil.size
        W2, H2 = 宽度, 高度
        
        # 初始化扩展遮罩和是否扩展标志
        扩展遮罩 = None
        是否扩展 = 0
        
        # 检查遮罩输入
        if 保护遮罩 is None:
            # 没有遮罩输入，使用覆盖模式居中裁剪
            return self.cover_crop_and_resize(图像, 宽度, 高度)
        
        # 处理遮罩
        保护遮罩_pil = self.tensor_to_pil(保护遮罩.unsqueeze(-1))
        
        # 计算遮罩的白色区域信息
        保护遮罩_array = np.array(保护遮罩_pil.convert("L"))
        保护遮罩_binary = 保护遮罩_array > 127
        
        if not 保护遮罩_binary.any():
            # 遮罩为全黑，使用覆盖模式居中裁剪
            return self.cover_crop_and_resize(图像, 宽度, 高度)
        
        # 找到白色区域的边界
        white_pixels = np.where(保护遮罩_binary)
        y_min, y_max = np.min(white_pixels[0]), np.max(white_pixels[0])
        x_min, x_max = np.min(white_pixels[1]), np.max(white_pixels[1])
        
        # 处理保护扩展系数
        if 保护扩展系数 != 1.0:
            # 计算原始遮罩矩形的宽高
            w_original = x_max - x_min + 1
            h_original = y_max - y_min + 1
            
            # 计算扩展后的宽高
            w_expanded = int(w_original * 保护扩展系数)
            h_expanded = int(h_original * 保护扩展系数)
            
            # 计算需要扩展的宽度和高度
            w_expand = w_expanded - w_original
            h_expand = h_expanded - h_original
            
            # 计算新的边界（确保不超出原图边界）
            x_min_new = max(0, x_min - w_expand // 2)
            x_max_new = min(W - 1, x_max + w_expand // 2)
            y_min_new = max(0, y_min - h_expand // 2)
            y_max_new = min(H - 1, y_max + h_expand // 2)
            
            # 如果扩展后边界没有变化，则使用原始边界
            if (x_min_new != x_min or x_max_new != x_max or 
                y_min_new != y_min or y_max_new != y_max):
                x_min, x_max = x_min_new, x_max_new
                y_min, y_max = y_min_new, y_max_new
        
        # 计算遮罩白色区域最小外接矩形
        w0 = x_max - x_min + 1
        h0 = y_max - y_min + 1
        x0 = (x_min + x_max) / 2
        y0 = (y_min + y_max) / 2
        
        # 计算遮罩到边界的距离
        h1 = y_min  # 遮罩上边距画布顶端距离
        h2 = H - 1 - y_max  # 遮罩下边距画布底部距离
        v1 = x_min  # 遮罩左边距画布左边距离
        v2 = W - 1 - x_max  # 遮罩右边距画布右边距离
        
        # 计算宽高比
        a = W / H
        b = W2 / H2
        
        # 情况A: a < b
        if a < b:
            # 矩形D: 宽度等于原图宽度W，高度为遮罩高度h0
            # 上边与遮罩上边缘重合，下边与遮罩下边缘重合
            rect_D_top = y_min
            rect_D_bottom = y_max + 1
            rect_D_left = 0
            rect_D_right = W
            
            # 计算矩形区域应有高度
            rect_height_required = W / b
            
            # 比较矩形区域应有高度与遮罩高度
            if rect_height_required >= h0:
                # 需要扩展矩形D的高度
                height_expand = rect_height_required - h0
                
                # 计算上下扩展量
                if h1 + h2 > 0:
                    top_expand = height_expand * (h1 / (h1 + h2))
                    bottom_expand = height_expand - top_expand
                else:
                    # 没有扩展空间，直接使用矩形D
                    top_expand = 0
                    bottom_expand = 0
                
                # 计算矩形E的边界
                rect_E_top = max(0, rect_D_top - top_expand)
                rect_E_bottom = min(H, rect_D_bottom + bottom_expand)
                rect_E_left = 0
                rect_E_right = W
                
                # 裁剪矩形E区域
                crop_left = int(rect_E_left)
                crop_top = int(rect_E_top)
                crop_right = int(rect_E_right)
                crop_bottom = int(rect_E_bottom)
                
                cropped_img = 图像_pil.crop((crop_left, crop_top, crop_right, crop_bottom))
                
                # 等比例缩放到目标尺寸
                resized_img = cropped_img.resize((W2, H2), Image.Resampling.LANCZOS)
                
                # 创建全黑扩展遮罩（无填充）
                扩展遮罩 = self.create_black_mask(W2, H2)
                
                return (self.pil_to_tensor(resized_img), 扩展遮罩, 是否扩展)
            else:
                # 直接使用矩形D区域
                crop_left = int(rect_D_left)
                crop_top = int(rect_D_top)
                crop_right = int(rect_D_right)
                crop_bottom = int(rect_D_bottom)
                
                cropped_img = 图像_pil.crop((crop_left, crop_top, crop_right, crop_bottom))
                
                # 等比例缩放到高度等于目标高度
                crop_h = crop_bottom - crop_top
                crop_w = crop_right - crop_left
                
                # 计算缩放比例
                scale_factor = H2 / crop_h
                new_width = int(crop_w * scale_factor)
                
                # 先缩放
                resized_img = cropped_img.resize((new_width, H2), Image.Resampling.LANCZOS)
                
                # 创建目标尺寸的画布
                target_img = Image.new("RGB", (W2, H2), (0, 0, 0))
                
                # 计算左右填充位置
                if new_width < W2:
                    # 需要左右填充
                    left_pad = (W2 - new_width) // 2
                    
                    # 检查是否达到扩展条件（单边填充超过目标宽度的0.5%）
                    if left_pad > W2 * 0.005:
                        是否扩展 = 1
                    
                    # 创建扩展遮罩（白色为填充区域）
                    扩展遮罩 = self.create_extension_mask(W2, H2, left_pad, new_width, "horizontal")
                    
                    # 根据填充模式选择填充方式
                    if 填充模式 == "白色":
                        # 白色填充
                        target_img = Image.new("RGB", (W2, H2), (255, 255, 255))
                    elif 填充模式 == "黑色":
                        # 黑色填充
                        target_img = Image.new("RGB", (W2, H2), (0, 0, 0))
                    elif 填充模式 == "灰色":
                        # 灰色填充
                        target_img = Image.new("RGB", (W2, H2), (128, 128, 128))
                    elif 填充模式 == "边框颜色":
                        # 边框颜色填充
                        if crop_w > 1:
                            # 获取左右边界颜色
                            left_edge = cropped_img.crop((0, 0, 1, crop_h))
                            left_edge_resized = left_edge.resize((1, H2), Image.Resampling.LANCZOS)
                            left_color = self.get_dominant_color(left_edge_resized)
                            
                            right_edge = cropped_img.crop((crop_w-1, 0, crop_w, crop_h))
                            right_edge_resized = right_edge.resize((1, H2), Image.Resampling.LANCZOS)
                            right_color = self.get_dominant_color(right_edge_resized)
                            
                            # 创建左右填充
                            for x in range(W2):
                                if x < left_pad:
                                    # 左填充区域
                                    color = left_color
                                elif x >= left_pad + new_width:
                                    # 右填充区域
                                    color = right_color
                                else:
                                    # 图像区域
                                    continue
                                
                                for y in range(H2):
                                    target_img.putpixel((x, y), color)
                    else:  # 投影模式（原始模式）
                        # 获取左右边界颜色
                        if crop_w > 1:
                            left_edge = cropped_img.crop((0, 0, 1, crop_h))
                            left_edge_resized = left_edge.resize((1, H2), Image.Resampling.LANCZOS)
                            left_color = self.get_average_color(left_edge_resized)
                            
                            right_edge = cropped_img.crop((crop_w-1, 0, crop_w, crop_h))
                            right_edge_resized = right_edge.resize((1, H2), Image.Resampling.LANCZOS)
                            right_color = self.get_average_color(right_edge_resized)
                            
                            # 创建渐变填充
                            for x in range(W2):
                                if x < left_pad:
                                    # 左填充区域
                                    ratio = x / left_pad
                                    color = self.blend_colors(left_color, (0, 0, 0), ratio)
                                elif x >= left_pad + new_width:
                                    # 右填充区域
                                    ratio = (x - left_pad - new_width) / (W2 - left_pad - new_width)
                                    color = self.blend_colors((0, 0, 0), right_color, ratio)
                                else:
                                    # 图像区域
                                    continue
                                
                                for y in range(H2):
                                    target_img.putpixel((x, y), color)
                    
                    # 粘贴缩放后的图像
                    target_img.paste(resized_img, (left_pad, 0))
                    
                    # 投影模式需要应用高斯模糊平滑边缘
                    if 填充模式 == "投影":
                        target_img = target_img.filter(ImageFilter.GaussianBlur(radius=1))
                else:
                    # 不需要填充，创建全黑扩展遮罩
                    扩展遮罩 = self.create_black_mask(W2, H2)
                    target_img = resized_img
                
                return (self.pil_to_tensor(target_img), 扩展遮罩, 是否扩展)
        
        # 情况B: a >= b (包含a = b的情况)
        else:
            # 矩形F: 高度等于原图高度H，宽度为遮罩宽度w0
            # 左边与遮罩左边缘重合，右边与遮罩右边缘重合
            rect_F_left = x_min
            rect_F_right = x_max + 1
            rect_F_top = 0
            rect_F_bottom = H
            
            # 计算矩形区域应有宽度
            rect_width_required = H * b
            
            # 比较矩形区域应有宽度与遮罩宽度
            if rect_width_required >= w0:
                # 需要扩展矩形F的宽度
                width_expand = rect_width_required - w0
                
                # 计算左右扩展量
                if v1 + v2 > 0:
                    left_expand = width_expand * (v1 / (v1 + v2))
                    right_expand = width_expand - left_expand
                else:
                    # 没有扩展空间，直接使用矩形F
                    left_expand = 0
                    right_expand = 0
                
                # 计算矩形G的边界
                rect_G_left = max(0, rect_F_left - left_expand)
                rect_G_right = min(W, rect_F_right + right_expand)
                rect_G_top = 0
                rect_G_bottom = H
                
                # 裁剪矩形G区域
                crop_left = int(rect_G_left)
                crop_top = int(rect_G_top)
                crop_right = int(rect_G_right)
                crop_bottom = int(rect_G_bottom)
                
                cropped_img = 图像_pil.crop((crop_left, crop_top, crop_right, crop_bottom))
                
                # 等比例缩放到目标尺寸
                resized_img = cropped_img.resize((W2, H2), Image.Resampling.LANCZOS)
                
                # 创建全黑扩展遮罩（无填充）
                扩展遮罩 = self.create_black_mask(W2, H2)
                
                return (self.pil_to_tensor(resized_img), 扩展遮罩, 是否扩展)
            else:
                # 直接使用矩形F区域
                crop_left = int(rect_F_left)
                crop_top = int(rect_F_top)
                crop_right = int(rect_F_right)
                crop_bottom = int(rect_F_bottom)
                
                cropped_img = 图像_pil.crop((crop_left, crop_top, crop_right, crop_bottom))
                
                # 等比例缩放到宽度等于目标宽度
                crop_w = crop_right - crop_left
                crop_h = crop_bottom - crop_top
                
                # 计算缩放比例
                scale_factor = W2 / crop_w
                new_height = int(crop_h * scale_factor)
                
                # 先缩放
                resized_img = cropped_img.resize((W2, new_height), Image.Resampling.LANCZOS)
                
                # 创建目标尺寸的画布
                target_img = Image.new("RGB", (W2, H2), (0, 0, 0))
                
                # 计算上下填充位置
                if new_height < H2:
                    # 需要上下填充
                    top_pad = (H2 - new_height) // 2
                    
                    # 检查是否达到扩展条件（单边填充超过目标高度的0.5%）
                    if top_pad > H2 * 0.005:
                        是否扩展 = 1
                    
                    # 创建扩展遮罩（白色为填充区域）
                    扩展遮罩 = self.create_extension_mask(W2, H2, top_pad, new_height, "vertical")
                    
                    # 根据填充模式选择填充方式
                    if 填充模式 == "白色":
                        # 白色填充
                        target_img = Image.new("RGB", (W2, H2), (255, 255, 255))
                    elif 填充模式 == "黑色":
                        # 黑色填充
                        target_img = Image.new("RGB", (W2, H2), (0, 0, 0))
                    elif 填充模式 == "灰色":
                        # 灰色填充
                        target_img = Image.new("RGB", (W2, H2), (128, 128, 128))
                    elif 填充模式 == "边框颜色":
                        # 边框颜色填充
                        if crop_h > 1:
                            # 获取上下边界颜色
                            top_edge = cropped_img.crop((0, 0, crop_w, 1))
                            top_edge_resized = top_edge.resize((W2, 1), Image.Resampling.LANCZOS)
                            top_color = self.get_dominant_color(top_edge_resized)
                            
                            bottom_edge = cropped_img.crop((0, crop_h-1, crop_w, crop_h))
                            bottom_edge_resized = bottom_edge.resize((W2, 1), Image.Resampling.LANCZOS)
                            bottom_color = self.get_dominant_color(bottom_edge_resized)
                            
                            # 创建上下填充
                            for y in range(H2):
                                if y < top_pad:
                                    # 上填充区域
                                    color = top_color
                                elif y >= top_pad + new_height:
                                    # 下填充区域
                                    color = bottom_color
                                else:
                                    # 图像区域
                                    continue
                                
                                for x in range(W2):
                                    target_img.putpixel((x, y), color)
                    else:  # 投影模式（原始模式）
                        # 获取上下边界颜色
                        if crop_h > 1:
                            top_edge = cropped_img.crop((0, 0, crop_w, 1))
                            top_edge_resized = top_edge.resize((W2, 1), Image.Resampling.LANCZOS)
                            top_color = self.get_average_color(top_edge_resized)
                            
                            bottom_edge = cropped_img.crop((0, crop_h-1, crop_w, crop_h))
                            bottom_edge_resized = bottom_edge.resize((W2, 1), Image.Resampling.LANCZOS)
                            bottom_color = self.get_average_color(bottom_edge_resized)
                            
                            # 创建渐变填充
                            for y in range(H2):
                                if y < top_pad:
                                    # 上填充区域
                                    ratio = y / top_pad
                                    color = self.blend_colors(top_color, (0, 0, 0), ratio)
                                elif y >= top_pad + new_height:
                                    # 下填充区域
                                    ratio = (y - top_pad - new_height) / (H2 - top_pad - new_height)
                                    color = self.blend_colors((0, 0, 0), bottom_color, ratio)
                                else:
                                    # 图像区域
                                    continue
                                
                                for x in range(W2):
                                    target_img.putpixel((x, y), color)
                    
                    # 粘贴缩放后的图像
                    target_img.paste(resized_img, (0, top_pad))
                    
                    # 投影模式需要应用高斯模糊平滑边缘
                    if 填充模式 == "投影":
                        target_img = target_img.filter(ImageFilter.GaussianBlur(radius=1))
                else:
                    # 不需要填充，创建全黑扩展遮罩
                    扩展遮罩 = self.create_black_mask(W2, H2)
                    target_img = resized_img
                
                return (self.pil_to_tensor(target_img), 扩展遮罩, 是否扩展)
    
    def cover_crop_and_resize(self, 图像, 宽度, 高度):
        """覆盖模式：一个方向铺满画布，裁剪另一个方向超出部分，等比例缩放不拉伸"""
        图像_pil = self.tensor_to_pil(图像)
        W, H = 图像_pil.size
        W2, H2 = 宽度, 高度
        
        # 计算原图和目标尺寸的宽高比
        src_ratio = W / H
        dst_ratio = W2 / H2
        
        # 确定缩放策略
        if src_ratio > dst_ratio:
            # 原图更宽，按高度缩放（高度铺满，宽度裁剪）
            scale_factor = H2 / H
            new_width = int(W * scale_factor)
            # 先缩放
            resized_img = 图像_pil.resize((new_width, H2), Image.Resampling.LANCZOS)
            # 计算水平裁剪位置（居中）
            left = (new_width - W2) // 2
            right = left + W2
            # 裁剪
            cropped_img = resized_img.crop((left, 0, right, H2))
        else:
            # 原图更高或等比例，按宽度缩放（宽度铺满，高度裁剪）
            scale_factor = W2 / W
            new_height = int(H * scale_factor)
            # 先缩放
            resized_img = 图像_pil.resize((W2, new_height), Image.Resampling.LANCZOS)
            # 计算垂直裁剪位置（居中）
            top = (new_height - H2) // 2
            bottom = top + H2
            # 裁剪
            cropped_img = resized_img.crop((0, top, W2, bottom))
        
        # 创建全黑扩展遮罩（无填充）
        扩展遮罩 = self.create_black_mask(宽度, 高度)
        是否扩展 = 0
        
        return (self.pil_to_tensor(cropped_img), 扩展遮罩, 是否扩展)
    
    def create_black_mask(self, width, height):
        """创建全黑遮罩"""
        mask_array = np.zeros((height, width), dtype=np.float32)
        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)
        return mask_tensor
    
    def create_extension_mask(self, width, height, pad_size, content_size, direction):
        """创建扩展遮罩，白色区域表示填充部分"""
        mask_array = np.zeros((height, width), dtype=np.float32)
        
        if direction == "horizontal":
            # 水平方向填充（左右填充）
            left_pad = pad_size
            right_pad = width - pad_size - content_size
            
            # 设置左右填充区域为白色
            if left_pad > 0:
                mask_array[:, :left_pad] = 1.0
            if right_pad > 0:
                mask_array[:, width-right_pad:] = 1.0
        else:  # vertical
            # 垂直方向填充（上下填充）
            top_pad = pad_size
            bottom_pad = height - pad_size - content_size
            
            # 设置上下填充区域为白色
            if top_pad > 0:
                mask_array[:top_pad, :] = 1.0
            if bottom_pad > 0:
                mask_array[height-bottom_pad:, :] = 1.0
        
        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)
        return mask_tensor
    
    def tensor_to_pil(self, tensor):
        """将torch张量转换为PIL图像"""
        if len(tensor.shape) == 4:
            tensor = tensor[0]  # 取batch中的第一个
        
        # 转换为numpy
        if tensor.device.type == "cuda":
            tensor = tensor.cpu()
        
        tensor = tensor.numpy()
        
        # 归一化到0-255
        if tensor.max() <= 1.0:
            tensor = tensor * 255
        
        tensor = tensor.astype(np.uint8)
        
        if len(tensor.shape) == 2:  # 单通道
            return Image.fromarray(tensor, mode='L')
        elif tensor.shape[2] == 1:  # 单通道
            return Image.fromarray(tensor[:, :, 0], mode='L')
        elif tensor.shape[2] == 3:  # 三通道
            return Image.fromarray(tensor, mode='RGB')
        else:  # 四通道
            return Image.fromarray(tensor[:, :, :3], mode='RGB')
    
    def pil_to_tensor(self, pil_image):
        """将PIL图像转换为torch张量"""
        # 转换为numpy
        image_array = np.array(pil_image).astype(np.float32) / 255.0
        
        # 确保是RGB格式
        if len(image_array.shape) == 2:
            image_array = np.stack([image_array] * 3, axis=-1)
        elif image_array.shape[2] == 4:
            image_array = image_array[:, :, :3]
        elif image_array.shape[2] == 1:
            image_array = np.stack([image_array[:, :, 0]] * 3, axis=-1)
        
        # 转换为torch张量
        tensor = torch.from_numpy(image_array).unsqueeze(0)
        
        return tensor
    
    def get_average_color(self, pil_image):
        """获取图像的平均颜色"""
        image_array = np.array(pil_image)
        
        if len(image_array.shape) == 2:  # 灰度图
            avg_value = np.mean(image_array)
            return (int(avg_value), int(avg_value), int(avg_value))
        else:  # RGB图
            avg_r = np.mean(image_array[:, :, 0])
            avg_g = np.mean(image_array[:, :, 1])
            avg_b = np.mean(image_array[:, :, 2])
            return (int(avg_r), int(avg_g), int(avg_b))
    
    def get_dominant_color(self, pil_image):
        """获取图像中出现频率最高且颜色相近的平均色（排除反差较大的且数量不多的颜色）"""
        image_array = np.array(pil_image)
        
        # 如果是灰度图，转换为RGB格式
        if len(image_array.shape) == 2:
            image_array = np.stack([image_array] * 3, axis=-1)
        
        # 将图像转换为二维数组 (像素数, 3)
        pixels = image_array.reshape(-1, 3)
        
        # 计算所有像素的平均颜色
        avg_color = np.mean(pixels, axis=0)
        
        # 计算每个像素与平均颜色的欧氏距离
        distances = np.sqrt(np.sum((pixels - avg_color) ** 2, axis=1))
        
        # 计算距离的平均值和标准差
        mean_distance = np.mean(distances)
        std_distance = np.std(distances)
        
        # 设置阈值：排除距离大于平均值+标准差/2的像素（排除反差较大的颜色）
        threshold = mean_distance + std_distance / 2
        
        # 筛选出颜色相近的像素
        similar_pixels = pixels[distances <= threshold]
        
        # 如果相似像素数量太少（少于总像素的30%），则放宽阈值
        if len(similar_pixels) < len(pixels) * 0.3:
            threshold = mean_distance + std_distance
            similar_pixels = pixels[distances <= threshold]
        
        # 计算相似像素的平均颜色
        if len(similar_pixels) > 0:
            dominant_color = np.mean(similar_pixels, axis=0)
        else:
            # 如果没有相似像素，使用所有像素的平均颜色
            dominant_color = avg_color
        
        return (int(dominant_color[0]), int(dominant_color[1]), int(dominant_color[2]))
    
    def blend_colors(self, color1, color2, ratio):
        """混合两种颜色"""
        r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
        g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
        b = int(color1[2] * (1 - ratio) + color2[2] * ratio)
        return (r, g, b)


# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "GohaiImageCropWithMaskProtection": GohaiImageCropWithMaskProtection
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GohaiImageCropWithMaskProtection": "孤海-图像裁剪（主体保护）"
}