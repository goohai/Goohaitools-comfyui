import torch
import numpy as np
import cv2
from typing import List, Tuple
from types import SimpleNamespace
import sys

class 孤海Seg次序过滤:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "优先规则": ([
                    "面积大小",
                    "宽度大小", 
                    "高度大小",
                    "左右上下",
                    "左右下上"
                ],),
                "正反顺序": (["正序", "反序"],),
                "开始索引": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": sys.maxsize,
                    "step": 1
                }),
                "过滤数量": ("INT", {
                    "default": 1,
                    "min": 0,
                    "max": sys.maxsize,
                    "step": 1
                }),
                "分组阈值": ("INT", {
                    "default": 50,
                    "min": 1,
                    "max": 500,
                    "step": 1,
                    "display": "分组阈值(X坐标接近程度)"
                }),
            },
            "optional": {
                "Seg": ("SEGS",),
                "masks": ("MASK", {"tooltip": "按每张遮罩的最大连通区域排序，输出保留完整遮罩；同时连接 Seg 时以 Seg 为准。"}),
                "合并遮罩": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "开启时合并筛选后的 Mask，关闭时输出遮罩组；Seg 输出始终保留独立分段。"
                }),
            },
        }
    
    RETURN_TYPES = ("SEGS", "MASK")
    RETURN_NAMES = ("Seg", "Mask")
    FUNCTION = "filter_segments"
    CATEGORY = "孤海工具箱"
    
    def get_segment_area(self, seg) -> float:
        """计算分割区域的面积"""
        if hasattr(seg, 'sort_area'):
            return seg.sort_area
        if hasattr(seg, 'cropped_mask') and seg.cropped_mask is not None:
            mask = seg.cropped_mask
            if isinstance(mask, torch.Tensor):
                if mask.dim() == 3:
                    mask = mask[0]  # 保持旧版 Seg 面积排序规则
                return float(torch.sum(mask > 0.1).item())
            elif isinstance(mask, np.ndarray):
                return float(np.sum(mask > 0.1))
        return 0.0
    
    def get_segment_bbox(self, seg) -> tuple:
        """获取分割区域的边界框信息"""
        if hasattr(seg, 'bbox'):
            bbox = seg.bbox
            if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                return bbox
        return (0, 0, 0, 0)
    
    def get_segment_mask(self, seg) -> torch.Tensor:
        """获取分割区域的掩码"""
        if hasattr(seg, 'cropped_mask') and seg.cropped_mask is not None:
            mask = seg.cropped_mask
            if isinstance(mask, torch.Tensor):
                return mask
            elif isinstance(mask, np.ndarray):
                return torch.from_numpy(mask)
        
        # 返回一个默认的空掩码
        return torch.zeros((1, 512, 512), dtype=torch.float32)
    
    def get_segment_feature(self, seg, feature_type: str) -> float:
        """根据特征类型获取分割区域的特征值"""
        bbox = self.get_segment_bbox(seg)
        if not bbox or len(bbox) < 4:
            return 0.0
        
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        height = y2 - y1
        
        if feature_type == "面积大小":
            return self.get_segment_area(seg)
        elif feature_type == "宽度大小":
            return float(width)
        elif feature_type == "高度大小":
            return float(height)
        elif feature_type == "左右上下":
            # 使用x1和y1的组合值，确保先按x1排序，再按y1排序
            return float(x1) * 10000 + float(y1)
        elif feature_type == "左右下上":
            # 使用x1和y2的组合值，确保先按x1排序，再按y2排序（y2是下边界）
            return float(x1) * 10000 + float(y2)
        
        return 0.0
    
    def group_segments_by_x(self, segs_list: List, threshold: int) -> List[List]:
        """根据X1坐标将分割区域分组"""
        if not segs_list:
            return []
        
        # 先按X1坐标排序
        sorted_by_x = sorted(segs_list, key=lambda seg: self.get_segment_bbox(seg)[0])
        
        groups = []
        current_group = []
        current_x = None
        
        for seg in sorted_by_x:
            x1, y1, x2, y2 = self.get_segment_bbox(seg)
            
            if current_x is None:
                # 第一个元素
                current_group.append(seg)
                current_x = x1
            elif abs(x1 - current_x) <= threshold:
                # X坐标接近，加入当前组
                current_group.append(seg)
            else:
                # X坐标差距较大，开始新组
                if current_group:
                    groups.append(current_group)
                current_group = [seg]
                current_x = x1
        
        # 添加最后一组
        if current_group:
            groups.append(current_group)
        
        return groups
    
    def sort_groups_left_right_top_bottom(self, groups: List[List], reverse_order: bool) -> List:
        """左右上下排序：组从左到右，组内从上到下"""
        # 按组的平均X坐标从左到右排序
        groups_sorted = sorted(groups, key=lambda group: np.mean([self.get_segment_bbox(seg)[0] for seg in group]))
        
        result = []
        for group in groups_sorted:
            # 组内按Y1坐标从上到下排序（Y1小的在上）
            group_sorted = sorted(group, key=lambda seg: self.get_segment_bbox(seg)[1])
            result.extend(group_sorted)
        
        if reverse_order:
            result = list(reversed(result))
        
        return result
    
    def sort_groups_left_right_bottom_top(self, groups: List[List], reverse_order: bool) -> List:
        """左右下上排序：组从左到右，组内从下到上"""
        # 按组的平均X坐标从左到右排序
        groups_sorted = sorted(groups, key=lambda group: np.mean([self.get_segment_bbox(seg)[0] for seg in group]))
        
        result = []
        for group in groups_sorted:
            # 组内按Y2坐标从下到上排序（Y2大的在下）
            group_sorted = sorted(group, key=lambda seg: self.get_segment_bbox(seg)[3], reverse=True)
            result.extend(group_sorted)
        
        if reverse_order:
            result = list(reversed(result))
        
        return result
    
    @staticmethod
    def mask_batch(mask) -> torch.Tensor:
        if isinstance(mask, np.ndarray):
            mask = torch.from_numpy(mask)
        if mask.dim() == 2:
            mask = mask.unsqueeze(0)
        elif mask.dim() == 4:
            if mask.shape[1] == 1:
                mask = mask.squeeze(1)
            elif mask.shape[0] == 1:
                mask = mask.squeeze(0)
        if mask.dim() != 3:
            raise ValueError("遮罩应为 [H, W] 或 [B, H, W] 格式")
        return mask

    def create_full_mask(self, shape, segs, crop_regions, merge=True) -> torch.Tensor:
        h, w = shape
        full_mask = torch.zeros((h, w), dtype=torch.float32)
        mask_batches = []
        for seg, crop_region in zip(segs, crop_regions):
            mask = self.mask_batch(self.get_segment_mask(seg)).to(device='cpu', dtype=torch.float32)
            x1, y1, x2, y2 = crop_region
            crop_h, crop_w = y2 - y1, x2 - x1
            if mask.shape[-2:] != (crop_h, crop_w):
                mask = torch.nn.functional.interpolate(
                    mask.unsqueeze(1), size=(crop_h, crop_w),
                    mode='bilinear', align_corners=False
                ).squeeze(1)
            if merge:
                if y1 >= 0 and y2 <= h and x1 >= 0 and x2 <= w:
                    full_mask[y1:y2, x1:x2] = torch.maximum(
                        full_mask[y1:y2, x1:x2], mask.amax(dim=0)
                    )
            else:
                batch = torch.zeros((mask.shape[0], h, w), dtype=torch.float32)
                if y1 >= 0 and y2 <= h and x1 >= 0 and x2 <= w:
                    batch[:, y1:y2, x1:x2] = mask
                mask_batches.append(batch)
        if merge:
            # 保留旧工作流的二维合并 Mask 输出。
            return full_mask
        return torch.cat(mask_batches, dim=0) if mask_batches else full_mask.unsqueeze(0)

    def sort_segments(self, segs_list, 优先规则, 正反顺序, 分组阈值):
        # 对分割区域进行排序
        reverse_sort = (正反顺序 == "正序")
        
        if 优先规则 == "面积大小":
            # 按面积排序，正序时从大到小
            sorted_segs = sorted(segs_list, key=lambda seg: self.get_segment_feature(seg, "面积大小"), reverse=reverse_sort)
        
        elif 优先规则 == "宽度大小":
            # 按宽度排序，正序时从大到小
            sorted_segs = sorted(segs_list, key=lambda seg: self.get_segment_feature(seg, "宽度大小"), reverse=reverse_sort)
        
        elif 优先规则 == "高度大小":
            # 按高度排序，正序时从大到小
            sorted_segs = sorted(segs_list, key=lambda seg: self.get_segment_feature(seg, "高度大小"), reverse=reverse_sort)
        
        elif 优先规则 == "左右上下":
            # 新的分组排序逻辑
            groups = self.group_segments_by_x(segs_list, 分组阈值)
            sorted_segs = self.sort_groups_left_right_top_bottom(groups, not reverse_sort)
            # 注意：这里not reverse_sort是因为我们的分组排序函数内部已经处理了反序逻辑
        
        elif 优先规则 == "左右下上":
            # 新的分组排序逻辑
            groups = self.group_segments_by_x(segs_list, 分组阈值)
            sorted_segs = self.sort_groups_left_right_bottom_top(groups, not reverse_sort)
            # 注意：这里not reverse_sort是因为我们的分组排序函数内部已经处理了反序逻辑
        
        else:
            # 默认不排序
            sorted_segs = segs_list
        
        return sorted_segs

    @staticmethod
    def select_segments(sorted_segs, start, count):
        if not sorted_segs:
            return []
        if count == 0:
            return sorted_segs[start:]
        return [sorted_segs[(start + i) % len(sorted_segs)]
                for i in range(min(count, len(sorted_segs)))]

    def filter_masks(self, masks, 优先规则, 正反顺序, 开始索引, 过滤数量, 分组阈值, 合并遮罩):
        batch = self.mask_batch(masks)
        h, w = batch.shape[-2:]
        empty_segs = ((h, w), [])
        # 单张遮罩原样输出，不受索引、过滤数量和合并开关影响。
        if batch.shape[0] == 1:
            return (empty_segs, masks)

        segments = []
        for mask in batch:
            active = (mask > 0.1).to(device='cpu', dtype=torch.uint8).numpy()
            count, _, stats, _ = cv2.connectedComponentsWithStats(active, connectivity=8)
            bbox, area = (0, 0, 0, 0), 0
            if count > 1:
                component = stats[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])]
                x, y, width, height, area = map(int, component)
                bbox = (x, y, x + width, y + height)
            # 只用最大连通区域计算排序特征，输出仍保留原始完整遮罩。
            segments.append(SimpleNamespace(cropped_mask=mask, bbox=bbox, sort_area=area))
        sorted_segs = self.sort_segments(segments, 优先规则, 正反顺序, 分组阈值)
        selected = self.select_segments(sorted_segs, 开始索引, 过滤数量)
        if not selected:
            return (empty_segs, batch.new_zeros((1, h, w)))
        result = torch.stack([seg.cropped_mask for seg in selected])
        if 合并遮罩:
            result = result.amax(dim=0, keepdim=True)
        return (empty_segs, result)

    def filter_segments(self, Seg=None, 优先规则: str = "面积大小", 正反顺序: str = "正序",
                        开始索引: int = 0, 过滤数量: int = 1, 分组阈值: int = 50,
                        masks=None, 合并遮罩: bool = True) -> Tuple[tuple, torch.Tensor]:
        if Seg is None and masks is not None:
            return self.filter_masks(masks, 优先规则, 正反顺序, 开始索引, 过滤数量, 分组阈值, 合并遮罩)

        if isinstance(Seg, tuple) and len(Seg) == 2:
            image_shape, segs_list = Seg
        else:
            image_shape = (0, 0)
            segs_list = Seg if isinstance(Seg, list) else []
        if not segs_list:
            h, w = image_shape if image_shape != (0, 0) else (512, 512)
            empty_mask = torch.zeros((h, w), dtype=torch.float32)
            return ((image_shape, []), empty_mask if 合并遮罩 else empty_mask.unsqueeze(0))

        sorted_segs = self.sort_segments(segs_list, 优先规则, 正反顺序, 分组阈值)
        selected_segs = self.select_segments(sorted_segs, 开始索引, 过滤数量)
        crop_regions = [seg.crop_region for seg in selected_segs]
        mask = self.create_full_mask(image_shape, selected_segs, crop_regions, 合并遮罩)
        return ((image_shape, selected_segs), mask)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "孤海Seg次序过滤": 孤海Seg次序过滤
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海Seg次序过滤": "孤海-Seg次序过滤"
}
