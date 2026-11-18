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
                    "左右下上",
                    "上下左右",
                    "下上左右"
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
                    "tooltip": "百分比：先经过舍弃因子筛选，再取每张遮罩最大连通区域的外接矩形尺寸计算平均值。左右上下、左右下上使用平均宽度，上下左右、下上左右使用平均高度；50 表示平均尺寸的 50%，坐标差超过该距离才另分一组。"
                }),
            },
            "optional": {
                "Seg": ("SEGS",),
                "masks": ("MASK", {"tooltip": "按每张遮罩的最大连通区域排序，输出保留完整遮罩；同时连接 Seg 时以 Seg 为准。"}),
                "舍弃因子": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 5.0,
                    "step": 0.01,
                    "tooltip": "0 关闭筛选；1 个遮罩直接输出。非 0 时先舍弃中心点位于画布任一侧外缘 1/20 区域内的遮罩，不参与参照计算。按输入数量：2～3 个取九宫格中心区域内最靠近画面中心的遮罩，没有则取长边最大的；4 个取最靠近中心的 2 个，5 个及以上取 3 个，排除长边不足候选最大长边 2/3 的小遮罩后计算平均长边 a。位置按白色区域外接矩形中心点判断。舍弃长边与 a 的差超过 因子×a 的遮罩。0.5 保留 [0.5a, 1.5a]；越大越宽松。尺寸筛选全部舍弃时恢复非边缘候选；边缘排除全部舍弃时恢复原输入。"
                }),
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
            if isinstance(bbox, (list, tuple, np.ndarray, torch.Tensor)) and len(bbox) >= 4:
                return tuple(float(value) for value in bbox[:4])
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
    
    def group_segments_by_x(self, segs_list: List, threshold: float) -> List[List]:
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

    def get_largest_component_bbox(self, seg) -> tuple:
        # masks 输入已计算最大连通区域，直接复用；Seg 输入按实际裁剪遮罩计算。
        if hasattr(seg, 'sort_area'):
            return self.get_segment_bbox(seg)
        mask = self.mask_batch(self.get_segment_mask(seg))
        x1, y1, x2, y2 = seg.crop_region
        if x2 <= x1 or y2 <= y1:
            return self.get_segment_bbox(seg)
        if mask.shape[-2:] != (y2 - y1, x2 - x1):
            mask = torch.nn.functional.interpolate(
                mask.to(dtype=torch.float32).unsqueeze(1), size=(y2 - y1, x2 - x1),
                mode='bilinear', align_corners=False
            ).squeeze(1)
        active = (mask > 0.1).any(dim=0).to(device='cpu', dtype=torch.uint8).numpy()
        count, _, stats, _ = cv2.connectedComponentsWithStats(active, connectivity=8)
        if count <= 1:
            return self.get_segment_bbox(seg)
        component = stats[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])]
        x, y, width, height = map(int, component[:4])
        return (x1 + x, y1 + y, x1 + x + width, y1 + y + height)

    def sort_top_bottom_left_right(self, segs_list: List, threshold: int, reverse_order: bool,
                                  bottom_first: bool = False) -> List:
        positions = [(seg, self.get_largest_component_bbox(seg)) for seg in segs_list]
        heights = [bbox[3] - bbox[1] for _, bbox in positions
                   if bbox[2] > bbox[0] and bbox[3] > bbox[1]]
        threshold = sum(heights) / len(heights) * threshold / 100 if heights else 0.0
        positions.sort(key=lambda item: item[1][1])
        groups = []
        current_group = []
        top_sum = 0.0
        for seg, bbox in positions:
            top = bbox[1]
            # 与当前行已收录遮罩最高点的平均 Y 比较，超过阈值才另起一行。
            if current_group and top - top_sum / len(current_group) > threshold:
                groups.append(current_group)
                current_group = []
                top_sum = 0.0
            current_group.append((seg, bbox))
            top_sum += top
        if current_group:
            groups.append(current_group)
        if bottom_first:
            groups.reverse()
        result = [seg for group in groups
                  for seg, _ in sorted(group, key=lambda item: item[1][0])]
        return list(reversed(result)) if reverse_order else result
    
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
        
        elif 优先规则 in ("左右上下", "左右下上"):
            bboxes = [self.get_largest_component_bbox(seg) for seg in segs_list]
            widths = [x2 - x1 for x1, y1, x2, y2 in bboxes if x2 > x1 and y2 > y1]
            threshold = sum(widths) / len(widths) * 分组阈值 / 100 if widths else 0.0
            groups = self.group_segments_by_x(segs_list, threshold)
            if 优先规则 == "左右上下":
                sorted_segs = self.sort_groups_left_right_top_bottom(groups, not reverse_sort)
            else:
                sorted_segs = self.sort_groups_left_right_bottom_top(groups, not reverse_sort)

        elif 优先规则 in ("上下左右", "下上左右"):
            sorted_segs = self.sort_top_bottom_left_right(
                segs_list, 分组阈值, not reverse_sort, bottom_first=(优先规则 == "下上左右")
            )
        
        else:
            # 默认不排序
            sorted_segs = segs_list
        
        return sorted_segs

    def get_white_bbox(self, seg, image_shape):
        """使用实际白色区域（含所有连通区域），而非检测框或裁剪框。"""
        h, w = image_shape
        x1, y1, x2, y2 = seg.crop_region
        mask = self.mask_batch(self.get_segment_mask(seg))
        if x2 <= x1 or y2 <= y1:
            return (0, 0, 0, 0)
        if mask.shape[-2:] != (y2 - y1, x2 - x1):
            mask = torch.nn.functional.interpolate(
                mask.to(dtype=torch.float32).unsqueeze(1), size=(y2 - y1, x2 - x1),
                mode='bilinear', align_corners=False
            ).squeeze(1)
        left, top = max(0, x1), max(0, y1)
        right, bottom = min(w, x2), min(h, y2)
        if right <= left or bottom <= top:
            return (0, 0, 0, 0)
        active = (mask[:, top-y1:bottom-y1, left-x1:right-x1] > 0.1).any(dim=0)
        x, y, width, height = cv2.boundingRect(active.to(device='cpu', dtype=torch.uint8).numpy())
        if width == 0 or height == 0:
            return (0, 0, 0, 0)
        return (left + x, top + y, left + x + width, top + y + height)

    @staticmethod
    def get_reference_lengths(bboxes, image_shape, input_count):
        h, w = image_shape
        if h <= 0 or w <= 0:
            return []
        candidates = [
            (max(x2 - x1, y2 - y1), (x1 + x2) / (2 * w), (y1 + y2) / (2 * h))
            for x1, y1, x2, y2 in bboxes if x2 > x1 and y2 > y1
        ]
        if not candidates:
            return []
        if input_count <= 3:
            central = [item for item in candidates
                       if 1/3 <= item[1] <= 2/3 and 1/3 <= item[2] <= 2/3]
            if not central:
                return [max(item[0] for item in candidates)]
            candidates = central
            reference_count = 1
        else:
            reference_count = 2 if input_count == 4 else 3
        nearest = sorted(candidates, key=lambda item: ((item[1] - 0.5)**2 + (item[2] - 0.5)**2,
                                                        -item[2]))[:reference_count]
        largest = max(item[0] for item in nearest)
        # 小脸不参与参照平均，避免背景人脸拉低基准而误删主体。
        return [item[0] for item in nearest if item[0] >= largest * 2 / 3]

    def discard_by_size(self, segments, image_shape, factor):
        if factor == 0 or len(segments) <= 1:
            return segments
        bboxes = [self.get_white_bbox(seg, image_shape) for seg in segments]
        h, w = image_shape
        interior = [(seg, bbox) for seg, bbox in zip(segments, bboxes)
                    if w / 20 < (bbox[0] + bbox[2]) / 2 < w * 19 / 20
                    and h / 20 < (bbox[1] + bbox[3]) / 2 < h * 19 / 20]
        if not interior:
            return segments
        input_count = len(segments)
        segments = [seg for seg, _ in interior]
        bboxes = [bbox for _, bbox in interior]
        lengths = [max(x2 - x1, y2 - y1) for x1, y1, x2, y2 in bboxes]
        reference_lengths = self.get_reference_lengths(bboxes, image_shape, input_count)
        if not reference_lengths:
            return segments
        average = sum(reference_lengths) / len(reference_lengths)
        retained = [seg for seg, length in zip(segments, lengths)
                    if length > 0 and abs(length - average) <= factor * average]
        return retained or segments

    @staticmethod
    def select_segments(sorted_segs, start, count):
        if not sorted_segs:
            return []
        if count == 0:
            # 索引超出范围时也保留一个候选，避免有输入却选出空列表。
            return sorted_segs[start:] or [sorted_segs[start % len(sorted_segs)]]
        return [sorted_segs[(start + i) % len(sorted_segs)]
                for i in range(min(count, len(sorted_segs)))]

    def filter_masks(self, masks, 优先规则, 正反顺序, 开始索引, 过滤数量, 分组阈值, 合并遮罩, 舍弃因子=0.0):
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
            segments.append(SimpleNamespace(cropped_mask=mask, bbox=bbox, sort_area=area,
                                            crop_region=(0, 0, w, h)))
        segments = self.discard_by_size(segments, (h, w), 舍弃因子)
        if len(segments) <= 1:
            selected = segments
        else:
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
                        masks=None, 合并遮罩: bool = True, 舍弃因子: float = 0.0) -> Tuple[tuple, torch.Tensor]:
        if Seg is None and masks is not None:
            return self.filter_masks(masks, 优先规则, 正反顺序, 开始索引, 过滤数量, 分组阈值, 合并遮罩, 舍弃因子)

        if isinstance(Seg, tuple) and len(Seg) == 2:
            image_shape, segs_list = Seg
        else:
            image_shape = (0, 0)
            segs_list = Seg if isinstance(Seg, list) else []
        if not segs_list:
            h, w = image_shape if image_shape != (0, 0) else (512, 512)
            empty_mask = torch.zeros((h, w), dtype=torch.float32)
            return ((image_shape, []), empty_mask if 合并遮罩 else empty_mask.unsqueeze(0))

        segs_list = self.discard_by_size(segs_list, image_shape, 舍弃因子)
        if len(segs_list) <= 1:
            selected_segs = segs_list
        else:
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
