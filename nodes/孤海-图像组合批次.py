import torch

class 孤海图像组合批次:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "图像1": ("IMAGE",),
                "图像2": ("IMAGE",),
                "图像3": ("IMAGE",),
                "图像4": ("IMAGE",),
                "图像5": ("IMAGE",),
            }
        }
    
    # 添加INT类型的批次总数输出
    RETURN_TYPES = ("IMAGE", "BOOLEAN", "INT")
    RETURN_NAMES = ("批次图像", "布尔", "批次总数")
    FUNCTION = "combine_images"
    CATEGORY = "孤海工具箱"

    def combine_images(self, **kwargs):
        valid_images = []
        batch_count = 0  # 初始化批次计数器
        
        # 检查所有图像输入并计数
        for i in range(1, 6):
            img = kwargs.get(f"图像{i}")
            if img is not None and img.numel() > 0:
                valid_images.append(img)
                batch_count += img.shape[0]  # 累加当前图像的批次大小
        
        # 处理空输入情况
        if not valid_images:
            black_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (black_image, 0, 0)  # 批次总数返回0
        
        # 组合所有有效图像
        combined = torch.cat(valid_images, dim=0)
        return (combined, 1, batch_count)  # 返回实际批次总数

# 注册节点
NODE_CLASS_MAPPINGS = {
    "孤海图像组合批次": 孤海图像组合批次
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海图像组合批次": "孤海-图像组合批次"
}