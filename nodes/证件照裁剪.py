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

    mp_version = version.parse(mp.__version__)
    HAS_MEDIAPIPE = True

    if mp_version >= version.parse("0.10.30"):
        try:
            from mediapipe.tasks.python import vision
            from mediapipe import tasks
            USE_NEW_API = True
        except ImportError:
            USE_NEW_API = False
    else:
        USE_NEW_API = False

except ImportError:
    HAS_MEDIAPIPE = False
    USE_NEW_API = False
    print("错误: 未安装mediapipe，请运行: pip install mediapipe")

class GuHaiIDPhotoCrop:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "尺寸限制": ("INT", {"default": 2000, "min": 512, "max": 5120, "step": 1, "display": "number"}),
                "面部置信度": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.1}),
                "人脸矫正": ("BOOLEAN", {"default": True}),
                "单位": (["厘米", "像素"], {"default": "厘米"}),
                "证件照宽": ("FLOAT", {"default": 2.50, "min": 1.00, "max": 4096.00, "step": 0.01, "display": "number", "round": 0.01}),
                "证件照高": ("FLOAT", {"default": 3.50, "min": 1.00, "max": 4096.00, "step": 0.01, "display": "number", "round": 0.01}),
                "DPI": ("INT", {"default": 600, "min": 72, "max": 2000, "step": 1, "display": "number"}),
                "脸部大小": ("FLOAT", {"default": 0.42, "min": 0.3, "max": 0.8, "step": 0.05, "display": "slider"}),
                "垂直偏移": ("FLOAT", {"default": 0.38, "min": 0.3, "max": 0.5, "step": 0.05, "display": "slider"}),
                "填充模式": (["自定义颜色", "边框颜色"], {"default": "边框颜色"}),

            },
            "optional": {
                "自定义填充色": ("COLORCODE", {"default": "#364254"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "BOOLEAN", "MASK", "INT")
    RETURN_NAMES = ("裁剪后图像", "是否扩图", "扩展遮罩", "DPI")
    FUNCTION = "crop_face_idphoto"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "通过mediapipe检测人脸，根据自定义脸部比例和垂直偏移进行证件照裁剪，支持人脸矫正和尺寸控制，不适合人脸占比非常小的全身图。"

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
        if os.path.exists(self.model_path):
            return True

        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)

        try:
            def progress_hook(count, block_size, total_size):
                percent = int(count * block_size * 100 / total_size)
                sys.stdout.write(f"\r下载进度: {percent}%")
                sys.stdout.flush()

            urllib.request.urlretrieve(self.model_url, self.model_path, progress_hook)
            print(f"模型下载完成: {self.model_path}")
            return True

        except Exception as e:
            print(f"错误: 模型下载失败: {e}")
            if os.path.exists(self.model_path):
                os.remove(self.model_path)
            return False

    def initialize_face_landmarker(self):
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
            return True
        except Exception as e:
            print(f"错误: 初始化FaceLandmarker失败: {e}")
            return False

    def initialize_face_mesh(self):
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
            return True
        except Exception as e:
            print(f"错误: 初始化FaceMesh失败: {e}")
            return False

    def calculate_polygon_area(self, points):
        if len(points) < 3:
            return 0
        area = 0
        for i in range(len(points)):
            j = (i + 1) % len(points)
            area += points[i][0] * points[j][1]
            area -= points[j][0] * points[i][1]
        return abs(area) / 2.0

    def calculate_distance_to_center(self, face_center, image_center):
        return math.sqrt((face_center[0] - image_center[0])**2 +
                        (face_center[1] - image_center[1])**2)

    def detect_face_new_api(self, image_np, confidence_threshold):
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
            print(f"错误: 新API人脸检测错误: {e}")

        return None

    def detect_face_old_api(self, image_np, confidence_threshold):
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
        if not HAS_MEDIAPIPE:
            return None
        if USE_NEW_API:
            return self.detect_face_new_api(image_np, confidence_threshold)
        else:
            return self.detect_face_old_api(image_np, confidence_threshold)

    def _extract_keypoints(self, all_points, x_min, y_min, width, height):
        keypoints = []

        right_eye_indices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
        right_eye_points = [all_points[i] for i in right_eye_indices if i < len(all_points)]
        if right_eye_points:
            right_eye_center = (int(np.mean([p[0] for p in right_eye_points])),
                               int(np.mean([p[1] for p in right_eye_points])))
            keypoints.append(right_eye_center)
        else:
            keypoints.append((x_min + width // 4, y_min + height // 3))

        left_eye_indices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        left_eye_points = [all_points[i] for i in left_eye_indices if i < len(all_points)]
        if left_eye_points:
            left_eye_center = (int(np.mean([p[0] for p in left_eye_points])),
                              int(np.mean([p[1] for p in left_eye_points])))
            keypoints.append(left_eye_center)
        else:
            keypoints.append((x_min + 3 * width // 4, y_min + height // 3))

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
        if len(keypoints) >= 2:
            left_eye = keypoints[1]
            right_eye = keypoints[0]
            dy = right_eye[1] - left_eye[1]
            dx = right_eye[0] - left_eye[0]
            if dx == 0:
                angle = 90 if dy > 0 else -90
            else:
                angle = math.degrees(math.atan2(dy, dx))
            return -angle
        return 0

    def get_optimized_border_color(self, image_np):
        """
        修改后的边框颜色采样逻辑：
        从上边界向下取10个像素高的区域作为采样区域，
        排除颜色反差较大的颜色后取平均色。
        """
        h, w, _ = image_np.shape

        # 确保采样区域高度不超过图像高度
        sample_height = min(10, h)

        # 从上边界向下取10个像素高的矩形区域
        top_region = image_np[0:sample_height, :, :]

        # 将采样区域重塑为像素列表
        pixels = top_region.reshape(-1, 3)

        if len(pixels) == 0:
            return (255, 255, 255)

        # 计算所有像素的平均颜色作为参考
        avg_color = np.mean(pixels, axis=0)

        # 计算每个像素与平均颜色的欧氏距离
        distances = np.sqrt(np.sum((pixels - avg_color) ** 2, axis=1))

        # 计算距离的统计信息
        mean_distance = np.mean(distances)
        std_distance = np.std(distances)

        # 设置阈值：排除距离超过平均值+1.5倍标准差的像素（颜色反差较大的）
        threshold = mean_distance + 1.5 * std_distance

        # 筛选距离在阈值内的像素
        valid_pixels = pixels[distances <= threshold]

        # 如果筛选后没有像素，则使用所有像素
        if len(valid_pixels) == 0:
            valid_pixels = pixels

        # 计算有效像素的平均颜色
        avg_r = int(np.mean(valid_pixels[:, 0]))
        avg_g = int(np.mean(valid_pixels[:, 1]))
        avg_b = int(np.mean(valid_pixels[:, 2]))

        return (avg_r, avg_g, avg_b)

    def parse_color(self, color_str):
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

    def crop_face_idphoto(self, 图像, 面部置信度, 人脸矫正, 填充模式, 脸部大小, 垂直偏移, 单位, 证件照宽, 证件照高, DPI, 尺寸限制, 自定义填充色="#364254"):
        """证件照裁剪主函数"""
        if not HAS_MEDIAPIPE:
            print("错误: mediapipe未安装，请先运行: pip install mediapipe")
            h, w = 图像.shape[1:3] if len(图像.shape) == 4 else 图像.shape[0:2]
            mask = torch.zeros((1, h, w), dtype=torch.float32)
            return (图像, 0, mask, DPI)

        # 转换输入图像
        if len(图像.shape) == 4:
            target_tensor = 图像[0]
        else:
            target_tensor = 图像

        target_np = (target_tensor.cpu().numpy() * 255.0).astype(np.uint8)
        if len(target_np.shape) == 3 and target_np.shape[2] == 3:
            target_np_rgb = target_np
        else:
            target_np_rgb = cv2.cvtColor(target_np, cv2.COLOR_BGR2RGB)

        original_h, original_w = target_np_rgb.shape[:2]

        # ===== 步骤0: 尺寸限制缩放 =====
        long_edge = max(original_w, original_h)
        if long_edge > 尺寸限制:
            scale_ratio = 尺寸限制 / long_edge
            new_w = int(original_w * scale_ratio)
            new_h = int(original_h * scale_ratio)

            target_pil_temp = Image.fromarray(target_np_rgb)
            target_pil_resized = target_pil_temp.resize((new_w, new_h), Image.Resampling.LANCZOS)
            target_np_rgb = np.array(target_pil_resized)
        else:
            pass

        # 转换为BGR用于人脸检测
        target_np_bgr = cv2.cvtColor(target_np_rgb, cv2.COLOR_RGB2BGR)

        # 检测人脸
        target_face = self.detect_face_with_mesh(target_np_bgr, 面部置信度)

        if target_face is None:
            print("警告: 未检测到人脸，返回原图。")
            h, w = target_np_rgb.shape[0], target_np_rgb.shape[1]
            mask = torch.zeros((1, h, w), dtype=torch.float32)
            if len(图像.shape) == 3:
                return (图像.unsqueeze(0), 0, mask, DPI)
            else:
                return (图像, 0, mask, DPI)

        # 获取填充颜色
        if 填充模式 == "自定义颜色":
            fill_color = self.parse_color(自定义填充色)
        else:
            fill_color = self.get_optimized_border_color(target_np_rgb)

        # 计算输出图像尺寸（像素）
        if 单位 == "厘米":
            output_width_px = int(round(证件照宽 * DPI / 2.54))
            output_height_px = int(round(证件照高 * DPI / 2.54))
        else:
            output_width_px = int(证件照宽)
            output_height_px = int(证件照高)

        # 获取关键点
        keypoints = target_face["keypoints"]

        # 获取双眼中心点
        if len(keypoints) >= 2:
            left_eye = keypoints[1]
            right_eye = keypoints[0]
            eyes_center_x = (left_eye[0] + right_eye[0]) // 2
            eyes_center_y = (left_eye[1] + right_eye[1]) // 2
            target_angle = self.calculate_rotation_angle(keypoints) if 人脸矫正 else 0
        else:
            eyes_center_x, eyes_center_y = target_face["center"]
            target_angle = 0
            print("警告: 无法获取双眼关键点，跳过人脸矫正。")

        # 转换为PIL图像
        target_pil = Image.fromarray(target_np_rgb)
        current_w, current_h = target_pil.size

        # 计算裁剪框尺寸
        face_width = target_face["face_width"]
        crop_width = int(face_width / 脸部大小)
        crop_height = int(crop_width * (output_height_px / output_width_px))

        # ===== 核心：以双眼中心为旋转中心 =====
        if abs(target_angle) > 0.1:
            # 画布大小 = 尺寸限制后的对角线长度 + 200
            diagonal = math.sqrt(current_w**2 + current_h**2)
            canvas_size = int(diagonal) + 200

            # 创建画布
            if target_pil.mode == 'RGBA':
                canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
            else:
                canvas = Image.new('RGB', (canvas_size, canvas_size), fill_color)

            # 将原图放置在画布上，使眼睛中心点位于画布中心
            paste_x = canvas_size // 2 - eyes_center_x
            paste_y = canvas_size // 2 - eyes_center_y
            canvas.paste(target_pil, (paste_x, paste_y))

            # 创建原图区域mask（255=原图区域，0=填充区域）
            original_mask = np.zeros((canvas_size, canvas_size), dtype=np.uint8)
            original_mask[paste_y:paste_y+current_h, paste_x:paste_x+current_w] = 255

            # 旋转中心 = 画布中心 = 眼睛中心点
            canvas_center_x = canvas_size // 2
            canvas_center_y = canvas_size // 2

            # 旋转图像（以眼睛中心点为旋转中心）
            rotated_canvas = canvas.rotate(
                -target_angle,
                center=(canvas_center_x, canvas_center_y),
                expand=False,
                resample=Image.BICUBIC,
                fillcolor=fill_color
            )

            # 旋转mask
            original_mask_pil = Image.fromarray(original_mask, mode='L')
            rotated_mask = original_mask_pil.rotate(
                -target_angle,
                center=(canvas_center_x, canvas_center_y),
                expand=False,
                resample=Image.NEAREST,
                fillcolor=0
            )

            # 二值化mask确保清晰边界
            rotated_mask_array = np.array(rotated_mask)
            rotated_mask_array = (rotated_mask_array > 127).astype(np.uint8) * 255

            # 旋转后，眼睛中心点仍然在画布中心
            current_image = rotated_canvas
            current_mask = rotated_mask_array
            current_eyes_x = canvas_center_x
            current_eyes_y = canvas_center_y
        else:
            # 不旋转
            current_image = target_pil
            current_mask = np.ones((current_h, current_w), dtype=np.uint8) * 255
            current_eyes_x = eyes_center_x
            current_eyes_y = eyes_center_y

        current_w, current_h = current_image.size

        # 计算裁剪位置
        crop_x = current_eyes_x - crop_width // 2
        crop_y = current_eyes_y - int(垂直偏移 * crop_height)

        # 检查是否需要扩展画布
        left_expand = max(0, -crop_x)
        right_expand = max(0, crop_x + crop_width - current_w)
        top_expand = max(0, -crop_y)
        bottom_expand = max(0, crop_y + crop_height - current_h)

        need_expansion = (left_expand > 0 or right_expand > 0 or top_expand > 0 or bottom_expand > 0)

        if need_expansion:
            # 对称扩展
            expand_x = max(left_expand, right_expand)
            expand_y = max(top_expand, bottom_expand)

            new_w = current_w + 2 * expand_x
            new_h = current_h + 2 * expand_y

            if current_image.mode == 'RGBA':
                expanded_image = Image.new('RGBA', (new_w, new_h), (0, 0, 0, 0))
            else:
                expanded_image = Image.new('RGB', (new_w, new_h), fill_color)
            expanded_image.paste(current_image, (expand_x, expand_y))

            expanded_mask = np.zeros((new_h, new_w), dtype=np.uint8)
            expanded_mask[expand_y:expand_y+current_h, expand_x:expand_x+current_w] = current_mask

            current_eyes_x += expand_x
            current_eyes_y += expand_y

            current_image = expanded_image
            current_mask = expanded_mask

        current_w, current_h = current_image.size

        # 确保裁剪框在图像范围内
        crop_x = current_eyes_x - crop_width // 2
        crop_y = current_eyes_y - int(垂直偏移 * crop_height)
        crop_x = max(0, min(current_w - crop_width, crop_x))
        crop_y = max(0, min(current_h - crop_height, crop_y))

        # 执行裁剪
        cropped_image = current_image.crop((crop_x, crop_y, crop_x + crop_width, crop_y + crop_height))
        cropped_mask = current_mask[crop_y:crop_y+crop_height, crop_x:crop_x+crop_width]

        # 生成最终mask：原图区域=0（黑色），填充区域=1（白色）
        final_mask_array = (cropped_mask < 128).astype(np.float32)

        # 检查是否有填充
        has_expansion = 1 if np.any(final_mask_array > 0.5) else 0

        # 缩放到输出尺寸
        if cropped_image.size != (output_width_px, output_height_px):
            result_pil = cropped_image.resize((output_width_px, output_height_px), Image.Resampling.LANCZOS)
            final_mask_pil = Image.fromarray((final_mask_array * 255).astype(np.uint8), mode='L')
            final_mask_pil = final_mask_pil.resize((output_width_px, output_height_px), Image.Resampling.NEAREST)
        else:
            result_pil = cropped_image
            final_mask_pil = Image.fromarray((final_mask_array * 255).astype(np.uint8), mode='L')

        # 处理RGBA图像
        if result_pil.mode == 'RGBA':
            if 填充模式 == "自定义颜色":
                bg_color = self.parse_color(自定义填充色)
            else:
                bg_color = self.get_optimized_border_color(target_np_rgb)

            bg_layer = Image.new('RGB', result_pil.size, bg_color)
            bg_layer.paste(result_pil, mask=result_pil.split()[3])
            result_pil = bg_layer
            has_expansion = 1

            mask_array = np.ones((result_pil.size[1], result_pil.size[0]), dtype=np.float32)
            final_mask_pil = Image.fromarray((mask_array * 255).astype(np.uint8), mode='L')

        # 转换为tensor
        result_np = np.array(result_pil).astype(np.float32) / 255.0
        result_tensor = torch.from_numpy(result_np)[None, ...]

        mask_np = np.array(final_mask_pil, dtype=np.float32) / 255.0
        mask_tensor = torch.from_numpy(mask_np)[None, ...]

        return (result_tensor, has_expansion, mask_tensor, DPI)


# 节点注册
NODE_CLASS_MAPPINGS = {
    "GuHai_IDPhotoCrop": GuHaiIDPhotoCrop
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHai_IDPhotoCrop": "孤海-证件照裁剪"
}
