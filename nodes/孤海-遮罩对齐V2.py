import torch

class MaskAlign:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "遮罩": ("MASK",),
                "水平对齐": ("BOOLEAN", {"default": False}),
                "垂直对齐": ("BOOLEAN", {"default": False}),
                "合并BBOX": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "参考遮罩": ("MASK",),
            }
        }
    
    RETURN_TYPES = ("MASK",)
    FUNCTION = "align_mask"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "孤海-遮罩对齐"

    def align_mask(self, 遮罩, 水平对齐, 垂直对齐, 合并BBOX, 参考遮罩=None):
        # 处理单张遮罩
        if 遮罩.dim() == 3:
            遮罩 = 遮罩[0]
        H, W = 遮罩.shape
        
        # 检查参考遮罩是否有效
        ref_valid = False
        if 参考遮罩 is not None:
            if 参考遮罩.dim() == 3:
                参考遮罩 = 参考遮罩[0]
            ref_valid = torch.any(参考遮罩 > 0.01)
        
        # 情况A：无有效参考遮罩
        if not ref_valid:
            if not 水平对齐 and not 垂直对齐:
                return (遮罩.unsqueeze(0),)
            
            # 计算原遮罩的边界框
            non_zero = torch.nonzero(遮罩 > 0.01)
            if non_zero.numel() == 0:
                return (遮罩.unsqueeze(0),)
                
            y_min, x_min = non_zero.min(dim=0)[0]
            y_max, x_max = non_zero.max(dim=0)[0]
            bbox_h = y_max - y_min + 1
            bbox_w = x_max - x_min + 1
            
            # 计算目标位置 (使用安全裁剪)
            target_y = max(0, min(int((H - bbox_h) / 2), H - bbox_h)) if 垂直对齐 else y_min
            target_x = max(0, min(int((W - bbox_w) / 2), W - bbox_w)) if 水平对齐 else x_min
            
            # 创建新遮罩
            new_mask = torch.zeros((H, W))
            
            # 安全复制遮罩内容，防止越界
            src_y_start = max(0, y_min)
            src_y_end = min(y_min + bbox_h, H)
            src_x_start = max(0, x_min)
            src_x_end = min(x_min + bbox_w, W)
            
            dst_y_start = max(0, target_y)
            dst_y_end = min(target_y + bbox_h, H)
            dst_x_start = max(0, target_x)
            dst_x_end = min(target_x + bbox_w, W)
            
            # 计算实际复制尺寸
            copy_h = min(src_y_end - src_y_start, dst_y_end - dst_y_start)
            copy_w = min(src_x_end - src_x_start, dst_x_end - dst_x_start)
            
            if copy_h > 0 and copy_w > 0:
                new_mask[dst_y_start:dst_y_start+copy_h, dst_x_start:dst_x_start+copy_w] = \
                    遮罩[src_y_start:src_y_start+copy_h, src_x_start:src_x_start+copy_w]
                
            return (new_mask.unsqueeze(0),)
        
        # 情况B：有有效参考遮罩
        # 计算参考遮罩的边界框
        ref_non_zero = torch.nonzero(参考遮罩 > 0.01)
        if ref_non_zero.numel() == 0:
            return (遮罩.unsqueeze(0),)
            
        ref_y_min, ref_x_min = ref_non_zero.min(dim=0)[0]
        ref_y_max, ref_x_max = ref_non_zero.max(dim=0)[0]
        ref_center_y = int((ref_y_min + ref_y_max) / 2)
        ref_center_x = int((ref_x_min + ref_x_max) / 2)
        
        # 计算原遮罩的边界框
        non_zero = torch.nonzero(遮罩 > 0.01)
        if non_zero.numel() == 0:
            if 合并BBOX:
                # 创建参考遮罩的边界框
                merged_mask = torch.zeros((H, W))
                merged_mask[ref_y_min:ref_y_max+1, ref_x_min:ref_x_max+1] = 1
                return (merged_mask.unsqueeze(0),)
            return (遮罩.unsqueeze(0),)
            
        y_min, x_min = non_zero.min(dim=0)[0]
        y_max, x_max = non_zero.max(dim=0)[0]
        bbox_h = y_max - y_min + 1
        bbox_w = x_max - x_min + 1
        
        # 计算目标位置 (使用安全裁剪)
        target_y = ref_center_y - int(bbox_h/2) if 垂直对齐 else y_min
        target_x = ref_center_x - int(bbox_w/2) if 水平对齐 else x_min
        
        # 创建对齐后的遮罩
        aligned_mask = torch.zeros((H, W))
        
        # 安全复制遮罩内容，防止越界
        src_y_start = max(0, y_min)
        src_y_end = min(y_min + bbox_h, H)
        src_x_start = max(0, x_min)
        src_x_end = min(x_min + bbox_w, W)
        
        dst_y_start = max(0, target_y)
        dst_y_end = min(target_y + bbox_h, H)
        dst_x_start = max(0, target_x)
        dst_x_end = min(target_x + bbox_w, W)
        
        # 计算实际复制尺寸
        copy_h = min(src_y_end - src_y_start, dst_y_end - dst_y_start)
        copy_w = min(src_x_end - src_x_start, dst_x_end - dst_x_start)
        
        if copy_h > 0 and copy_w > 0:
            aligned_mask[dst_y_start:dst_y_start+copy_h, dst_x_start:dst_x_start+copy_w] = \
                遮罩[src_y_start:src_y_start+copy_h, src_x_start:src_x_start+copy_w]
        
        # 处理合并BBOX
        if 合并BBOX:
            # 计算合并后的边界框
            all_y = torch.cat([ref_non_zero[:, 0], torch.nonzero(aligned_mask > 0.01)[:, 0]]).clamp(0, H-1)
            all_x = torch.cat([ref_non_zero[:, 1], torch.nonzero(aligned_mask > 0.01)[:, 1]]).clamp(0, W-1)
            
            if all_y.numel() == 0 or all_x.numel() == 0:
                merged_mask = torch.zeros((H, W))
            else:
                min_y = all_y.min()
                max_y = all_y.max()
                min_x = all_x.min()
                max_x = all_x.max()
                
                # 创建矩形遮罩
                merged_mask = torch.zeros((H, W))
                merged_mask[min_y:max_y+1, min_x:max_x+1] = 1
            return (merged_mask.unsqueeze(0),)
        
        return (aligned_mask.unsqueeze(0),)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海-遮罩对齐": MaskAlign
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-遮罩对齐": "孤海-遮罩对齐v2"
}