import torch
import numpy as np
from PIL import Image, ImageOps
import math

class 孤海_图像嵌入:
    """
    将嵌入图像根据遮罩嵌入到背景图中的节点
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "背景图": ("IMAGE",),
                "嵌入图": ("IMAGE",),
                "嵌入遮罩": ("MASK",),
                "嵌入方式": (["拉伸", "裁剪", "填充白色", "填充黑色", "填充边缘色"], {"default": "裁剪"}),
                "嵌入到": (["上层", "下层"], {"default": "上层"}),
                "输出通道": (["跟随输入", "RGBA", "RGB"], {"default": "跟随输入"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "process_image"
    CATEGORY = "image"
    DESCRIPTION = "将嵌入图像按照遮罩区域嵌入到背景图中"

    def process_image(self, 背景图, 嵌入图, 嵌入遮罩, 嵌入方式, 嵌入到, 输出通道):
        # 标准化输入张量形状
        背景图 = self.standardize_image_tensor(背景图)
        嵌入图 = self.standardize_image_tensor(嵌入图)
        嵌入遮罩 = self.standardize_mask_tensor(嵌入遮罩)
        
        # 获取批次大小
        batch_size = min(背景图.shape[0], 嵌入图.shape[0], 嵌入遮罩.shape[0])
        results = []
        
        for i in range(batch_size):
            # 获取当前批次的张量
            bg_tensor = 背景图[i] if 背景图.shape[0] > 1 else 背景图[0]
            embed_tensor = 嵌入图[i] if 嵌入图.shape[0] > 1 else 嵌入图[0]
            mask_tensor = 嵌入遮罩[i] if 嵌入遮罩.shape[0] > 1 else 嵌入遮罩[0]
            
            # 检查背景图和遮罩尺寸是否相同
            bg_height, bg_width = bg_tensor.shape[0], bg_tensor.shape[1]
            mask_height, mask_width = mask_tensor.shape[0], mask_tensor.shape[1]
            
            if bg_height != mask_height or bg_width != mask_width:
                # 如果尺寸不匹配，调整遮罩大小以匹配背景图
                mask_tensor = self.resize_mask(mask_tensor, bg_width, bg_height)
            
            # 转换为PIL图像
            bg_pil = self.tensor_to_pil(bg_tensor)
            embed_pil = self.tensor_to_pil(embed_tensor)
            
            # 处理遮罩
            mask_pil = Image.fromarray((mask_tensor.cpu().numpy() * 255).astype(np.uint8))
            mask_array = np.array(mask_pil)
            
            # 获取遮罩非0区域的边界框
            non_zero_indices = np.where(mask_array > 0)
            if len(non_zero_indices[0]) == 0:
                # 遮罩全为0，直接返回背景图
                result_pil = bg_pil.copy()
            else:
                y_min, y_max = np.min(non_zero_indices[0]), np.max(non_zero_indices[0])
                x_min, x_max = np.min(non_zero_indices[1]), np.max(non_zero_indices[1])
                
                mask_width = x_max - x_min + 1
                mask_height = y_max - y_min + 1
                
                # 根据嵌入方式处理嵌入图
                processed_embed_pil = self.process_embed_image(embed_pil, mask_width, mask_height, 嵌入方式)
                
                # 创建结果图像
                if 嵌入到 == "上层":
                    result_pil = self.embed_on_background(bg_pil, processed_embed_pil, mask_array, x_min, y_min)
                else:  # 下层
                    result_pil = self.embed_under_background(bg_pil, processed_embed_pil, mask_array, x_min, y_min)
            
            # 处理输出通道
            result_pil = self.process_output_channels(result_pil, bg_pil, 输出通道)
            
            # 转换回tensor
            result_tensor = self.pil_to_tensor(result_pil)
            results.append(result_tensor)
        
        # 合并批次结果
        if len(results) > 1:
            output = torch.cat(results, dim=0)
        else:
            output = results[0]
        
        return (output,)
    
    def standardize_image_tensor(self, tensor):
        """标准化图像张量形状为 (batch, height, width, channels)"""
        if len(tensor.shape) == 3:
            # 形状为 (H, W, C) 或 (C, H, W)
            if tensor.shape[0] in [1, 3, 4] and tensor.shape[2] not in [1, 3, 4]:
                # 形状为 (C, H, W)，转换为 (H, W, C)
                tensor = tensor.permute(1, 2, 0)
            # 添加批次维度
            tensor = tensor.unsqueeze(0)
        elif len(tensor.shape) == 4 and tensor.shape[1] in [1, 3, 4]:
            # 形状为 (batch, C, H, W)，转换为 (batch, H, W, C)
            tensor = tensor.permute(0, 2, 3, 1)
        
        # 确保在0-1范围内
        if tensor.max() > 1.0:
            tensor = tensor / 255.0
        
        return tensor
    
    def standardize_mask_tensor(self, tensor):
        """标准化遮罩张量形状为 (batch, height, width)"""
        if len(tensor.shape) == 2:
            # 形状为 (H, W)，添加批次维度
            tensor = tensor.unsqueeze(0)
        elif len(tensor.shape) == 3 and tensor.shape[0] in [1, 3, 4]:
            # 形状为 (C, H, W) 或 (1, H, W)
            if tensor.shape[0] == 1:
                # 形状为 (1, H, W)，转换为 (H, W)
                tensor = tensor.squeeze(0)
            else:
                # 形状为 (C, H, W)，转换为 (H, W)
                tensor = tensor[0]
            # 添加批次维度
            tensor = tensor.unsqueeze(0)
        elif len(tensor.shape) == 4:
            # 形状为 (batch, 1, H, W)，转换为 (batch, H, W)
            tensor = tensor.squeeze(1)
        
        # 确保在0-1范围内
        if tensor.max() > 1.0:
            tensor = tensor / 255.0
        
        return tensor
    
    def resize_mask(self, mask_tensor, target_width, target_height):
        """调整遮罩大小以匹配目标尺寸"""
        # 转换为PIL图像
        mask_np = (mask_tensor.cpu().numpy() * 255).astype(np.uint8)
        mask_pil = Image.fromarray(mask_np)
        
        # 调整大小
        resized_mask = mask_pil.resize((target_width, target_height), Image.Resampling.LANCZOS)
        
        # 转换回张量
        resized_np = np.array(resized_mask).astype(np.float32) / 255.0
        resized_tensor = torch.from_numpy(resized_np)
        
        return resized_tensor
    
    def tensor_to_pil(self, tensor):
        """将tensor转换为PIL图像"""
        # 确保tensor是(H, W, C)格式
        if len(tensor.shape) == 3:
            if tensor.shape[2] in [1, 3, 4]:
                # 已经是(H, W, C)格式
                pass
            elif tensor.shape[0] in [1, 3, 4]:
                # 是(C, H, W)格式，转换
                tensor = tensor.permute(1, 2, 0)
        
        # 转换为numpy数组
        if tensor.max() <= 1.0:
            tensor_np = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        else:
            tensor_np = tensor.cpu().numpy().clip(0, 255).astype(np.uint8)
        
        # 根据通道数创建图像
        if tensor_np.shape[2] == 4:
            return Image.fromarray(tensor_np, 'RGBA')
        elif tensor_np.shape[2] == 3:
            return Image.fromarray(tensor_np, 'RGB')
        elif tensor_np.shape[2] == 1:
            return Image.fromarray(tensor_np[:, :, 0], 'L')
        else:
            # 默认转换为RGB
            if tensor_np.shape[2] == 2:
                # 如果有2个通道，只取第一个通道
                return Image.fromarray(tensor_np[:, :, 0], 'L')
            else:
                # 如果超过4个通道，只取前3个
                return Image.fromarray(tensor_np[:, :, :3], 'RGB')
    
    def process_embed_image(self, embed_pil, target_width, target_height, embed_method):
        """根据嵌入方式处理嵌入图像"""
        if target_width <= 0 or target_height <= 0:
            return embed_pil
            
        embed_width, embed_height = embed_pil.size
        
        if embed_method == "拉伸":
            # 直接拉伸到目标尺寸
            return embed_pil.resize((target_width, target_height), Image.Resampling.LANCZOS)
        
        elif embed_method == "裁剪":
            # 等比例缩放，然后裁剪
            if embed_width == 0 or embed_height == 0:
                return embed_pil
                
            scale = max(target_width / embed_width, target_height / embed_height)
            new_width = int(embed_width * scale)
            new_height = int(embed_height * scale)
            scaled_pil = embed_pil.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 居中裁剪
            left = (new_width - target_width) // 2
            top = (new_height - target_height) // 2
            right = left + target_width
            bottom = top + target_height
            
            return scaled_pil.crop((left, top, right, bottom))
        
        elif embed_method in ["填充白色", "填充黑色", "填充边缘色"]:
            # 等比例缩放，然后填充
            if embed_width == 0 or embed_height == 0:
                return embed_pil
                
            scale = min(target_width / embed_width, target_height / embed_height)
            new_width = int(embed_width * scale)
            new_height = int(embed_height * scale)
            
            if new_width == 0 or new_height == 0:
                return embed_pil
                
            scaled_pil = embed_pil.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 确定填充颜色
            if embed_method == "填充白色":
                fill_color = (255, 255, 255, 255)
            elif embed_method == "填充黑色":
                fill_color = (0, 0, 0, 255)
            else:  # 填充边缘色
                fill_color = self.get_edge_color(embed_pil)
            
            # 创建新图像并粘贴
            if scaled_pil.mode in ['RGBA', 'LA'] and len(fill_color) == 4:
                new_image = Image.new('RGBA', (target_width, target_height), fill_color)
            else:
                if len(fill_color) == 4:
                    fill_color = fill_color[:3]  # 去掉alpha通道
                new_image = Image.new('RGB', (target_width, target_height), fill_color)
                scaled_pil = scaled_pil.convert('RGB')
            
            # 居中粘贴
            paste_x = (target_width - new_width) // 2
            paste_y = (target_height - new_height) // 2
            
            if scaled_pil.mode in ['RGBA', 'LA'] and new_image.mode == 'RGBA':
                new_image.paste(scaled_pil, (paste_x, paste_y), scaled_pil)
            else:
                new_image.paste(scaled_pil, (paste_x, paste_y))
            
            return new_image
        
        return embed_pil
    
    def get_edge_color(self, image_pil):
        """获取图像边缘的主要颜色"""
        width, height = image_pil.size
        
        if width == 0 or height == 0:
            return (128, 128, 128, 255)  # 默认灰色
        
        # 转换为RGB或RGBA进行处理
        if image_pil.mode not in ['RGB', 'RGBA']:
            image_pil = image_pil.convert('RGB')
            
        image_np = np.array(image_pil)
        
        # 获取四个边上的像素
        edge_pixels = []
        
        # 上边
        if height > 0:
            edge_pixels.extend(image_np[0, :])
        # 下边
        if height > 1:
            edge_pixels.extend(image_np[-1, :])
        # 左边
        if width > 0:
            edge_pixels.extend(image_np[:, 0])
        # 右边
        if width > 1:
            edge_pixels.extend(image_np[:, -1])
        
        if not edge_pixels:
            return (128, 128, 128, 255)  # 默认灰色
            
        edge_pixels = np.array(edge_pixels)
        
        if image_pil.mode == 'RGBA' and edge_pixels.shape[1] == 4:
            # 只取不透明度大于128的像素
            alpha_mask = edge_pixels[:, 3] > 128
            if np.any(alpha_mask):
                edge_pixels = edge_pixels[alpha_mask, :3]
            else:
                edge_pixels = edge_pixels[:, :3]
        
        if len(edge_pixels) == 0:
            return (128, 128, 128, 255)  # 默认灰色
        
        # 计算平均颜色
        mean_color = np.mean(edge_pixels, axis=0)
        
        if image_pil.mode == 'RGBA':
            return tuple(int(c) for c in mean_color[:3]) + (255,)
        else:
            return tuple(int(c) for c in mean_color) + (255,)
    
    def embed_on_background(self, bg_pil, embed_pil, mask_array, x, y):
        """将嵌入图放在背景图上层"""
        result_pil = bg_pil.copy()
        if result_pil.mode != 'RGBA':
            result_pil = result_pil.convert('RGBA')
        
        # 创建临时图层
        temp_layer = Image.new('RGBA', result_pil.size, (0, 0, 0, 0))
        
        # 确保嵌入图大小不超过背景图
        embed_width, embed_height = embed_pil.size
        bg_width, bg_height = result_pil.size
        
        if x + embed_width > bg_width:
            embed_width = bg_width - x
        if y + embed_height > bg_height:
            embed_height = bg_height - y
            
        if embed_width > 0 and embed_height > 0:
            if embed_width != embed_pil.width or embed_height != embed_pil.height:
                embed_pil = embed_pil.resize((embed_width, embed_height), Image.Resampling.LANCZOS)
            
            if embed_pil.mode == 'RGBA':
                temp_layer.paste(embed_pil, (x, y), embed_pil)
            else:
                temp_layer.paste(embed_pil, (x, y))
        
        # 创建遮罩图像
        mask_image = Image.fromarray(mask_array).convert('L')
        
        # 应用遮罩
        result_pil = Image.composite(temp_layer, result_pil, mask_image)
        
        return result_pil
    
    def embed_under_background(self, bg_pil, embed_pil, mask_array, x, y):
        """将嵌入图放在背景图下层"""
        # 获取背景图大小
        bg_width, bg_height = bg_pil.size
        
        # 先创建底层
        if bg_pil.mode == 'RGBA':
            under_layer = Image.new('RGBA', (bg_width, bg_height), (0, 0, 0, 0))
        else:
            under_layer = Image.new('RGB', (bg_width, bg_height), (0, 0, 0))
        
        # 确保嵌入图大小不超过背景图
        embed_width, embed_height = embed_pil.size
        
        if x + embed_width > bg_width:
            embed_width = bg_width - x
        if y + embed_height > bg_height:
            embed_height = bg_height - y
            
        if embed_width > 0 and embed_height > 0:
            if embed_width != embed_pil.width or embed_height != embed_pil.height:
                embed_pil = embed_pil.resize((embed_width, embed_height), Image.Resampling.LANCZOS)
            
            # 粘贴嵌入图
            if under_layer.mode == 'RGBA' and embed_pil.mode == 'RGBA':
                under_layer.paste(embed_pil, (x, y), embed_pil)
            else:
                under_layer.paste(embed_pil, (x, y))
        
        # 创建遮罩图像
        mask_image = Image.fromarray(mask_array).convert('L')
        
        # 反转遮罩（背景图在遮罩区域显示）
        inverted_mask = Image.eval(mask_image, lambda x: 255 - x)
        
        # 合并图层
        if bg_pil.mode == 'RGBA':
            result = Image.composite(bg_pil, under_layer, inverted_mask)
        else:
            # 如果背景图是RGB，先转换为RGBA
            bg_rgba = bg_pil.convert('RGBA')
            result = Image.composite(bg_rgba, under_layer, inverted_mask)
        
        return result
    
    def process_output_channels(self, image_pil, bg_pil, output_mode):
        """处理输出通道模式"""
        if output_mode == "RGBA":
            if image_pil.mode != 'RGBA':
                return image_pil.convert('RGBA')
        elif output_mode == "RGB":
            if image_pil.mode != 'RGB':
                return image_pil.convert('RGB')
        else:  # 跟随输入
            if bg_pil.mode == 'RGBA' and image_pil.mode != 'RGBA':
                return image_pil.convert('RGBA')
            elif bg_pil.mode == 'RGB' and image_pil.mode != 'RGB':
                return image_pil.convert('RGB')
        
        return image_pil
    
    def pil_to_tensor(self, image_pil):
        """将PIL图像转换为tensor"""
        image_np = np.array(image_pil).astype(np.float32) / 255.0
        
        # 如果是单通道图像，添加通道维度
        if len(image_np.shape) == 2:
            image_np = np.expand_dims(image_np, axis=-1)
        
        # 确保形状为 (H, W, C)
        if len(image_np.shape) == 3 and image_np.shape[-1] in [1, 3, 4]:
            pass
        else:
            # 如果通道数不在预期中，只取前3个通道
            if image_np.shape[-1] > 4:
                image_np = image_np[:, :, :3]
        
        # 转换为tensor并添加批次维度
        image_tensor = torch.from_numpy(image_np).unsqueeze(0)
        
        return image_tensor


# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "孤海-图像嵌入": 孤海_图像嵌入
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-图像嵌入": "孤海-图像嵌入"
}