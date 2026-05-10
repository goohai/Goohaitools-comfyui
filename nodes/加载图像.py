import os
import hashlib
import folder_paths
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
import node_helpers


class LoadImageGoohai:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir)
                 if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "图像": (sorted(files), {"image_upload": True}),
                "保留透明通道": ("BOOLEAN", {"default": False, "label_on": "开", "label_off": "关"}),
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

    # ========== 主逻辑 ==========
    def load_image(self, 图像, 保留透明通道):
        image_path = folder_paths.get_annotated_filepath(图像)
        img = node_helpers.pillow(Image.open, image_path)

        # ① 自动修正 EXIF 方向
        img = self._fix_orientation(img)

        # ---------- 文件名（不含扩展名） ----------
        filename = os.path.splitext(os.path.basename(图像))[0]

        # ---------- 逐帧处理（兼容 GIF 等多帧格式） ----------
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

            # ② 根据「保留透明通道」开关决定输出格式
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


            if has_alpha:
                mask_np = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                mask = torch.from_numpy(mask_np)
            else:
                mask = torch.ones(h, w, dtype=torch.float32, device="cpu")

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
    def IS_CHANGED(s, 图像, 保留透明通道):
        image_path = folder_paths.get_annotated_filepath(图像)
        m = hashlib.sha256()
        with open(image_path, 'rb') as f:
            m.update(f.read())
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(s, 图像, 保留透明通道):
        if not folder_paths.exists_annotated_filepath(图像):
            return "Invalid image file: {}".format(图像)
        return True


# ==================== 注册 ====================
NODE_CLASS_MAPPINGS = {
    "LoadImageGoohai": LoadImageGoohai
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageGoohai": "加载图像 孤海"
}
