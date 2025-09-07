import numpy as np
import torch
import comfy.utils

class MaskBlendOperation:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "混合模式": (["相加", "相减", "相交", "排除", "水平取左", "水平取右", "垂直取上", "垂直取下"],),
                "BBOX": (["关闭", "原始比例", "1：1长边不变", "1：1短边不变", "1：1宽度不变", "1：1高度不变"],),
                "对齐方式": (["左对齐", "右对齐", "居中", "上对齐", "下对齐"],),
            },
            "optional": {
                "遮罩1": ("MASK",),
                "遮罩2": ("MASK",),
            }
        }
    
    RETURN_TYPES = ("MASK", "INT", "INT")
    RETURN_NAMES = ("遮罩", "遮罩宽", "遮罩高")
    FUNCTION = "execute"
    CATEGORY = "孤海工具箱"

    def execute(self, 混合模式, BBOX, 对齐方式, 遮罩1=None, 遮罩2=None):
        # 处理空遮罩情况
        if 遮罩1 is None and 遮罩2 is None:
            return (torch.zeros((1, 1024, 1024)), 0, 0)
        
        # 确保两个遮罩都存在且尺寸相同
        if 遮罩1 is None and 遮罩2 is not None:
            遮罩1 = torch.zeros_like(遮罩2)
        elif 遮罩2 is None and 遮罩1 is not None:
            遮罩2 = torch.zeros_like(遮罩1)
        elif 遮罩1.shape[1:] != 遮罩2.shape[1:]:
            raise ValueError("两个遮罩尺寸必须相同")
        
        h, w = 遮罩1.shape[1], 遮罩1.shape[2]
        result_mask = None
        
        # 混合模式处理
        if 混合模式 == "相加":
            result_mask = torch.clamp(遮罩1 + 遮罩2, 0, 1)
        
        elif 混合模式 == "相减":
            if torch.all(遮罩1 == 0):
                return (torch.zeros((1, h, w)), 0, 0)
            result_mask = torch.clamp(遮罩1 - torch.minimum(遮罩1, 遮罩2), 0, 1)
        
        elif 混合模式 == "相交":
            result_mask = torch.minimum(遮罩1, 遮罩2)
            if torch.all(result_mask == 0):
                return (torch.zeros((1, h, w)), 0, 0)
        
        elif 混合模式 == "排除":
            combined = torch.clamp(遮罩1 + 遮罩2, 0, 1)
            result_mask = 1 - combined
            if torch.all(result_mask == 0):
                return (torch.zeros((1, h, w)), 0, 0)
        
        elif 混合模式.startswith("水平"):
            # 获取非零区域边界
            def get_mask_range(mask):
                if torch.all(mask == 0):
                    return None
                non_zero = torch.nonzero(mask[0])
                if non_zero.numel() == 0:
                    return None
                return non_zero[:, 1].min().item(), non_zero[:, 1].max().item()
            
            range1 = get_mask_range(遮罩1)
            range2 = get_mask_range(遮罩2)
            
            if range1 is None and range2 is None:
                return (torch.zeros((1, h, w)), 0, 0)
            elif range1 is None:
                result_mask = 遮罩2
            elif range2 is None:
                result_mask = 遮罩1
            else:
                x1_min, x1_max = range1
                x2_min, x2_max = range2
                
                # 使用两个遮罩中最小的x_max作为截断点
                cut_x = min(x1_max, x2_max)
                
                if 混合模式 == "水平取左":
                    # 取左边部分
                    result_mask = torch.zeros_like(遮罩1)
                    result_mask[:, :, :cut_x+1] = 遮罩1[:, :, :cut_x+1]
                else:  # 水平取右
                    # 取右边部分
                    result_mask = torch.zeros_like(遮罩1)
                    result_mask[:, :, cut_x:] = 遮罩1[:, :, cut_x:]
        
        elif 混合模式.startswith("垂直"):
            # 获取非零区域边界
            def get_mask_range(mask):
                if torch.all(mask == 0):
                    return None
                non_zero = torch.nonzero(mask[0])
                if non_zero.numel() == 0:
                    return None
                return non_zero[:, 0].min().item(), non_zero[:, 0].max().item()
            
            range1 = get_mask_range(遮罩1)
            range2 = get_mask_range(遮罩2)
            
            if range1 is None and range2 is None:
                return (torch.zeros((1, h, w)), 0, 0)
            elif range1 is None:
                result_mask = 遮罩2
            elif range2 is None:
                result_mask = 遮罩1
            else:
                y1_min, y1_max = range1
                y2_min, y2_max = range2
                
                # 使用两个遮罩中最小的y_max作为截断点
                cut_y = min(y1_max, y2_max)
                
                if 混合模式 == "垂直取上":
                    # 取上边部分
                    result_mask = torch.zeros_like(遮罩1)
                    result_mask[:, :cut_y+1, :] = 遮罩1[:, :cut_y+1, :]
                else:  # 垂直取下
                    # 取下边部分
                    result_mask = torch.zeros_like(遮罩1)
                    result_mask[:, cut_y:, :] = 遮罩1[:, cut_y:, :]
        
        # 如果没有进行混合操作（如相减模式中遮罩1为空），则使用遮罩1
        if result_mask is None:
            result_mask = 遮罩1
        
        # 计算有效区域宽高（非零区域的最小外接矩形）
        def get_mask_bbox(mask):
            if torch.all(mask == 0):
                return 0, 0, 0, 0
            non_zero = torch.nonzero(mask[0])
            y_min, x_min = non_zero.min(dim=0)[0]
            y_max, x_max = non_zero.max(dim=0)[0]
            return x_min.item(), y_min.item(), x_max.item(), y_max.item()
        
        x_min, y_min, x_max, y_max = get_mask_bbox(result_mask)
        rect_w = max(0, x_max - x_min + 1)
        rect_h = max(0, y_max - y_min + 1)
        
        # 如果遮罩全黑，直接返回
        if rect_w == 0 or rect_h == 0:
            return (result_mask, 0, 0)
        
        # 初始化输出尺寸
        mask_width = rect_w
        mask_height = rect_h
        
        # BBOX处理
        if BBOX != "关闭":
            # 计算正方形边长
            if BBOX == "原始比例":
                new_w, new_h = rect_w, rect_h
            elif BBOX == "1：1长边不变":
                side = max(rect_w, rect_h)
                new_w, new_h = side, side
            elif BBOX == "1：1短边不变":
                side = min(rect_w, rect_h)
                new_w, new_h = side, side
            elif BBOX == "1：1宽度不变":
                new_w, new_h = rect_w, rect_w
            else:  # 1：1高度不变
                new_w, new_h = rect_h, rect_h
            
            # 更新输出尺寸
            mask_width = new_w
            mask_height = new_h
            
            # 计算新边界框位置（仅当BBOX不是原始比例且需要调整形状时才使用对齐方式）
            if BBOX != "原始比例":
                if 对齐方式 == "左对齐":
                    new_x = x_min
                    new_y = y_min + (rect_h - new_h) // 2
                elif 对齐方式 == "右对齐":
                    new_x = x_min + (rect_w - new_w)
                    new_y = y_min + (rect_h - new_h) // 2
                elif 对齐方式 == "上对齐":
                    new_x = x_min + (rect_w - new_w) // 2
                    new_y = y_min
                elif 对齐方式 == "下对齐":
                    new_x = x_min + (rect_w - new_w) // 2
                    new_y = y_min + (rect_h - new_h)
                else:  # 居中
                    new_x = x_min + (rect_w - new_w) // 2
                    new_y = y_min + (rect_h - new_h) // 2
            else:
                # 原始比例不需要调整位置
                new_x = x_min
                new_y = y_min
            
            # 创建新遮罩 - 创建一个完整的矩形/正方形遮罩
            new_mask = torch.zeros((1, h, w))
            
            # 计算实际绘制的区域（防止超出边界）
            start_x = max(0, new_x)
            start_y = max(0, new_y)
            end_x = min(w, new_x + new_w)
            end_y = min(h, new_y + new_h)
            
            # 绘制矩形区域（整个区域设置为1）
            if start_x < end_x and start_y < end_y:
                new_mask[:, start_y:end_y, start_x:end_x] = 1
            
            result_mask = new_mask
        
        return (result_mask, mask_width, mask_height)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海-遮罩混合运算": MaskBlendOperation
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-遮罩混合运算": "孤海-遮罩混合运算"
}