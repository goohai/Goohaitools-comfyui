import torch
import torch.nn.functional as F

class GuHaiMaskCrop:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "top_extend": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 1}),
                "bottom_extend": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 1}),
                "left_extend": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 1}),
                "right_extend": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN")
    RETURN_NAMES = ("cropped_image", "boundary_mask", "is_out_of_bounds")
    FUNCTION = "process"
    CATEGORY = "孤海工具箱"

    def process(self, image, mask, top_extend, bottom_extend, left_extend, right_extend):
        # 确保输入为单张图像且尺寸匹配
        assert image.shape[0] == 1, "仅支持单张图像输入"
        B, H, W, C = image.shape
        mask = mask.squeeze()  # 移除批次和通道维度
        assert mask.shape == (H, W), "图像与遮罩尺寸不一致"

        # 寻找遮罩有效区域
        nonzero = torch.nonzero(mask)
        if nonzero.size(0) == 0:
            raise ValueError("遮罩无有效区域")
        
        min_y = nonzero[:, 0].min().item()
        max_y = nonzero[:, 0].max().item() + 1  # 切片操作需+1
        min_x = nonzero[:, 1].min().item()
        max_x = nonzero[:, 1].max().item() + 1

        # 计算扩展后坐标
        new_min_y = min_y - top_extend
        new_max_y = max_y + bottom_extend
        new_min_x = min_x - left_extend
        new_max_x = max_x + right_extend

        # 计算边界溢出量
        pad_top = max(0, -new_min_y)
        pad_bottom = max(0, new_max_y - H)
        pad_left = max(0, -new_min_x)
        pad_right = max(0, new_max_x - W)
        is_out_of_bounds = (pad_top + pad_bottom + pad_left + pad_right) > 0

        # 计算实际裁剪区域
        crop_y_start = max(0, new_min_y)
        crop_y_end = min(H, new_max_y)
        crop_x_start = max(0, new_min_x)
        crop_x_end = min(W, new_max_x)

        # 执行裁剪
        cropped = image[:, crop_y_start:crop_y_end, crop_x_start:crop_x_end, :]
        single_image = cropped[0]  # 移除批次维度

        # 三维填充 (H,W,C) 按维度顺序(W_pad, H_pad, C_pad)
        padded_image = F.pad(
            single_image,
            (0, 0,  # 通道维度不填充
             pad_left, pad_right,  # 宽度方向填充
             pad_top, pad_bottom), # 高度方向填充
            mode='constant',
            value=0.5  # 灰色填充值
        ).unsqueeze(0)  # 恢复批次维度

        # 生成边界遮罩
        target_h = new_max_y - new_min_y
        target_w = new_max_x - new_min_x
        boundary_mask = torch.zeros((target_h, target_w), dtype=torch.float32)
        
        if is_out_of_bounds:
            # 四边填充区域标记
            if pad_top > 0:
                boundary_mask[:pad_top, :] = 1.0
            if pad_bottom > 0:
                boundary_mask[-pad_bottom:, :] = 1.0
            if pad_left > 0:
                boundary_mask[:, :pad_left] = 1.0
            if pad_right > 0:
                boundary_mask[:, -pad_right:] = 1.0

        return (padded_image, boundary_mask.unsqueeze(0), int(is_out_of_bounds))

NODE_CLASS_MAPPINGS = {
    "GuHaiMaskCrop": GuHaiMaskCrop
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHaiMaskCrop": "孤海遮罩裁剪"
}
