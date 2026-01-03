import cv2
import numpy as np
import torch
import dlib
import os
from math import atan2, degrees

class 孤海人脸自动矫正:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "开启人脸自动矫正": ("BOOLEAN", {"default": True}),
                "边缘裁剪": ("INT", {"default": 2, "min": 1, "max": 5, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("矫正后的图像",)
    FUNCTION = "process_image"
    CATEGORY = "孤海工具箱"

    def 完全旋转(self, img, angle):
        """执行完整图像旋转（不裁剪不填充）"""
        if angle == 90:
            return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        elif angle == 270:
            return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        elif angle == 180:
            return cv2.rotate(img, cv2.ROTATE_180)
        return img.copy()

    def 多角度检测(self, img):
        """改进的多角度检测（保持完整图像）"""
        for angle in [0, 90, 180, 270]:
            rotated = self.完全旋转(img, angle)
            gray = cv2.cvtColor(rotated, cv2.COLOR_BGR2GRAY)
            faces = self.人脸检测器(gray, 0)
            if len(faces) > 0:
                return rotated, angle
        return img, 0

    def process_image(self, **kwargs):
        图像 = kwargs["图像"]
        开启矫正 = kwargs["开启人脸自动矫正"]
        裁剪系数 = kwargs["边缘裁剪"]

        # 获取当前文件所在目录的上级目录
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        model_path = os.path.join(parent_dir, "shape_predictor_5_face_landmarks.dat")
        if not os.path.exists(model_path):
            return (图像, )

        self.人脸检测器 = dlib.get_frontal_face_detector()
        关键点检测器 = dlib.shape_predictor(model_path)

        output_images = []
        for img_tensor in 图像:
            try:
                if not 开启矫正:
                    output_images.append(img_tensor)
                    continue

                orig_img = (img_tensor.numpy() * 255).astype(np.uint8)
                orig_img = cv2.cvtColor(orig_img, cv2.COLOR_RGB2BGR)
                
                # 第一次完整旋转检测
                rotated_img, pre_angle = self.多角度检测(orig_img)
                current_img = rotated_img.copy()

                # 计算目标宽高比
                orig_h, orig_w = orig_img.shape[:2]
                if pre_angle in [90, 270]:
                    target_w, target_h = orig_h, orig_w
                else:
                    target_w, target_h = orig_w, orig_h

                # 角度矫正处理
                gray = cv2.cvtColor(current_img, cv2.COLOR_BGR2GRAY)
                faces = self.人脸检测器(gray, 0)
                a = 0  # 初始化裁剪角度
                if faces:
                    最大人脸 = max(faces, key=lambda rect: rect.width() * rect.height())
                    关键点 = 关键点检测器(current_img, 最大人脸)

                    # 计算眼部角度
                    左眼 = np.mean([(关键点.part(i).x, 关键点.part(i).y) for i in [2,3]], axis=0)
                    右眼 = np.mean([(关键点.part(i).x, 关键点.part(i).y) for i in [0,1]], axis=0)
                    dy = 右眼[1] - 左眼[1]
                    dx = 右眼[0] - 左眼[0]
                    eye_angle = degrees(atan2(dy, dx))

                    # 角度修正逻辑
                    if eye_angle > 45:
                        eye_angle -= 90
                    elif eye_angle < -45:
                        eye_angle += 90

                    # 执行旋转
                    (h, w) = current_img.shape[:2]
                    M = cv2.getRotationMatrix2D((w//2, h//2), eye_angle, 1)
                    current_img = cv2.warpAffine(
                        current_img, M, (w, h),
                        flags=cv2.INTER_LANCZOS4,
                        borderMode=cv2.BORDER_REPLICATE
                    )

                    # 计算裁剪角度a
                    a_abs = abs(eye_angle)
                    a_abs = a_abs % 90
                    if a_abs > 45:
                        a_abs = 90 - a_abs
                    a = a_abs

                # 中心裁剪
                final_h, final_w = current_img.shape[:2]
                y_start = max(0, (final_h - target_h) // 2)
                x_start = max(0, (final_w - target_w) // 2)
                final_img = current_img[y_start:y_start+target_h, x_start:x_start+target_w]

                # 根据角度a进行边缘裁剪
                if a > 0:
                    h_crop, w_crop = final_img.shape[:2]
                    crop_v = max(0, int(h_crop * (a ** 0.8) / 100 / 裁剪系数))
                    crop_h = max(0, int(w_crop * (a ** 0.8) / 100 / 裁剪系数))
                    
                    # 计算裁切后尺寸
                    new_h = h_crop - 2 * crop_v
                    new_w = w_crop - 2 * crop_h
                    
                    if new_h > 0 and new_w > 0:
                        final_img = final_img[crop_v:crop_v+new_h, crop_h:crop_h+new_w]

                # 转换回RGB
                final_image = cv2.cvtColor(final_img, cv2.COLOR_BGR2RGB)
                final_image = torch.from_numpy(final_image.astype(np.float32) / 255.0)
                output_images.append(final_image)
            except Exception as e:
                output_images.append(img_tensor)

        return (torch.stack(output_images), )

NODE_CLASS_MAPPINGS = {"孤海-人脸自动矫正": 孤海人脸自动矫正}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海-人脸自动矫正": "👤 孤海-人脸自动矫正"}