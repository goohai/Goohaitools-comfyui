import torch
import numpy as np
from PIL import Image

# 使用LANCZOS插值，这是目前Pillow中质量最高的插值方法
HIGH_QUALITY_INTERPOLATION = Image.LANCZOS
MASK_INTERPOLATION = Image.BILINEAR  # 遮罩使用双线性，平衡质量和速度

class 图像缩放范围孤海:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "图像": ("IMAGE",),
                "遮罩": ("MASK",),
                "限制模式": (["长边", "短边", "宽度", "高度", "宽度与高度"], {"default": "长边"}),
                "最小尺寸": ("INT", {"default": 1024, "min": 10, "max": 10240, "step": 1}),
                "最大尺寸": ("INT", {"default": 3000, "min": 10, "max": 10240, "step": 1}),
                "整除数": ("INT", {"default": 0, "min": 0, "max": 512, "step": 1}),
            },
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("图像", "遮罩")
    FUNCTION = "resize_image_range"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "把图像与遮罩尺寸限制到指定范围 - 支持多种限制模式的高质量图像缩放"
    
    def resize_image_range(self, 图像=None, 遮罩=None, 限制模式="长边", 最小尺寸=1024, 最大尺寸=3000, 整除数=0):
        # 检查至少有一个输入
        if 图像 is None and 遮罩 is None:
            raise ValueError("错误: 至少需要输入图像或遮罩中的一个")
        
        # 检查尺寸匹配
        if 图像 is not None and 遮罩 is not None:
            batch_size_img = 图像.shape[0] if 图像.ndim == 4 else 1
            batch_size_mask = 遮罩.shape[0] if 遮罩.ndim == 3 else 1
            
            if batch_size_img != batch_size_mask:
                raise ValueError(f"错误: 图像和遮罩的批次大小不匹配: 图像={batch_size_img}, 遮罩={batch_size_mask}")
        
        # 确保最小尺寸和最大尺寸合理
        最小尺寸 = max(1, 最小尺寸)
        最大尺寸 = max(最小尺寸, 最大尺寸)
        
        # 处理图像
        resized_images = []
        if 图像 is not None:
            for img in 图像:
                resized_img = self.resize_single_image(img, 限制模式, 最小尺寸, 最大尺寸, 整除数, True)
                resized_images.append(resized_img)
            
            if resized_images:
                resized_images = torch.cat(resized_images, dim=0)
            else:
                resized_images = None
        
        # 处理遮罩
        resized_masks = []
        if 遮罩 is not None:
            # 检查遮罩是否全黑
            all_black_mask = True
            for mask in 遮罩:
                if not self.is_black_mask(mask):
                    all_black_mask = False
                    break
            
            # 如果遮罩全黑，则跳过处理，后面会生成全黑遮罩
            if not all_black_mask:
                for mask in 遮罩:
                    # 为遮罩添加通道维度以匹配图像格式
                    if mask.ndim == 2:
                        mask = mask.unsqueeze(-1)
                    
                    resized_mask = self.resize_single_image(mask, 限制模式, 最小尺寸, 最大尺寸, 整除数, False)
                    resized_masks.append(resized_mask)
                
                if resized_masks:
                    resized_masks = torch.cat(resized_masks, dim=0)
                    # 移除通道维度，恢复遮罩格式
                    if resized_masks.shape[-1] == 1:
                        resized_masks = resized_masks.squeeze(-1)
                else:
                    resized_masks = None
            else:
                resized_masks = None  # 全黑遮罩，后面会生成
        else:
            resized_masks = None  # 没有遮罩输入，后面会生成全黑遮罩
        
        # 生成全黑遮罩的逻辑
        if 图像 is not None and (遮罩 is None or (遮罩 is not None and self.is_black_mask(遮罩))):
            # 获取输出图像的尺寸
            if resized_images is not None:
                batch_size = resized_images.shape[0]
                height = resized_images.shape[1]
                width = resized_images.shape[2]
                
                # 创建全黑遮罩
                resized_masks = torch.zeros((batch_size, height, width), dtype=torch.float32)
        
        # 如果只有遮罩输入，图像输出为None
        if 图像 is None and resized_masks is not None:
            resized_images = None
        
        return (resized_images, resized_masks)
    
    def is_black_mask(self, mask_tensor):
        """
        检查遮罩是否全黑
        """
        if mask_tensor is None:
            return True
        
        # 处理批次维度
        if mask_tensor.ndim == 3:  # [B, H, W]
            for i in range(mask_tensor.shape[0]):
                if torch.any(mask_tensor[i] > 0.01):  # 容忍很小的误差
                    return False
            return True
        elif mask_tensor.ndim == 2:  # [H, W]
            return not torch.any(mask_tensor > 0.01)
        else:
            # 其他维度格式，默认不全黑
            return False
    
    def resize_single_image(self, img_tensor, 限制模式, 最小尺寸, 最大尺寸, 整除数, is_image=True):
        """
        处理单个图像或遮罩
        """
        # 转换为PIL图像
        if is_image:
            # 图像: [H, W, C] -> PIL Image
            img_pil = Image.fromarray((img_tensor.cpu().numpy() * 255).astype(np.uint8))
        else:
            # 遮罩: [H, W, 1] -> PIL Image (L mode)
            if img_tensor.shape[-1] == 1:
                mask_array = (img_tensor.cpu().numpy().squeeze(-1) * 255).astype(np.uint8)
            else:
                mask_array = (img_tensor.cpu().numpy() * 255).astype(np.uint8)
            img_pil = Image.fromarray(mask_array, mode='L')
        
        original_width, original_height = img_pil.size
        原始比例 = original_width / original_height
        
        # 根据限制模式计算目标尺寸
        目标宽度, 目标高度 = self.calculate_target_size(
            original_width, original_height, 限制模式, 最小尺寸, 最大尺寸, 原始比例
        )
        
        # 处理整除数 - 使用覆盖裁剪模式
        if 整除数 > 0:
            目标宽度, 目标高度 = self.apply_divisor_with_crop(
                目标宽度, 目标高度, 整除数, 原始比例
            )
        
        # 确保最小尺寸
        目标宽度 = max(1, 目标宽度)
        目标高度 = max(1, 目标高度)
        
        # 选择插值方法
        interpolation = HIGH_QUALITY_INTERPOLATION if is_image else MASK_INTERPOLATION
        
        # 先进行等比例缩放
        scaled_pil = self.resize_with_aspect_ratio(img_pil, 目标宽度, 目标高度, interpolation)
        
        # 如果整除数>0，进行居中裁剪到精确的倍数
        if 整除数 > 0:
            scaled_pil = self.center_crop_to_divisor(scaled_pil, 整除数)
        
        # 转换回tensor
        if is_image:
            resized_array = np.array(scaled_pil).astype(np.float32) / 255.0
            resized_tensor = torch.from_numpy(resized_array)
        else:
            resized_array = np.array(scaled_pil).astype(np.float32) / 255.0
            resized_tensor = torch.from_numpy(resized_array)
            if resized_tensor.ndim == 2:
                resized_tensor = resized_tensor.unsqueeze(-1)
        
        return resized_tensor.unsqueeze(0)
    
    def apply_divisor_with_crop(self, 宽度, 高度, 整除数, 原始比例):
        """
        使用覆盖裁剪模式处理整除数：一个方向铺满，另一个方向居中裁剪
        """
        # 计算两个可能的方案
        方案1_宽度 = (宽度 // 整除数) * 整除数
        方案1_高度 = int(方案1_宽度 / 原始比例)
        方案1_高度 = (方案1_高度 // 整除数) * 整除数
        
        方案2_高度 = (高度 // 整除数) * 整除数
        方案2_宽度 = int(方案2_高度 * 原始比例)
        方案2_宽度 = (方案2_宽度 // 整除数) * 整除数
        
        # 选择更接近原始尺寸的方案
        方案1_面积 = 方案1_宽度 * 方案1_高度
        方案2_面积 = 方案2_宽度 * 方案2_高度
        目标面积 = 宽度 * 高度
        
        if abs(方案1_面积 - 目标面积) <= abs(方案2_面积 - 目标面积):
            return 方案1_宽度, 方案1_高度
        else:
            return 方案2_宽度, 方案2_高度
    
    def resize_with_aspect_ratio(self, img_pil, 目标宽度, 目标高度, interpolation):
        """
        保持宽高比进行缩放
        """
        当前宽度, 当前高度 = img_pil.size
        当前比例 = 当前宽度 / 当前高度
        目标比例 = 目标宽度 / 目标高度
        
        if 当前比例 > 目标比例:
            # 宽度较大，先缩放高度，然后裁剪宽度
            缩放高度 = 目标高度
            缩放宽度 = int(缩放高度 * 当前比例)
        else:
            # 高度较大，先缩放宽度，然后裁剪高度
            缩放宽度 = 目标宽度
            缩放高度 = int(缩放宽度 / 当前比例)
        
        # 等比例缩放
        scaled_img = img_pil.resize((缩放宽度, 缩放高度), interpolation)
        return scaled_img
    
    def center_crop_to_divisor(self, img_pil, 整除数):
        """
        居中裁剪到整除数的倍数
        """
        当前宽度, 当前高度 = img_pil.size
        
        # 计算裁剪后的尺寸（整除数的倍数）
        裁剪宽度 = (当前宽度 // 整除数) * 整除数
        裁剪高度 = (当前高度 // 整除数) * 整除数
        
        # 确保裁剪尺寸有效
        裁剪宽度 = max(整除数, 裁剪宽度)
        裁剪高度 = max(整除数, 裁剪高度)
        
        # 计算裁剪区域（居中）
        左边 = (当前宽度 - 裁剪宽度) // 2
        上边 = (当前高度 - 裁剪高度) // 2
        右边 = 左边 + 裁剪宽度
        下边 = 上边 + 裁剪高度
        
        # 执行裁剪
        cropped_img = img_pil.crop((左边, 上边, 右边, 下边))
        return cropped_img
    
    def calculate_target_size(self, 原始宽度, 原始高度, 限制模式, 最小尺寸, 最大尺寸, 原始比例):
        """
        根据限制模式计算目标尺寸
        """
        if 限制模式 == "长边":
            长边 = max(原始宽度, 原始高度)
            if 长边 < 最小尺寸:
                缩放比例 = 最小尺寸 / 长边
            elif 长边 > 最大尺寸:
                缩放比例 = 最大尺寸 / 长边
            else:
                缩放比例 = 1.0
                
            目标宽度 = int(round(原始宽度 * 缩放比例))
            目标高度 = int(round(原始高度 * 缩放比例))
            
        elif 限制模式 == "短边":
            短边 = min(原始宽度, 原始高度)
            if 短边 < 最小尺寸:
                缩放比例 = 最小尺寸 / 短边
            elif 短边 > 最大尺寸:
                缩放比例 = 最大尺寸 / 短边
            else:
                缩放比例 = 1.0
                
            目标宽度 = int(round(原始宽度 * 缩放比例))
            目标高度 = int(round(原始高度 * 缩放比例))
            
        elif 限制模式 == "宽度":
            if 原始宽度 < 最小尺寸:
                缩放比例 = 最小尺寸 / 原始宽度
            elif 原始宽度 > 最大尺寸:
                缩放比例 = 最大尺寸 / 原始宽度
            else:
                缩放比例 = 1.0
                
            目标宽度 = int(round(原始宽度 * 缩放比例))
            目标高度 = int(round(原始高度 * 缩放比例))
            
        elif 限制模式 == "高度":
            if 原始高度 < 最小尺寸:
                缩放比例 = 最小尺寸 / 原始高度
            elif 原始高度 > 最大尺寸:
                缩放比例 = 最大尺寸 / 原始高度
            else:
                缩放比例 = 1.0
                
            目标宽度 = int(round(原始宽度 * 缩放比例))
            目标高度 = int(round(原始高度 * 缩放比例))
            
        elif 限制模式 == "宽度与高度":
            # 这个模式下需要特殊处理
            较小边 = min(原始宽度, 原始高度)
            较大边 = max(原始宽度, 原始高度)
            
            if 较小边 < 最小尺寸:
                # 较小边缩放到最小尺寸
                缩放比例 = 最小尺寸 / 较小边
                目标宽度 = int(round(原始宽度 * 缩放比例))
                目标高度 = int(round(原始高度 * 缩放比例))
                
                # 检查较大边是否超过最大尺寸
                if max(目标宽度, 目标高度) > 最大尺寸:
                    # 需要裁剪
                    pass
            elif 较大边 > 最大尺寸:
                # 尝试缩放到最大尺寸
                缩放比例 = 最大尺寸 / 较大边
                目标宽度 = int(round(原始宽度 * 缩放比例))
                目标高度 = int(round(原始高度 * 缩放比例))
                
                # 检查较小边是否小于最小尺寸
                if min(目标宽度, 目标高度) < 最小尺寸:
                    # 重新缩放，以较小边缩放到最小尺寸
                    缩放比例 = 最小尺寸 / 较小边
                    目标宽度 = int(round(原始宽度 * 缩放比例))
                    目标高度 = int(round(原始高度 * 缩放比例))
            else:
                # 尺寸已经在范围内
                目标宽度 = 原始宽度
                目标高度 = 原始高度
        else:
            # 默认不缩放
            目标宽度 = 原始宽度
            目标高度 = 原始高度
        
        return 目标宽度, 目标高度

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "图像缩放范围孤海": 图像缩放范围孤海
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "图像缩放范围孤海": "图像缩放（范围）孤海"
}