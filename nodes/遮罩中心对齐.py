import torch
import numpy as np
import comfy

class AlignMaskCenter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "主体遮罩": ("MASK",),
                "参考遮罩": ("MASK",),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("对齐遮罩",)
    FUNCTION = "align"
    CATEGORY = "孤海工具箱"

    def align(self, 主体遮罩, 参考遮罩):
        # 有效性检查
        if 主体遮罩.shape != 参考遮罩.shape:
            return (主体遮罩,)
        
        # 转换为numpy数组
        ref_mask = 参考遮罩.cpu().numpy()[0]
        sub_mask = 主体遮罩.cpu().numpy()[0]
        
        # 检查全黑情况
        if np.max(ref_mask) == 0 or np.max(sub_mask) == 0:
            return (主体遮罩,)

        # 获取参考遮罩水平中心
        ref_cols = np.where(ref_mask > 0)[1]
        if len(ref_cols) == 0:
            return (主体遮罩,)
        target_center = (np.min(ref_cols) + np.max(ref_cols)) // 2

        # 获取主体遮罩原始区域
        sub_rows = np.where(sub_mask > 0)[0]
        sub_cols = np.where(sub_mask > 0)[1]
        if len(sub_cols) == 0:
            return (主体遮罩,)
        
        y1, y2 = np.min(sub_rows), np.max(sub_rows)
        orig_x1, orig_x2 = np.min(sub_cols), np.max(sub_cols)
        orig_width = orig_x2 - orig_x1
        w = sub_mask.shape[1]

        # 计算需要移动的偏移量
        current_center = (orig_x1 + orig_x2) // 2
        delta = target_center - current_center

        # 误差容限判断
        if abs(delta) < orig_width * 0.05:
            return (主体遮罩,)

        # 新边界计算（核心修正逻辑）
        new_x1 = orig_x1 + delta
        new_x2 = orig_x2 + delta
        
        # 左边越界处理
        if new_x1 < 0:
            overflow = -new_x1
            new_x1 = 0
            new_x2 = orig_x2 + delta - overflow  # 右边向左收缩
            if new_x2 < 0:  # 双重保护
                new_x2 = 0

        # 右边越界处理
        if new_x2 >= w:
            overflow = new_x2 - (w-1)
            new_x2 = w-1
            new_x1 = orig_x1 + delta + overflow  # 左边向右收缩
            if new_x1 >= w:  # 双重保护
                new_x1 = w-1

        # 最终边界约束
        final_x1 = max(0, int(new_x1))
        final_x2 = min(w-1, int(new_x2))
        
        # 重建遮罩（保持垂直范围）
        aligned_mask = np.zeros_like(sub_mask)
        if final_x1 <= final_x2:  # 有效区域检查
            aligned_mask[y1:y2+1, final_x1:final_x2+1] = 1

        return (torch.from_numpy(aligned_mask).unsqueeze(0).to(主体遮罩.device),)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "AlignMaskCenter_孤海": AlignMaskCenter
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AlignMaskCenter_孤海": "孤海-遮罩中心对齐"
}