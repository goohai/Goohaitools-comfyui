import torch

class MaskTopExpansion:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": ("MASK",),
                "X": ("INT", {"default": 50, "min": 0, "max": 4096, "step": 1}),
                "Y": ("INT", {"default": 100, "min": 0, "max": 4096, "step": 1}),
            }
        }

    CATEGORY = "孤海工具箱"
    FUNCTION = "expand_mask"
    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("new_mask",)

    def expand_mask(self, mask, X, Y):
        # 转换mask为二维张量
        orig_mask = mask.squeeze(0)  # (H, W)
        height, width = orig_mask.shape
        
        # 找到所有有效像素坐标
        y_coords, x_coords = torch.where(orig_mask >= 0.5)
        
        if len(y_coords) == 0:
            return (torch.zeros_like(mask),)
        
        # 找到最高点（最小y坐标）
        y_min = torch.min(y_coords)
        top_points = x_coords[y_coords == y_min]
        
        # 计算中心x坐标（取平均值并四舍五入）
        x_center = torch.round(top_points.float().mean()).long().item()
        y_top = y_min.item()

        # 计算扩展区域边界
        x_start = max(0, x_center - X)
        x_end = min(width, x_center + X)
        y_start = y_top
        y_end = min(height, y_top + Y)

        # 创建新遮罩
        new_mask = torch.zeros_like(orig_mask)
        if x_end > x_start and y_end > y_start:
            new_mask[y_start:y_end, x_start:x_end] = 1.0

        return (new_mask.unsqueeze(0),)

NODE_CLASS_MAPPINGS = {"MaskTopExpansion": MaskTopExpansion}
NODE_DISPLAY_NAME_MAPPINGS = {"MaskTopExpansion": "孤海头顶遮罩"}