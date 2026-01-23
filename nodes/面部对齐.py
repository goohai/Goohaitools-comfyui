import torch
import numpy as np
import cv2
from PIL import Image
import math
import os
import urllib.request
import sys

try:
    import mediapipe as mp
    from packaging import version
    
    # 检测mediapipe版本
    mp_version = version.parse(mp.__version__)
    HAS_MEDIAPIPE = True
    
    # 根据版本选择导入方式
    if mp_version >= version.parse("0.10.30"):
        try:
            from mediapipe.tasks.python import vision
            from mediapipe import tasks
            USE_NEW_API = True
            print(f"使用mediapipe新API (v{mp.__version__})")
        except ImportError:
            USE_NEW_API = False
            print(f"使用mediapipe旧API (v{mp.__version__})")
    else:
        USE_NEW_API = False
        print(f"使用mediapipe旧API (v{mp.__version__})")
        
except ImportError:
    HAS_MEDIAPIPE = False
    USE_NEW_API = False
    print("警告: 未安装mediapipe，请运行: pip install mediapipe")

class GuHaiFaceAlignment:
   
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "目标图": ("IMAGE",),
                "面部置信度": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.1}),
                "角度对齐": ("BOOLEAN", {"default": True}),
                "填充模式": (["自定义颜色", "边框颜色"], {"default": "边框颜色"}),
            },
            "optional": {
                "参考图": ("IMAGE",),
                "自定义填充色": ("COLORCODE", {"default": "#364254"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "align_faces"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "通过mediapipe检测人脸并进行面部对齐，自动适配mediapipe 0.10.21-和0.10.30+版本"

    def __init__(self):
        self.face_landmarker = None
        self.face_mesh = None
        self.model_path = "models/mediapipe/face_landmarker.task"
        self.model_url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
        
        if HAS_MEDIAPIPE:
            if USE_NEW_API:
                self._ensure_model_exists()
                self.initialize_face_landmarker()
            else:
                self.initialize_face_mesh()

    def _ensure_model_exists(self):
        """确保模型文件存在，如果不存在则自动下载（仅新API需要）"""
        if os.path.exists(self.model_path):
            print(f"模型文件已存在: {self.model_path}")
            return True
        
        print(f"模型文件不存在，开始下载到: {self.model_path}")
        
        # 创建目录
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        
        try:
            # 下载模型文件
            def progress_hook(count, block_size, total_size):
                percent = int(count * block_size * 100 / total_size)
                sys.stdout.write(f"\r下载进度: {percent}%")
                sys.stdout.flush()
            
            urllib.request.urlretrieve(
                self.model_url, 
                self.model_path,
                progress_hook
            )
            print(f"\n模型下载完成: {self.model_path}")
            return True
            
        except Exception as e:
            print(f"\n错误: 模型下载失败: {e}")
            # 清理可能下载失败的文件
            if os.path.exists(self.model_path):
                os.remove(self.model_path)
            return False

    def initialize_face_landmarker(self):
        """初始化FaceLandmarker（新API）"""
        if not HAS_MEDIAPIPE or not USE_NEW_API:
            return False
            
        if not os.path.exists(self.model_path):
            print(f"错误: 模型文件不存在: {self.model_path}")
            return False
            
        try:
            base_options = tasks.BaseOptions(model_asset_path=self.model_path)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                num_faces=5
            )
            self.face_landmarker = vision.FaceLandmarker.create_from_options(options)
            print(f"FaceLandmarker初始化成功（新API）")
            return True
        except Exception as e:
            print(f"错误: 初始化FaceLandmarker失败: {e}")
            return False

    def initialize_face_mesh(self):
        """初始化FaceMesh（旧API）"""
        if not HAS_MEDIAPIPE or USE_NEW_API:
            return False
            
        try:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=5,
                refine_landmarks=True,
                min_detection_confidence=0.5
            )
            print("FaceMesh初始化成功（旧API）")
            return True
        except Exception as e:
            print(f"错误: 初始化FaceMesh失败: {e}")
            return False

    def calculate_polygon_area(self, points):
        """使用鞋带公式计算多边形面积"""
        if len(points) < 3:
            return 0
        
        area = 0
        for i in range(len(points)):
            j = (i + 1) % len(points)
            area += points[i][0] * points[j][1]
            area -= points[j][0] * points[i][1]
        
        return abs(area) / 2.0

    def calculate_distance_to_center(self, face_center, image_center):
        """计算人脸中心点到图像中心的距离"""
        return math.sqrt((face_center[0] - image_center[0])**2 + 
                        (face_center[1] - image_center[1])**2)

    def detect_face_new_api(self, image_np, confidence_threshold):
        """使用新API（FaceLandmarker）检测人脸"""
        if not HAS_MEDIAPIPE or not USE_NEW_API or self.face_landmarker is None:
            return None
        
        h, w, _ = image_np.shape
        image_center = (w // 2, h // 2)
        
        try:
            image_rgb = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
            
            detection_result = self.face_landmarker.detect(mp_image)
            
            if detection_result.face_landmarks:
                detected_faces = []
                
                for face_landmarks in detection_result.face_landmarks:
                    all_points = []
                    for landmark in face_landmarks:
                        x = int(landmark.x * w)
                        y = int(landmark.y * h)
                        all_points.append((x, y))
                    
                    face_contour_indices = [
                        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                        397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
                    ]
                    
                    face_contour_points = [all_points[i] for i in face_contour_indices if i < len(all_points)]
                    
                    if len(face_contour_points) < 5:
                        continue
                    
                    face_area = self.calculate_polygon_area(face_contour_points)
                    
                    xs = [p[0] for p in face_contour_points]
                    ys = [p[1] for p in face_contour_points]
                    
                    x_min, x_max = min(xs), max(xs)
                    y_min, y_max = min(ys), max(ys)
                    
                    width = x_max - x_min
                    height = y_max - y_min
                    
                    x_min = max(0, x_min)
                    y_min = max(0, y_min)
                    width = min(w - x_min, width)
                    height = min(h - y_min, height)
                    
                    face_center_x = np.mean(xs)
                    face_center_y = np.mean(ys)
                    
                    distance_to_center = self.calculate_distance_to_center(
                        (face_center_x, face_center_y), image_center
                    )
                    
                    keypoints = self._extract_keypoints(all_points, x_min, y_min, width, height)
                    
                    face_info = {
                        "bbox": (x_min, y_min, width, height),
                        "keypoints": keypoints,
                        "center": (int(face_center_x), int(face_center_y)),
                        "face_width": width,
                        "face_height": height,
                        "face_area": face_area,
                        "face_contour_points": face_contour_points,
                        "distance_to_center": distance_to_center
                    }
                    detected_faces.append(face_info)
                
                if detected_faces:
                    detected_faces.sort(key=lambda x: x["distance_to_center"])
                    return detected_faces[0]
                    
        except Exception as e:
            print(f"新API人脸检测错误: {e}")
            
        return None

    def detect_face_old_api(self, image_np, confidence_threshold):
        """使用旧API（FaceMesh）检测人脸"""
        if not HAS_MEDIAPIPE or USE_NEW_API or self.face_mesh is None:
            return None
            
        image_rgb = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(image_rgb)
        
        if results.multi_face_landmarks:
            h, w, _ = image_np.shape
            image_center = (w // 2, h // 2)
            
            detected_faces = []
            
            for face_landmarks in results.multi_face_landmarks:
                all_points = []
                for landmark in face_landmarks.landmark:
                    x = int(landmark.x * w)
                    y = int(landmark.y * h)
                    all_points.append((x, y))
                
                face_contour_indices = [
                    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
                ]
                
                face_contour_points = [all_points[i] for i in face_contour_indices if i < len(all_points)]
                
                if len(face_contour_points) < 5:
                    continue
                
                face_area = self.calculate_polygon_area(face_contour_points)
                
                xs = [p[0] for p in face_contour_points]
                ys = [p[1] for p in face_contour_points]
                
                x_min, x_max = min(xs), max(xs)
                y_min, y_max = min(ys), max(ys)
                
                width = x_max - x_min
                height = y_max - y_min
                
                x_min = max(0, x_min)
                y_min = max(0, y_min)
                width = min(w - x_min, width)
                height = min(h - y_min, height)
                
                face_center_x = np.mean(xs)
                face_center_y = np.mean(ys)
                
                distance_to_center = self.calculate_distance_to_center(
                    (face_center_x, face_center_y), image_center
                )
                
                keypoints = self._extract_keypoints(all_points, x_min, y_min, width, height)
                
                face_info = {
                    "bbox": (x_min, y_min, width, height),
                    "keypoints": keypoints,
                    "center": (int(face_center_x), int(face_center_y)),
                    "face_width": width,
                    "face_height": height,
                    "face_area": face_area,
                    "face_contour_points": face_contour_points,
                    "distance_to_center": distance_to_center
                }
                detected_faces.append(face_info)
            
            if detected_faces:
                detected_faces.sort(key=lambda x: x["distance_to_center"])
                return detected_faces[0]
            
        return None

    def detect_face_with_mesh(self, image_np, confidence_threshold):
        """统一的人脸检测接口，根据版本自动选择API"""
        if not HAS_MEDIAPIPE:
            return None
        
        if USE_NEW_API:
            return self.detect_face_new_api(image_np, confidence_threshold)
        else:
            return self.detect_face_old_api(image_np, confidence_threshold)

    def _extract_keypoints(self, all_points, x_min, y_min, width, height):
        """提取关键点（两个版本通用）"""
        keypoints = []
        
        # 右眼中心
        right_eye_indices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
        right_eye_points = [all_points[i] for i in right_eye_indices if i < len(all_points)]
        if right_eye_points:
            right_eye_center = (int(np.mean([p[0] for p in right_eye_points])), 
                               int(np.mean([p[1] for p in right_eye_points])))
            keypoints.append(right_eye_center)
        else:
            keypoints.append((x_min + width // 4, y_min + height // 3))
        
        # 左眼中心
        left_eye_indices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        left_eye_points = [all_points[i] for i in left_eye_indices if i < len(all_points)]
        if left_eye_points:
            left_eye_center = (int(np.mean([p[0] for p in left_eye_points])), 
                              int(np.mean([p[1] for p in left_eye_points])))
            keypoints.append(left_eye_center)
        else:
            keypoints.append((x_min + 3 * width // 4, y_min + height // 3))
        
        # 鼻尖
        nose_indices = [1, 2, 98, 327, 4, 5, 195, 197, 6, 168]
        nose_points = [all_points[i] for i in nose_indices if i < len(all_points)]
        if nose_points:
            nose_center = (int(np.mean([p[0] for p in nose_points])), 
                         int(np.mean([p[1] for p in nose_points])))
            keypoints.append(nose_center)
        else:
            keypoints.append((x_min + width // 2, y_min + 2 * height // 3))
        
        return keypoints

    def calculate_rotation_angle(self, keypoints):
        """根据眼睛关键点计算旋转角度（两个版本通用）"""
        if len(keypoints) >= 2:
            left_eye = keypoints[1]  # 左眼
            right_eye = keypoints[0]  # 右眼
            
            dy = right_eye[1] - left_eye[1]
            dx = right_eye[0] - left_eye[0]
            
            if dx == 0:
                angle = 90 if dy > 0 else -90
            else:
                angle = math.degrees(math.atan2(dy, dx))
            
            return -angle
        return 0

    def get_optimized_border_color(self, image_np):
        """优化版边框颜色算法（两个版本通用）"""
        h, w, _ = image_np.shape
        
        top_edge = image_np[0, :, :]
        bottom_edge = image_np[h-1, :, :]
        left_edge = image_np[:, 0, :]
        right_edge = image_np[:, w-1, :]
        
        border_pixels = np.concatenate([top_edge, bottom_edge, left_edge, right_edge])
        rounded_colors = np.round(border_pixels / 10) * 10
        
        color_counts = {}
        for i in range(len(rounded_colors)):
            color_tuple = tuple(rounded_colors[i])
            color_counts[color_tuple] = color_counts.get(color_tuple, 0) + 1
        
        if not color_counts:
            return (255, 255, 255)
        
        sorted_colors = sorted(color_counts.items(), key=lambda x: x[1], reverse=True)
        top_colors = sorted_colors[:min(5, len(sorted_colors))]
        
        total_r, total_g, total_b = 0, 0, 0
        total_weight = 0
        
        for color_tuple, count in top_colors:
            r, g, b = color_tuple
            total_r += r * count
            total_g += g * count
            total_b += b * count
            total_weight += count
        
        if total_weight > 0:
            avg_r = int(total_r / total_weight)
            avg_g = int(total_g / total_weight)
            avg_b = int(total_b / total_weight)
            return (avg_r, avg_g, avg_b)
        
        return (255, 255, 255)

    def parse_color(self, color_str):
        """解析颜色字符串（两个版本通用）"""
        try:
            if color_str.startswith('#'):
                hex_color = color_str.lstrip('#')
                if len(hex_color) == 6:
                    r = int(hex_color[0:2], 16)
                    g = int(hex_color[2:4], 16)
                    b = int(hex_color[4:6], 16)
                    return (r, g, b)
                elif len(hex_color) == 3:
                    r = int(hex_color[0] * 2, 16)
                    g = int(hex_color[1] * 2, 16)
                    b = int(hex_color[2] * 2, 16)
                    return (r, g, b)
            elif color_str.startswith('rgb('):
                parts = color_str[4:-1].split(',')
                return tuple(int(p.strip()) for p in parts)
        except:
            pass
        return (255, 255, 255)

    def create_expanded_canvas(self, image, target_size, fill_color=(255, 255, 255)):
        """创建扩展画布（两个版本通用）"""
        original_w, original_h = image.size
        target_w, target_h = target_size
        
        paste_x = (target_w - original_w) // 2
        paste_y = (target_h - original_h) // 2
        
        if image.mode == 'RGBA':
            canvas = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
        else:
            canvas = Image.new('RGB', (target_w, target_h), fill_color)
        
        canvas.paste(image, (paste_x, paste_y))
        return canvas, paste_x, paste_y

    def align_faces(self, 目标图, 面部置信度, 角度对齐, 填充模式, 参考图=None, 自定义填充色="#FFFFFF"):
        """面部对齐主函数（两个版本通用）"""
        if not HAS_MEDIAPIPE:
            print("错误: mediapipe未安装，请先运行: pip install mediapipe")
            return (目标图,)
        
        print(f"使用mediapipe v{mp.__version__}，API类型: {'新' if USE_NEW_API else '旧'}")
        
        # 转换目标图
        if len(目标图.shape) == 4:
            target_tensor = 目标图[0]
        else:
            target_tensor = 目标图
            
        target_np = (target_tensor.cpu().numpy() * 255.0).astype(np.uint8)
        if len(target_np.shape) == 3 and target_np.shape[2] == 3:
            target_np_rgb = target_np
            target_np_bgr = cv2.cvtColor(target_np, cv2.COLOR_RGB2BGR)
        else:
            target_np_rgb = cv2.cvtColor(target_np, cv2.COLOR_BGR2RGB)
            target_np_bgr = target_np
        
        # 检测目标图人脸
        target_face = self.detect_face_with_mesh(target_np_bgr, 面部置信度)
        
        has_reference = 参考图 is not None and len(参考图) > 0
        reference_face = None
        
        if has_reference:
            if len(参考图.shape) == 4:
                reference_tensor = 参考图[0]
            else:
                reference_tensor = 参考图
                
            reference_np = (reference_tensor.cpu().numpy() * 255.0).astype(np.uint8)
            if len(reference_np.shape) == 3 and reference_np.shape[2] == 3:
                reference_np_rgb = reference_np
                reference_np_bgr = cv2.cvtColor(reference_np, cv2.COLOR_RGB2BGR)
            else:
                reference_np_rgb = cv2.cvtColor(reference_np, cv2.COLOR_BGR2RGB)
                reference_np_bgr = reference_np
            
            reference_face = self.detect_face_with_mesh(reference_np_bgr, 面部置信度)
        
        # 情况A: 有参考图且检测到人脸
        if has_reference and reference_face is not None and target_face is not None:
            ref_h, ref_w, _ = reference_np_bgr.shape
            
            target_pil = Image.fromarray(target_np_rgb)
            original_target_size = target_pil.size
            original_w, original_h = original_target_size
            
            ref_center_x, ref_center_y = reference_face["center"]
            target_center_x, target_center_y = target_face["center"]
            
            ref_face_area = reference_face["face_area"]
            target_face_area = target_face["face_area"]
            
            if target_face_area == 0:
                scale_factor = 1.0
            else:
                scale_factor = math.sqrt(ref_face_area / target_face_area)
            
            new_width = int(original_w * scale_factor)
            new_height = int(original_h * scale_factor)
            
            if new_width > 0 and new_height > 0:
                target_pil_scaled = target_pil.resize((new_width, new_height), Image.Resampling.LANCZOS)
            else:
                target_pil_scaled = target_pil
                new_width, new_height = original_w, original_h
            
            scaled_center_x = target_center_x * scale_factor
            scaled_center_y = target_center_y * scale_factor
            
            rotation_angle = 0
            if 角度对齐:
                target_angle = self.calculate_rotation_angle(target_face["keypoints"])
                reference_angle = self.calculate_rotation_angle(reference_face["keypoints"])
                
                rotation_angle = reference_angle - target_angle
                
                if abs(rotation_angle) > 90:
                    if rotation_angle > 0:
                        rotation_angle -= 180
                    else:
                        rotation_angle += 180
            
            diagonal = int(math.sqrt(new_width**2 + new_height**2))
            expanded_size = max(ref_w, ref_h, diagonal) * 2
            
            if 填充模式 == "自定义颜色":
                fill_color = self.parse_color(自定义填充色)
            else:
                fill_color = self.get_optimized_border_color(target_np_rgb)
            
            expanded_canvas, offset_x, offset_y = self.create_expanded_canvas(
                target_pil_scaled, (expanded_size, expanded_size), fill_color
            )
            
            expanded_center_x = scaled_center_x + offset_x
            expanded_center_y = scaled_center_y + offset_y
            
            if abs(rotation_angle) > 0.1:
                expanded_canvas_rotated = expanded_canvas.rotate(
                    rotation_angle, 
                    center=(expanded_center_x, expanded_center_y),
                    expand=True,
                    resample=Image.BICUBIC,
                    fillcolor=fill_color
                )
                
                rotated_w, rotated_h = expanded_canvas_rotated.size
                rotated_center_x = expanded_center_x + (rotated_w - expanded_size) // 2
                rotated_center_y = expanded_center_y + (rotated_h - expanded_size) // 2
            else:
                expanded_canvas_rotated = expanded_canvas
                rotated_w, rotated_h = expanded_size, expanded_size
                rotated_center_x = expanded_center_x
                rotated_center_y = expanded_center_y
            
            crop_x = int(rotated_center_x - ref_center_x)
            crop_y = int(rotated_center_y - ref_center_y)
            
            crop_x = max(0, min(rotated_w - ref_w, crop_x))
            crop_y = max(0, min(rotated_h - ref_h, crop_y))
            
            result_canvas = expanded_canvas_rotated.crop((crop_x, crop_y, crop_x + ref_w, crop_y + ref_h))
            
            if result_canvas.mode == 'RGBA':
                if 填充模式 == "自定义颜色":
                    bg_color = self.parse_color(自定义填充色)
                else:
                    bg_color = self.get_optimized_border_color(target_np_rgb)
                
                bg_layer = Image.new('RGB', result_canvas.size, bg_color)
                bg_layer.paste(result_canvas, mask=result_canvas.split()[3])
                result_canvas = bg_layer
            
            result_np = np.array(result_canvas).astype(np.float32) / 255.0
            result_tensor = torch.from_numpy(result_np)[None, ...]
            
            return (result_tensor,)
        
        # 情况B: 没有参考图，但目标图检测到人脸且角度对齐开启
        elif target_face is not None and 角度对齐:
            target_pil = Image.fromarray(target_np_rgb)
            original_w, original_h = target_pil.size
            
            target_angle = self.calculate_rotation_angle(target_face["keypoints"])
            
            if abs(target_angle) > 0.1:
                center_x = original_w / 2
                center_y = original_h / 2
                
                if 填充模式 == "自定义颜色":
                    fill_color = self.parse_color(自定义填充色)
                else:
                    fill_color = self.get_optimized_border_color(target_np_rgb)
                
                target_pil_rotated = target_pil.rotate(
                    -target_angle, 
                    center=(center_x, center_y),
                    expand=True,
                    resample=Image.BICUBIC, 
                    fillcolor=fill_color
                )
                
                if 填充模式 == "自定义颜色":
                    result_bg_color = self.parse_color(自定义填充色)
                else:
                    result_bg_color = self.get_optimized_border_color(target_np_rgb)
                
                result = Image.new('RGB', target_pil_rotated.size, result_bg_color)
                result.paste(target_pil_rotated, (0, 0))
                
                result_np = np.array(result).astype(np.float32) / 255.0
                result_tensor = torch.from_numpy(result_np)[None, ...]
                
                return (result_tensor,)
            else:
                return (目标图,)
        
        # 其他情况：直接返回目标图
        if len(目标图.shape) == 3:
            return (目标图.unsqueeze(0),)
        else:
            return (目标图,)


# 节点注册
NODE_CLASS_MAPPINGS = {
    "GuHai_FaceAlignment": GuHaiFaceAlignment
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHai_FaceAlignment": "孤海-面部对齐"
}