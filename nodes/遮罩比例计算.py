import torch

class 孤海遮罩比例计算:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": ("MASK",),
                "扩展百分比": ("FLOAT", {"default": 20, "min": 0, "max": 1000, "step": 0.1}),
                "模糊百分比": ("FLOAT", {"default": 5, "min": 0, "max": 1000, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "INT", "FLOAT")
    RETURN_NAMES = ("扩展整", "扩展浮", "模糊整", "模糊浮")
    FUNCTION = "计算"
    CATEGORY = "孤海工具箱"

    def 计算(self, mask, 扩展百分比, 模糊百分比):
        # 提取有效遮罩宽度（白色区域）
        mask_2d = mask.squeeze(0)
        binary_mask = (mask_2d >= 0.5)
        valid_columns = torch.any(binary_mask, dim=0)
        valid_indices = torch.nonzero(valid_columns)
        
        if valid_indices.numel() == 0:
            width = 0
        else:
            left = valid_indices.min().item()
            right = valid_indices.max().item()
            width = float(right - left + 1)

        # 计算双精度数值
        扩展浮点 = int(width * 扩展百分比 / 100)
        扩展整数 = int(扩展浮点)
        模糊浮点 = int(width * 模糊百分比 / 100)
        模糊整数 = int(模糊浮点)

        return (扩展整数, 扩展浮点, 模糊整数, 模糊浮点)

NODE_CLASS_MAPPINGS = {
    "孤海遮罩比例计算": 孤海遮罩比例计算
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海遮罩比例计算": "孤海遮罩比例计算"
}