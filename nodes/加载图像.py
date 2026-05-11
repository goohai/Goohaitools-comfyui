import os
import hashlib
import folder_paths
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
import node_helpers


class LoadImageGoohai:
    _images_directory = "input"

    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir)
                 if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "optional": {
                "保留透明通道": ("BOOLEAN", {
                    "default": False,
                    "label_on": "开",
                    "label_off": "关"
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("图像", "遮罩", "文件名")
    FUNCTION = "load_image"
    CATEGORY = "image"

    # ========== 自动修正 EXIF 方向 ==========
    @staticmethod
    def _fix_orientation(img):
        try:
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass
        return img

    # ========== 将 RGBA 合成到白色背景上 ==========
    @staticmethod
    def _composite_on_white(rgba_img):
        background = Image.new("RGB", rgba_img.size, (255, 255, 255))
        background.paste(rgba_img, mask=rgba_img.split()[3])
        return background

    # ========== 像素比对查找原始文件名 ==========
    @classmethod
    def _find_by_pixel_match(cls, image_str):
        clean = str(image_str).split('[')[0].strip()
        base_name = os.path.basename(clean)
        painted_name = base_name.replace('painted-masked', 'painted')
        clipspace_dir = os.path.join(
            folder_paths.get_input_directory(), 'clipspace')
        painted_path = os.path.join(clipspace_dir, painted_name)

        if not os.path.exists(painted_path):
            return None

        try:
            painted_img = Image.open(painted_path)
            painted_size = painted_img.size
            painted_np = np.array(painted_img.convert('RGB'))
            painted_img.close()
        except Exception:
            return None

        input_dir = folder_paths.get_input_directory()
        try:
            entries = sorted(
                [f for f in os.listdir(input_dir)
                 if os.path.isfile(os.path.join(input_dir, f))
                 and not f.startswith('.')],
                key=lambda x: os.path.getmtime(os.path.join(input_dir, x)),
                reverse=True
            )
        except Exception:
            return None

        for f in entries:
            fpath = os.path.join(input_dir, f)
            try:
                with Image.open(fpath) as img:
                    if img.size != painted_size:
                        continue
                    img_np = np.array(img.convert('RGB'))
                    if np.array_equal(img_np, painted_np):
                        return os.path.splitext(f)[0]
            except Exception:
                continue

        return None

    # ========== 时间戳推断（兜底） ==========
    @classmethod
    def _find_by_mtime(cls, image_str):
        base = os.path.basename(str(image_str).split('[')[0].strip())
        name = os.path.splitext(base)[0]
        parts = name.split('-')
        try:
            ts_ms = int(parts[-1])
        except (ValueError, IndexError):
            return None

        clipspace_ts = ts_ms / 1000.0
        input_dir = folder_paths.get_input_directory()
        best_file = None
        best_mtime = -1

        for f in os.listdir(input_dir):
            fpath = os.path.join(input_dir, f)
            if not os.path.isfile(fpath) or f.startswith('.'):
                continue
            mtime = os.path.getmtime(fpath)
            if mtime <= clipspace_ts and mtime > best_mtime:
                best_mtime = mtime
                best_file = f

        return os.path.splitext(best_file)[0] if best_file else None

    # ========== 综合查找入口 ==========
    @classmethod
    def _find_original_filename(cls, image_str):
        name = cls._find_by_pixel_match(image_str)
        if name:
            return name
        return cls._find_by_mtime(image_str)

    # ========== 主逻辑 ==========
    def load_image(self, image, 保留透明通道=False):
        image_path = folder_paths.get_annotated_filepath(image)
        is_clipspace = '[input]' in str(image)

        # =====================================================
        #  Clipspace：分离图像源和遮罩源
        #  IMAGE ← clipspace-painted-{ts}     （原图）
        #  MASK  ← clipspace-painted-masked-{ts} 的 Alpha 通道
        # =====================================================
        clipspace_mask_img = None
        if is_clipspace:
            clipspace_dir = os.path.dirname(image_path)
            base_name = os.path.basename(image_path)
            # painted-masked → painted = 原图
            original_name = base_name.replace('painted-masked', 'painted')
            original_path = os.path.join(clipspace_dir, original_name)

            if os.path.exists(original_path):
                # 用原图作为 IMAGE 输出
                img = node_helpers.pillow(Image.open, original_path)
                # 用 masked 版本提取遮罩
                clipspace_mask_img = node_helpers.pillow(Image.open, image_path)
                clipspace_mask_img = self._fix_orientation(clipspace_mask_img)
            else:
                img = node_helpers.pillow(Image.open, image_path)
        else:
            img = node_helpers.pillow(Image.open, image_path)

        img = self._fix_orientation(img)

        # ---------- 文件名 ----------
        if is_clipspace:
            filename = self._find_original_filename(image)
            if not filename:
                filename = os.path.splitext(
                    os.path.basename(str(image).split('[')[0].strip())
                )[0]
        else:
            filename = os.path.splitext(os.path.basename(image))[0]

        # ---------- 预提取 Clipspace 遮罩 ----------
        clipspace_mask = None
        if clipspace_mask_img is not None:
            if 'A' in clipspace_mask_img.getbands():
                mask_np = np.array(
                    clipspace_mask_img.getchannel('A')
                ).astype(np.float32) / 255.0
                # 取反：透明区域 → 1（遮罩），不透明 → 0
                clipspace_mask = torch.from_numpy(1.0 - mask_np)

        # ---------- 逐帧处理 ----------
        output_images = []
        output_masks = []
        w, h = None, None
        excluded_formats = ['MPO']

        for i in ImageSequence.Iterator(img):
            i = self._fix_orientation(
                node_helpers.pillow(ImageOps.exif_transpose, i)
            )
            if i.mode == 'i':
                i = i.point(lambda p: p * (1 / 255))

            has_alpha = 'A' in i.getbands()

            if 保留透明通道 and has_alpha:
                frame = i.convert("RGBA")
            elif has_alpha:
                frame = self._composite_on_white(i.convert("RGBA"))
            else:
                frame = i.convert("RGB")

            if len(output_images) == 0:
                w, h = frame.size
            if frame.size[0] != w or frame.size[1] != h:
                continue

            image_np = np.array(frame).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]

            # 遮罩处理
            if clipspace_mask is not None:
                # 有手绘遮罩 → 用预提取的 clipspace 遮罩
                mask = clipspace_mask
            elif has_alpha:
                # 有透明通道 → 直接用 Alpha（与官方逻辑一致）
                mask_np = np.array(
                    i.getchannel('A')
                ).astype(np.float32) / 255.0
                mask = torch.from_numpy(mask_np)
            else:
                # 无透明通道 → 纯黑遮罩
                mask = torch.zeros(h, w, dtype=torch.float32, device="cpu")

            output_images.append(image_tensor)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in excluded_formats:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        return (output_image, output_mask, filename)

    @classmethod
    def IS_CHANGED(s, image, 保留透明通道=False):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, 'rb') as f:
            m.update(f.read())
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(s, image, 保留透明通道=False):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


# ==================== 注册 ====================
NODE_CLASS_MAPPINGS = {
    "LoadImageGoohai": LoadImageGoohai
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageGoohai": "加载图像 孤海"
}
