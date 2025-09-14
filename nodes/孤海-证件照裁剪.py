import numpy as np
import torch
from PIL import Image, ImageDraw
import comfy.utils

class CropIDPhotoNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "宽度": ("FLOAT", {"default": 3.5, "min": 0.1, "max": 3000.0, "step": 0.1}),
                "高度": ("FLOAT", {"default": 4.5, "min": 0.1, "max": 3000.0, "step": 0.1}),
                "dpi": ("INT", {"default": 300, "min": 72, "max": 2000}),
                "头顶距离": ("FLOAT", {"default": 0.10, "min": 0.0, "max": 0.3, "step": 0.01}),
                "肩膀高度": ("FLOAT", {"default": 0.30, "min": 0.0, "max": 0.5, "step": 0.01}),
                "单位": (["厘米", "像素"], {"default": "厘米"}),
                "采样点阈值": ("INT", {"default": 5, "min": 1, "max": 20, "step": 1}),
            },
            "optional": {
                "参考遮罩": ("MASK",),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN")
    RETURN_NAMES = ("图像", "扩图遮罩", "是否扩展")
    FUNCTION = "crop_photo"
    CATEGORY = "孤海工具箱"

    def crop_photo(self, image, mask, 宽度, 高度, dpi, 头顶距离, 肩膀高度, 单位, 采样点阈值, 参考遮罩=None):
        # 单位转换
        if 单位 == "厘米":
            target_width = int(宽度 * dpi / 2.54 + 0.5)
            target_height = int(高度 * dpi / 2.54 + 0.5)
        else:
            target_width = int(宽度)
            target_height = int(高度)
        
        # 转换输入为numpy数组
        i = 255. * image[0].cpu().numpy()
        img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        mask_arr = mask[0].cpu().numpy() * 255
        mask_img = Image.fromarray(mask_arr.astype(np.uint8))
        
        # 获取原始尺寸
        orig_width, orig_height = img.size
        
        # 找到人像主体边界
        mask_np = np.array(mask_img)
        y_indices, x_indices = np.where(mask_np > 128)
        if len(x_indices) == 0 or len(y_indices) == 0:
            # 返回全黑扩图遮罩和False
            black_mask = torch.zeros((1, target_height, target_width), dtype=torch.float32)
            return (image, black_mask, False)
        
        # 找到人像顶部位置
        y_min = np.min(y_indices)
        y_max = np.max(y_indices)
        
        # 肩膀定位算法 - 高级版本
        shoulder_y = None
        prev_left = None
        prev_right = None
        width_changes = []  # 存储所有行的宽度变化
        candidate_regions = []  # 存储候选的肩膀区域
        
        # 从顶部开始向下扫描，只扫描人像区域的下半部分（避免头发干扰）
        start_y = max(y_min, int(y_min + (y_max - y_min) * 0.4))  # 从40%高度开始
        end_y = min(orig_height, int(y_min + (y_max - y_min) * 0.8))  # 到80%高度结束
        
        # 计算平均变化量
        avg_change = 0
        change_count = 0
        
        # 第一遍扫描：计算平均变化量
        for y in range(start_y, end_y, 3):
            row = mask_np[y, :]
            if np.any(row > 128):
                # 找到当前行的左右边界
                left_x = np.argmax(row > 128)
                right_x = len(row) - 1 - np.argmax(row[::-1] > 128)
                
                if prev_left is not None and prev_right is not None:
                    # 计算宽度变化
                    left_change = prev_left - left_x  # 正值表示向左扩展
                    right_change = right_x - prev_right  # 正值表示向右扩展
                    
                    # 只考虑肩膀变宽的情况（左右同时扩展）
                    if left_change > 0 and right_change > 0:
                        # 总宽度变化量
                        total_change = left_change + right_change
                        avg_change += total_change
                        change_count += 1
                
                prev_left = left_x
                prev_right = right_x
        
        if change_count > 0:
            avg_change /= change_count
        
        # 第二遍扫描：寻找持续变化的区域
        prev_left = None
        prev_right = None
        current_region = []
        min_change_threshold = max(5, avg_change * 0.8)  # 最小变化阈值
        
        for y in range(start_y, end_y, 3):
            row = mask_np[y, :]
            if np.any(row > 128):
                # 找到当前行的左右边界
                left_x = np.argmax(row > 128)
                right_x = len(row) - 1 - np.argmax(row[::-1] > 128)
                
                if prev_left is not None and prev_right is not None:
                    # 计算宽度变化
                    left_change = prev_left - left_x
                    right_change = right_x - prev_right
                    
                    # 只考虑肩膀变宽的情况（左右同时扩展）
                    if left_change > 0 and right_change > 0:
                        total_change = left_change + right_change
                        
                        # 检查是否超过最小变化阈值
                        if total_change > min_change_threshold:
                            # 检查变化是否稳定（与区域平均值相似）
                            if current_region:
                                region_avg = np.mean([c for _, c in current_region])
                                if abs(total_change - region_avg) < region_avg * 0.5:  # 变化在50%范围内
                                    current_region.append((y, total_change))
                                else:
                                    # 变化不稳定，结束当前区域
                                    if len(current_region) >= 采样点阈值:
                                        candidate_regions.append(current_region)
                                    current_region = [(y, total_change)]
                            else:
                                current_region.append((y, total_change))
                        else:
                            # 变化太小，结束当前区域
                            if len(current_region) >= 采样点阈值:
                                candidate_regions.append(current_region)
                            current_region = []
                    else:
                        # 不是变宽，结束当前区域
                        if len(current_region) >= 采样点阈值:
                            candidate_regions.append(current_region)
                        current_region = []
                else:
                    # 第一行数据，初始化
                    current_region = []
                
                prev_left = left_x
                prev_right = right_x
        
        # 处理最后一个区域
        if len(current_region) >= 采样点阈值:
            candidate_regions.append(current_region)
        
        # 选择最佳肩膀区域
        if candidate_regions:
            # 选择最长的连续区域
            best_region = max(candidate_regions, key=len)
            
            # 取区域的中间位置作为肩膀位置
            region_y_values = [y for y, _ in best_region]
            shoulder_y = int(np.mean(region_y_values))
        else:
            # 如果没有找到符合条件的区域，使用默认位置
            shoulder_y = int(y_min + (y_max - y_min) * 0.7)
            print("使用默认肩膀位置")
        
        # 计算裁剪区域
        # 头顶到肩膀的高度（占最终高度的60%）
        head_to_shoulder = shoulder_y - y_min
        total_height = head_to_shoulder / (1 - 头顶距离 - 肩膀高度)
        
        # 计算裁剪区域的垂直位置
        crop_y0 = int(y_min - total_height * 头顶距离)
        crop_y1 = int(crop_y0 + total_height)
        
        # 计算裁剪区域的宽度（保持宽高比）
        aspect_ratio = target_width / target_height
        crop_width = int(total_height * aspect_ratio)
        
        # 水平居中裁剪 - 使用参考遮罩优先
        x_center = None
        
        # 如果有参考遮罩且有效
        if 参考遮罩 is not None:
            ref_mask_arr = 参考遮罩[0].cpu().numpy() * 255
            ref_mask_np = np.array(ref_mask_arr.astype(np.uint8))
            
            # 检查参考遮罩是否有效（非全黑非全白）
            if np.any(ref_mask_np > 128) and not np.all(ref_mask_np > 128):
                # 找到参考遮罩的中心点
                ref_y_indices, ref_x_indices = np.where(ref_mask_np > 128)
                if len(ref_x_indices) > 0:
                    ref_x_min = np.min(ref_x_indices)
                    ref_x_max = np.max(ref_x_indices)
                    x_center = (ref_x_min + ref_x_max) // 2
        
        # 如果没有有效的参考遮罩中心点，使用肩膀位置的水平中心点
        if x_center is None:
            # 使用肩膀区域的平均中心点
            if candidate_regions:
                best_region = candidate_regions[0]
                center_points = []
                for y, _ in best_region:
                    row = mask_np[y, :]
                    if np.any(row > 128):
                        left_x = np.argmax(row > 128)
                        right_x = len(row) - 1 - np.argmax(row[::-1] > 128)
                        center_points.append((left_x + right_x) // 2)
                if center_points:
                    x_center = int(np.mean(center_points))
            
            # 如果肩膀区域没有有效点，使用整个人像的水平中心
            if x_center is None:
                x_center = (np.min(x_indices) + np.max(x_indices)) // 2
        
        crop_x0 = int(x_center - crop_width / 2)
        crop_x1 = int(x_center + crop_width / 2)
        
        # 计算实际裁剪区域（可能超出原图边界）
        actual_crop_x0 = max(0, crop_x0)
        actual_crop_y0 = max(0, crop_y0)
        actual_crop_x1 = min(orig_width, crop_x1)
        actual_crop_y1 = min(orig_height, crop_y1)
        
        # 计算需要扩展的边界
        pad_left = max(0, -crop_x0)
        pad_top = max(0, -crop_y0)
        pad_right = max(0, crop_x1 - orig_width)
        pad_bottom = max(0, crop_y1 - orig_height)
        
        # 创建新图像（可能包含扩展区域）
        new_img = Image.new("RGB", (crop_width, int(total_height)))
        
        # 智能填充扩展区域
        if pad_left > 0:
            # 使用左侧边界颜色填充
            left_color = img.getpixel((0, y_min))
            draw = ImageDraw.Draw(new_img)
            draw.rectangle([(0, 0), (pad_left, int(total_height))], fill=left_color)
        
        if pad_top > 0:
            # 使用顶部边界颜色填充
            top_color = img.getpixel((x_center, 0))
            draw = ImageDraw.Draw(new_img)
            draw.rectangle([(0, 0), (crop_width, pad_top)], fill=top_color)
        
        if pad_right > 0:
            # 使用右侧边界颜色填充
            right_color = img.getpixel((orig_width-1, y_min))
            draw = ImageDraw.Draw(new_img)
            draw.rectangle([(crop_width-pad_right, 0), (crop_width, int(total_height))], fill=right_color)
        
        if pad_bottom > 0:
            # 使用底部边界颜色填充
            bottom_color = img.getpixel((x_center, orig_height-1))
            draw = ImageDraw.Draw(new_img)
            draw.rectangle([(0, int(total_height)-pad_bottom), (crop_width, int(total_height))], fill=bottom_color)
        
        # 粘贴原始图像部分
        paste_x = pad_left
        paste_y = pad_top
        paste_width = actual_crop_x1 - actual_crop_x0
        paste_height = actual_crop_y1 - actual_crop_y0
        
        if paste_width > 0 and paste_height > 0:
            cropped_part = img.crop((actual_crop_x0, actual_crop_y0, actual_crop_x1, actual_crop_y1))
            new_img.paste(cropped_part, (paste_x, paste_y))
        
        # 创建扩图遮罩
        expansion_mask = Image.new("L", (crop_width, int(total_height)), 0)
        draw = ImageDraw.Draw(expansion_mask)
        
        # 标记扩展区域为白色
        if pad_left > 0:
            draw.rectangle([(0, 0), (pad_left, int(total_height))], fill=255)
        if pad_top > 0:
            draw.rectangle([(0, 0), (crop_width, pad_top)], fill=255)
        if pad_right > 0:
            draw.rectangle([(crop_width-pad_right, 0), (crop_width, int(total_height))], fill=255)
        if pad_bottom > 0:
            draw.rectangle([(0, int(total_height)-pad_bottom), (crop_width, int(total_height))], fill=255)
        
        # 缩放至目标尺寸
        if new_img.size != (target_width, target_height):
            new_img = new_img.resize((target_width, target_height), Image.LANCZOS)
            expansion_mask = expansion_mask.resize((target_width, target_height), Image.NEAREST)
        
        # 转换回ComfyUI格式
        cropped_np = np.array(new_img).astype(np.float32) / 255.0
        cropped_tensor = torch.from_numpy(cropped_np).unsqueeze(0)
        
        # 转换扩图遮罩
        mask_np = np.array(expansion_mask).astype(np.float32) / 255.0
        mask_tensor = torch.from_numpy(mask_np).unsqueeze(0)
        
        # 检查是否有扩展
        has_expansion = pad_left > 0 or pad_top > 0 or pad_right > 0 or pad_bottom > 0
        
        return (cropped_tensor, mask_tensor, has_expansion)

NODE_CLASS_MAPPINGS = {
    "孤海-证件照裁剪": CropIDPhotoNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-证件照裁剪": "孤海-证件照裁剪"
}