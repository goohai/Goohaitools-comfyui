import torch
import numpy as np
from typing import List, Tuple, Dict
import sys

class 孤海Seg次序过滤:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "Seg": ("SEGS",),
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
            }
        }
    
    RETURN_TYPES = ("SEGS", "MASK")
    RETURN_NAMES = ("Seg", "Mask")
    FUNCTION = "filter_segments"
    CATEGORY = "孤海工具箱"
    
    def get_segment_area(self, seg) -> float:
        """计算分割区域的面积"""
        if hasattr(seg, 'cropped_mask') and seg.cropped_mask is not None:
            mask = seg.cropped_mask
            if isinstance(mask, torch.Tensor):
                if mask.dim() == 3:
                    mask = mask[0]  # 如果是3D，取第一个通道
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
    
    def create_full_mask(self, shape, segs, crop_regions) -> torch.Tensor:
        """创建完整的全图mask，将各个seg的mask放置到正确位置"""
        h, w = shape
        full_mask = torch.zeros((h, w), dtype=torch.float32)
        
        for i, seg in enumerate(segs):
            crop_region = crop_regions[i]
            mask = self.get_segment_mask(seg)
            
            # 确保mask是2D
            if mask.dim() == 3:
                mask = mask[0] if mask.shape[0] == 1 else mask
            if mask.dim() == 3:
                mask = mask.squeeze(0)
            
            # 获取crop区域坐标
            x1, y1, x2, y2 = crop_region
            
            # 调整mask尺寸以匹配crop区域
            crop_h, crop_w = y2 - y1, x2 - x1
            if mask.shape != (crop_h, crop_w):
                mask = torch.nn.functional.interpolate(
                    mask.unsqueeze(0).unsqueeze(0),
                    size=(crop_h, crop_w),
                    mode='bilinear',
                    align_corners=False
                ).squeeze(0).squeeze(0)
            
            # 将mask放置到正确位置
            if y1 >= 0 and y2 <= h and x1 >= 0 and x2 <= w:
                full_mask[y1:y2, x1:x2] = torch.maximum(full_mask[y1:y2, x1:x2], mask)
        
        return full_mask
    
    def filter_segments(self, Seg, 优先规则: str, 正反顺序: str, 开始索引: int, 过滤数量: int, 分组阈值: int) -> Tuple[tuple, torch.Tensor]:
        # 解包SEGS数据结构
        # SEGS是一个元组：(image_shape, segs_list)
        if isinstance(Seg, tuple) and len(Seg) == 2:
            image_shape, segs_list = Seg
        else:
            # 如果不是预期的格式，则使用默认值
            image_shape = (0, 0)
            segs_list = []
            if isinstance(Seg, list):
                segs_list = Seg
        
        if not segs_list:
            # 没有分割区域，返回空的SEGS和全黑mask
            h, w = image_shape if image_shape != (0, 0) else (512, 512)
            empty_mask = torch.zeros((h, w), dtype=torch.float32)
            empty_segs = (image_shape, [])
            return (empty_segs, empty_mask)
        
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
        
        num_segments = len(sorted_segs)
        
        # 处理过滤数量为0的情况
        if 过滤数量 == 0:
            # 返回空的SEGS和全黑mask
            h, w = image_shape
            empty_mask = torch.zeros((h, w), dtype=torch.float32)
            empty_segs = (image_shape, [])
            return (empty_segs, empty_mask)
        
        # 限制过滤数量不超过实际分割数量
        过滤数量 = min(过滤数量, num_segments)
        
        # 计算实际要获取的分割区域索引
        selected_indices = []
        for i in range(过滤数量):
            idx = (开始索引 + i) % num_segments
            selected_indices.append(idx)
        
        # 获取选中的分割区域
        selected_segs = [sorted_segs[idx] for idx in selected_indices]
        
        # 创建新的SEGS
        new_segs = (image_shape, selected_segs)
        
        # 创建完整的mask
        h, w = image_shape
        if 过滤数量 == 1:
            # 单个seg，直接创建mask
            seg = selected_segs[0]
            mask = self.get_segment_mask(seg)
            crop_region = seg.crop_region
            
            # 确保mask是2D
            if mask.dim() == 3:
                mask = mask[0] if mask.shape[0] == 1 else mask
            if mask.dim() == 3:
                mask = mask.squeeze(0)
            
            # 获取crop区域坐标
            x1, y1, x2, y2 = crop_region
            
            # 调整mask尺寸以匹配crop区域
            crop_h, crop_w = y2 - y1, x2 - x1
            if mask.shape != (crop_h, crop_w):
                mask = torch.nn.functional.interpolate(
                    mask.unsqueeze(0).unsqueeze(0),
                    size=(crop_h, crop_w),
                    mode='bilinear',
                    align_corners=False
                ).squeeze(0).squeeze(0)
            
            # 创建全图mask
            full_mask = torch.zeros((h, w), dtype=torch.float32)
            if y1 >= 0 and y2 <= h and x1 >= 0 and x2 <= w:
                full_mask[y1:y2, x1:x2] = mask
            merged_mask = full_mask
        else:
            # 多个seg，合并mask
            crop_regions = [seg.crop_region for seg in selected_segs]
            merged_mask = self.create_full_mask(image_shape, selected_segs, crop_regions)
        
        return (new_segs, merged_mask)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "孤海Seg次序过滤": 孤海Seg次序过滤
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海Seg次序过滤": "孤海-Seg次序过滤"
}