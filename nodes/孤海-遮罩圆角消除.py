import torch
import numpy as np
import cv2
from comfy.model_management import get_torch_device
import copy

class MaskCornerFixer:
    def __init__(self):
        self.device = get_torch_device()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": ("MASK",),
                "trim_percent": ("FLOAT", {"default": 0.15, "min": 0.01, "max": 0.4, "step": 0.01}),
            }
        }
    
    RETURN_TYPES = ("MASK",)
    FUNCTION = "fix_mask_corners"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "消除遮罩圆角，保持四条边不变并还原折角"

    def fix_mask_corners(self, mask, trim_percent=0.15):
        # 确保只处理批次中的第一张
        mask_np = mask.cpu().numpy()
        if len(mask_np.shape) == 3:
            mask_np = mask_np[0]
        
        # 二值化处理
        _, binary = cv2.threshold((mask_np * 255).astype(np.uint8), 128, 255, cv2.THRESH_BINARY)
        
        # 查找最大轮廓
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest_contour = max(contours, key=cv2.contourArea)
        
        # 获取凸包
        convex_hull = cv2.convexHull(largest_contour)
        
        # 多边形逼近获取近似四边形
        epsilon = 0.01 * cv2.arcLength(convex_hull, True)
        approx = cv2.approxPolyDP(convex_hull, epsilon, True)
        
        # 确保有四个顶点
        if len(approx) != 4:
            # 如果没有精确的四个点，尝试不同精度的逼近
            epsilon_values = [0.005, 0.01, 0.02, 0.03, 0.05]
            for e in epsilon_values:
                approx = cv2.approxPolyDP(convex_hull, e * cv2.arcLength(convex_hull, True), True)
                if len(approx) == 4:
                    break
            if len(approx) != 4:
                # 仍然不是四个点，使用原始凸包顶点
                approx = convex_hull
                
        # 获取轮廓点
        contour_points = largest_contour.reshape(-1, 2)
        
        # 如果approx长度超过4，取前4个点
        approx_points = approx.reshape(-1, 2)[:4]
        
        # 对顶点排序 (顺时针或逆时针)
        approx_points = self.sort_vertices(approx_points)
        
        # 分割轮廓为四段
        segments = self.split_contour_at_vertices(contour_points, approx_points)
        
        # 初始化直线列表
        lines = []
        
        # 处理每个线段
        for segment in segments:
            # 修剪端点（去除圆角部分）
            n_points = len(segment)
            if n_points < 5:  # 如果点数太少，则全部使用
                selected_points = segment
            else:
                trim = max(1, int(n_points * trim_percent))  # 至少修剪1个点
                selected_points = segment[trim:-trim]
            
            # 为点添加一个额外的维度以符合fitLine的输入格式
            segment_points = selected_points.reshape(-1, 1, 2).astype(np.float32)
            
            # 使用RANSAC拟合直线
            line = cv2.fitLine(segment_points, cv2.DIST_L2, 0, 0.01, 0.01)
            lines.append(line)
        
        # 计算四条直线的四个交点
        intersection_points = []
        for i in range(len(lines)):
            line1 = lines[i]
            line2 = lines[(i + 1) % len(lines)]
            p = self.line_intersection(line1, line2)
            intersection_points.append(p)
        
        # 创建新四边形
        polygon_points = np.array(intersection_points, dtype=np.int32).reshape(-1, 1, 2)
        
        # 创建新遮罩
        fixed_mask = np.zeros_like(binary)
        cv2.fillPoly(fixed_mask, [polygon_points], 255)
        
        # 转换回tensor
        fixed_mask_tensor = torch.from_numpy(fixed_mask.astype(np.float32) / 255.0).unsqueeze(0)
        return (fixed_mask_tensor,)

    def sort_vertices(self, points):
        """对顶点进行排序（顺时针或逆时针）"""
        # 计算中心点
        center = np.mean(points, axis=0)
        
        # 计算每个点相对于中心的极角
        diff = points - center
        angles = np.arctan2(diff[:, 1], diff[:, 0])
        
        # 按角度排序
        sorted_indices = np.argsort(angles)
        sorted_points = points[sorted_indices]
        
        return sorted_points
    
    def split_contour_at_vertices(self, contour_points, approx_points):
        """将轮廓在近似顶点处分割成四个段落"""
        # 查找每个顶点在轮廓中的索引
        indices = []
        for point in approx_points:
            # 查找最近的轮廓点
            distances = np.linalg.norm(contour_points - point, axis=1)
            closest_index = np.argmin(distances)
            indices.append(closest_index)
        
        # 对索引排序
        indices = sorted(indices)
        
        # 分割轮廓
        segments = []
        n_points = len(contour_points)
        
        for i in range(4):
            start_idx = indices[i]
            end_idx = indices[(i + 1) % 4]
            
            if i < 3:
                if end_idx > start_idx:
                    segment = contour_points[start_idx:end_idx + 1]
                else:
                    segment = np.concatenate((contour_points[start_idx:], contour_points[:end_idx + 1]))
            else:  # 最后一段（从最后顶点到第一个顶点）
                segment = np.concatenate((contour_points[start_idx:], contour_points[:end_idx + 1]))
            
            segments.append(segment)
        
        return segments
    
    def line_intersection(self, line1, line2):
        """计算两条直线的交点（使用fitLine格式）"""
        # 提取直线参数：vx, vy, x0, y0
        vx1, vy1, x1, y1 = line1[0], line1[1], line1[2], line1[3]
        vx2, vy2, x2, y2 = line2[0], line2[1], line2[2], line2[3]
        
        # 计算交点
        d = vx1 * vy2 - vy1 * vx2
        if abs(d) < 1e-10:  # 处理平行线
            return (0, 0)
        
        t = ((x2 - x1) * vy2 - (y2 - y1) * vx2) / d
        x = x1 + t * vx1
        y = y1 + t * vy1
        
        return (int(x), int(y))

# 注册节点
NODE_CLASS_MAPPINGS = {
    "MaskCornerFixer": MaskCornerFixer
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MaskCornerFixer": "孤海-遮罩圆角消除"
}