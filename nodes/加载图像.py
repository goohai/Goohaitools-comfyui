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
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "optional": {
                "保留透明通道": ("BOOLEAN", {
                    "default": False,
                    "label_on": "开",
                    "label_off": "关",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("图像", "遮罩", "文件名")
    FUNCTION = "load_image"
    CATEGORY = "image"

    @staticmethod
    def _fix_orientation(img):
        try:
            return ImageOps.exif_transpose(img)
        except Exception:
            return img

    @staticmethod
    def _composite_on_white(rgba_img):
        background = Image.new("RGB", rgba_img.size, (255, 255, 255))
        background.paste(rgba_img, mask=rgba_img.split()[3])
        return background

    @classmethod
    def _find_by_pixel_match(cls, image_str):
        clean = str(image_str).split("[")[0].strip()
        base_name = os.path.basename(clean)
        painted_name = base_name.replace("painted-masked", "painted")
        clipspace_dir = os.path.join(folder_paths.get_input_directory(), "clipspace")
        painted_path = os.path.join(clipspace_dir, painted_name)

        if not os.path.exists(painted_path):
            return None

        try:
            with Image.open(painted_path) as painted_img:
                painted_size = painted_img.size
                painted_np = np.array(painted_img.convert("RGB"))
        except Exception:
            return None

        input_dir = folder_paths.get_input_directory()
        try:
            entries = sorted(
                [
                    f for f in os.listdir(input_dir)
                    if os.path.isfile(os.path.join(input_dir, f))
                    and not f.startswith(".")
                ],
                key=lambda x: os.path.getmtime(os.path.join(input_dir, x)),
                reverse=True,
            )
        except Exception:
            return None

        for filename in entries:
            path = os.path.join(input_dir, filename)
            try:
                with Image.open(path) as img:
                    if img.size != painted_size:
                        continue
                    img_np = np.array(img.convert("RGB"))
                    if np.array_equal(img_np, painted_np):
                        return os.path.splitext(filename)[0]
            except Exception:
                continue

        return None

    @classmethod
    def _find_by_mtime(cls, image_str):
        base = os.path.basename(str(image_str).split("[")[0].strip())
        name = os.path.splitext(base)[0]
        parts = name.split("-")
        try:
            ts_ms = int(parts[-1])
        except (ValueError, IndexError):
            return None

        clipspace_ts = ts_ms / 1000.0
        input_dir = folder_paths.get_input_directory()
        best_file = None
        best_mtime = -1

        for filename in os.listdir(input_dir):
            path = os.path.join(input_dir, filename)
            if not os.path.isfile(path) or filename.startswith("."):
                continue
            mtime = os.path.getmtime(path)
            if mtime <= clipspace_ts and mtime > best_mtime:
                best_mtime = mtime
                best_file = filename

        return os.path.splitext(best_file)[0] if best_file else None

    @classmethod
    def _find_original_filename(cls, image_str):
        name = cls._find_by_pixel_match(image_str)
        if name:
            return name
        return cls._find_by_mtime(image_str)

    def load_image(self, image, 保留透明通道=False):
        image_path = folder_paths.get_annotated_filepath(image)
        is_clipspace = "[input]" in str(image)

        clipspace_mask_img = None
        if is_clipspace:
            clipspace_dir = os.path.dirname(image_path)
            base_name = os.path.basename(image_path)
            original_name = base_name.replace("painted-masked", "painted")
            original_path = os.path.join(clipspace_dir, original_name)

            if os.path.exists(original_path):
                img = node_helpers.pillow(Image.open, original_path)
                clipspace_mask_img = node_helpers.pillow(Image.open, image_path)
                clipspace_mask_img = self._fix_orientation(clipspace_mask_img)
            else:
                img = node_helpers.pillow(Image.open, image_path)
        else:
            img = node_helpers.pillow(Image.open, image_path)

        img = self._fix_orientation(img)

        if is_clipspace:
            filename = self._find_original_filename(image)
            if not filename:
                filename = os.path.splitext(
                    os.path.basename(str(image).split("[")[0].strip())
                )[0]
        else:
            filename = os.path.splitext(os.path.basename(image))[0]

        clipspace_mask = None
        if clipspace_mask_img is not None and "A" in clipspace_mask_img.getbands():
            mask_np = (
                np.array(clipspace_mask_img.getchannel("A")).astype(np.float32)
                / 255.0
            )
            clipspace_mask = torch.from_numpy(1.0 - mask_np)

        output_images = []
        output_masks = []
        w, h = None, None
        excluded_formats = ["MPO"]

        for frame_img in ImageSequence.Iterator(img):
            frame_img = self._fix_orientation(
                node_helpers.pillow(ImageOps.exif_transpose, frame_img)
            )
            if frame_img.mode == "I":
                frame_img = frame_img.point(lambda p: p * (1 / 255))

            has_alpha = "A" in frame_img.getbands()
            if 保留透明通道 and has_alpha:
                frame = frame_img.convert("RGBA")
            elif has_alpha:
                frame = self._composite_on_white(frame_img.convert("RGBA"))
            else:
                frame = frame_img.convert("RGB")

            if not output_images:
                w, h = frame.size
            if frame.size[0] != w or frame.size[1] != h:
                continue

            image_np = np.array(frame).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]

            if clipspace_mask is not None:
                mask = clipspace_mask
            elif has_alpha:
                mask_np = (
                    np.array(frame_img.getchannel("A")).astype(np.float32)
                    / 255.0
                )
                mask = torch.from_numpy(1.0 - mask_np)
            else:
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
    def IS_CHANGED(cls, image, 保留透明通道=False):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, 保留透明通道=False):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


NODE_CLASS_MAPPINGS = {
    "LoadImageGoohai": LoadImageGoohai,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageGoohai": "加载图像 孤海",
}
