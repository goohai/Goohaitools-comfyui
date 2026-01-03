import torch
import torch.nn.functional as F

class GhostSeaSkinColorDifference:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像1": ("IMAGE",),
                "图像2": ("IMAGE",),
                "颜色阈值": ("INT", {
                    "default": 150,
                    "min": 1,
                    "max": 255,
                    "step": 1,
                    "display": "slider"
                }),
            },
            "optional": {
                "遮罩1": ("MASK",),
                "遮罩2": ("MASK",),
            }
        }
    
    RETURN_TYPES = ("FLOAT", "BOOLEAN",)
    RETURN_NAMES = ("颜色差值", "S布尔值",)
    FUNCTION = "calculate_difference"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "比较两张图像的颜色差异，输出饱和度布尔开关"

    def calculate_difference(self, 图像1, 图像2, 颜色阈值, 遮罩1=None, 遮罩2=None):
        # 确保图像在CPU上处理
        图像1 = 图像1.cpu().float()
        图像2 = 图像2.cpu().float()
        
        # 处理遮罩
        遮罩1 = self.prepare_mask(遮罩1, 图像1.shape)
        遮罩2 = self.prepare_mask(遮罩2, 图像2.shape)
        
        # 计算平均颜色和饱和度
        颜色1, 饱和度1 = self.calculate_avg_color_and_saturation(图像1, 遮罩1)
        颜色2, 饱和度2 = self.calculate_avg_color_and_saturation(图像2, 遮罩2)
        
        # 检查饱和度条件
        s_boolean = self.check_saturation_condition(饱和度1, 饱和度2)
        
        # 如果满足饱和度条件，颜色差值直接设为1.0
        if s_boolean:
            颜色差值 = 1.0
        else:
            # 否则计算颜色差异
            颜色差异 = torch.sqrt(torch.sum((颜色1 - 颜色2) ** 2)).item()
            
            # 基于阈值归一化到0-1范围
            颜色差值 = min(颜色差异 / 颜色阈值, 1.0)
        
        # 返回布尔值而非浮点数
        return (颜色差值, s_boolean,)
    
    def check_saturation_condition(self, 饱和度1, 饱和度2):
        """检查饱和度特殊条件：一张图饱和度<5%且另一张>15%时返回True"""
        # 转换为百分比值
        饱和度1 *= 100
        饱和度2 *= 100
        
        # 条件1: 图像1饱和度低且图像2饱和度高
        cond1 = 饱和度1 < 5 and 饱和度2 > 15
        
        # 条件2: 图像2饱和度低且图像1饱和度高
        cond2 = 饱和度2 < 5 and 饱和度1 > 15
        
        return cond1 or cond2

    def prepare_mask(self, 遮罩, 图像形状):
        """将遮罩处理为与图像尺寸匹配的二值掩码"""
        if 遮罩 is None:
            return torch.ones((图像形状[1], 图像形状[2]))
        
        遮罩 = 遮罩.cpu().float()
        
        # 处理多通道遮罩
        if 遮罩.dim() == 3 and 遮罩.size(0) > 1:
            遮罩 = 遮罩.mean(dim=0, keepdim=True)
        
        # 调整大小
        遮罩 = F.interpolate(
            遮罩.unsqueeze(0), 
            size=图像形状[1:3], 
            mode="bilinear",
            align_corners=False
        )
        
        # 转为二值掩码（大于0.5视为有效区域）
        return (遮罩[0, 0] > 0.5).float()

    def calculate_avg_color_and_saturation(self, 图像, 遮罩):
        """计算在遮罩区域的平均RGB颜色和平均饱和度"""
        # 确保图像维度正确 [batch, height, width, channels]
        if 图像.dim() == 4:
            # 只取第一个批次
            图像 = 图像[0]
        
        # 应用遮罩
        遮罩区域 = 遮罩.unsqueeze(-1)  # 增加通道维度以匹配图像
        有效像素 = torch.sum(遮罩)
        
        if 有效像素 == 0:
            return torch.tensor([0.0, 0.0, 0.0]), 0.0
        
        # 计算平均RGB值
        平均颜色 = torch.sum(图像 * 遮罩区域, dim=(0, 1)) / 有效像素
        
        # 计算平均饱和度
        # 公式：饱和度 = (max(R,G,B) - min(R,G,B)) / max(R,G,B) [避免除以零问题]
        rgb_min = torch.min(图像, dim=2)[0]
        rgb_max = torch.max(图像, dim=2)[0]
        
        # 处理零分母情况
        valid_max = torch.maximum(rgb_max, torch.tensor(1e-6))
        饱和度 = (rgb_max - rgb_min) / valid_max
        
        # 计算整个遮罩区域的平均饱和度
        平均饱和度 = torch.sum(饱和度 * 遮罩) / 有效像素
        
        # 返回0-255范围的RGB颜色和0-1范围的饱和度
        return 平均颜色 * 255.0, 平均饱和度.item()

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海-肤色差值": GhostSeaSkinColorDifference
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-肤色差值": "孤海-肤色差值"
}