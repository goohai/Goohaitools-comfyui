import math

import torch

import comfy.model_management
import comfy.utils
import node_helpers


MAX_IMAGES = 10
ROUND_TO = 32
MAX_RESOLUTION = 4096
MAX_SINGLE_SIDE_CROP = 64
MAX_REFERENCE_AREA = 2048 * 2048
REFERENCE_SIZE_OPTIONS = ["自动", "768", "1024", "1344", "1536", "2048"]
RESTORE_INFO_TYPE = "QWEN_IMAGE_21_GH_RESTORE_INFO"


def _valid_image(image):
    return isinstance(image, torch.Tensor) and image.ndim == 4 and image.shape[0] > 0 and image.shape[1] > 0 and image.shape[2] > 0


def _rounded_area_size(width, height, target_area):
    ratio = width / height
    target_width = max(ROUND_TO, round(math.sqrt(target_area * ratio) / ROUND_TO) * ROUND_TO)
    target_height = max(ROUND_TO, round(math.sqrt(target_area / ratio) / ROUND_TO) * ROUND_TO)
    return target_width, target_height


def _area_limited_size(width, height, max_area):
    """Return an aspect-preserving, 32-aligned size without enlarging small inputs."""
    width = max(1, int(width))
    height = max(1, int(height))
    max_area = max(ROUND_TO * ROUND_TO, min(int(max_area), MAX_REFERENCE_AREA))

    source_area = width * height
    if source_area <= max_area:
        target_width = max(ROUND_TO, (width // ROUND_TO) * ROUND_TO)
        target_height = max(ROUND_TO, (height // ROUND_TO) * ROUND_TO)
    else:
        scale = math.sqrt(max_area / source_area)
        target_width = max(ROUND_TO, min(width, round(width * scale / ROUND_TO) * ROUND_TO))
        target_height = max(ROUND_TO, min(height, round(height * scale / ROUND_TO) * ROUND_TO))

    # Rounding each axis independently can exceed the area limit. Reduce the
    # axis with the larger relative rounding error until the hard cap holds.
    while target_width * target_height > max_area:
        width_error = target_width / width
        height_error = target_height / height
        if width_error >= height_error and target_width > ROUND_TO:
            target_width -= ROUND_TO
        elif target_height > ROUND_TO:
            target_height -= ROUND_TO
        elif target_width > ROUND_TO:
            target_width -= ROUND_TO
        else:
            break

    return target_width, target_height


def _reference_area(ref_image_size, image_count, latent_width, latent_height):
    if ref_image_size != "自动":
        return min(int(ref_image_size) ** 2, MAX_REFERENCE_AREA)
    if image_count <= 2:
        return min(latent_width * latent_height, MAX_REFERENCE_AREA)
    if image_count <= 4:
        return 1024 * 1024
    return 768 * 768


def _resize_image(image, width, height, crop):
    if (image.shape[2], image.shape[1]) == (width, height):
        return image[:1]
    samples = image[:1].movedim(-1, 1)
    return comfy.utils.common_upscale(samples, width, height, "lanczos", crop).movedim(1, -1)


def _resize_contain_black(image, width, height):
    source_height, source_width = image.shape[1:3]
    scale = min(width / source_width, height / source_height)
    content_width = max(1, min(width, round(source_width * scale)))
    content_height = max(1, min(height, round(source_height * scale)))
    resized = _resize_image(image, content_width, content_height, "disabled")

    left = (width - content_width) // 2
    top = (height - content_height) // 2
    canvas = image.new_zeros((1, height, width, image.shape[-1]))
    if image.shape[-1] > 3:
        canvas[:, :, :, 3:] = 1.0
    canvas[:, top:top + content_height, left:left + content_width] = resized
    return canvas, {
        "canvas_width": width,
        "canvas_height": height,
        "content_left": left,
        "content_top": top,
        "content_width": content_width,
        "content_height": content_height,
        "padding_left": left,
        "padding_top": top,
        "padding_right": width - left - content_width,
        "padding_bottom": height - top - content_height,
        "fill_value": 0.0,
    }


def _valid_mask(mask):
    return isinstance(mask, torch.Tensor) and mask.ndim >= 2 and mask.numel() > 0 and mask.shape[-2] > 0 and mask.shape[-1] > 0


def _prepare_mask(mask, source_width, source_height):
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    mask = mask[:1].reshape((1, 1, mask.shape[-2], mask.shape[-1]))
    mask = mask.clamp(0.0, 1.0)
    if torch.count_nonzero(mask) == 0:
        # Both ComfyUI's empty 64x64 placeholder and a true all-black mask
        # mean that no local mask was supplied. Let the caller use the normal
        # full-image path instead of allocating or propagating a mask.
        return None
    if mask.shape[-2:] != (source_height, source_width):
        mask = comfy.utils.common_upscale(mask, source_width, source_height, "bilinear", "disabled")
    return mask.clamp(0.0, 1.0)


def _resize_mask(mask, width, height, crop):
    if mask.shape[-2:] == (height, width):
        return mask
    return comfy.utils.common_upscale(mask, width, height, "bilinear", crop).clamp(0.0, 1.0)


def _resize_mask_contain(mask, width, height, info):
    content_width = info["content_width"]
    content_height = info["content_height"]
    resized = _resize_mask(mask, content_width, content_height, "disabled")
    canvas = mask.new_zeros((1, 1, height, width))
    left = info["content_left"]
    top = info["content_top"]
    canvas[:, :, top:top + content_height, left:left + content_width] = resized
    return canvas


def _cover_crop_is_small(source_width, source_height, target_width, target_height):
    scale = max(target_width / source_width, target_height / source_height)
    overflow_x = max(0.0, source_width * scale - target_width) / 2.0
    overflow_y = max(0.0, source_height * scale - target_height) / 2.0
    return max(overflow_x, overflow_y) <= MAX_SINGLE_SIDE_CROP


def _prepare_vision_image(image):
    rgb = image[:, :, :, :3]
    if image.shape[-1] > 3:
        rgb = rgb * image[:, :, :, 3:4] + (1.0 - image[:, :, :, 3:4])
    return rgb


class TextEncodeQwenImage21GH:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": True}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": True}),
                "latent_width": ("INT", {"default": 1024, "min": ROUND_TO, "max": MAX_RESOLUTION, "step": ROUND_TO}),
                "latent_height": ("INT", {"default": 1024, "min": ROUND_TO, "max": MAX_RESOLUTION, "step": ROUND_TO}),
                "mode": (["裁剪", "填充"], {"default": "填充"}),
                "ref_image_size": (REFERENCE_SIZE_OPTIONS, {"default": "自动"}),
            },
            "optional": {
                "vae": ("VAE",),
                "mask": ("MASK", {"tooltip": "图1的局部采样遮罩：白色区域修改，黑色区域保护。"}),
                **{f"image_{index:02d}": ("IMAGE",) for index in range(1, MAX_IMAGES + 1)},
            },
        }

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", RESTORE_INFO_TYPE)
    RETURN_NAMES = ("positive", "negative", "latent", "info")
    FUNCTION = "encode"
    CATEGORY = "孤海工具箱/条件"
    DESCRIPTION = "Qwen Image 2.1 conditioning with stable reference slots and aspect-safe reference sizing."

    def encode(self, clip, prompt, negative_prompt, mode, latent_width, latent_height, vae=None, mask=None, ref_image_size="自动", **kwargs):
        if latent_width < ROUND_TO or latent_height < ROUND_TO or latent_width % ROUND_TO != 0 or latent_height % ROUND_TO != 0:
            raise ValueError("Text Encode Qwen Image 2.1 GH：latent 宽和高必须不小于 32，且为 32 的倍数。")

        images = {
            index: kwargs.get(f"image_{index:02d}")
            for index in range(1, MAX_IMAGES + 1)
            if _valid_image(kwargs.get(f"image_{index:02d}"))
        }

        if ref_image_size not in REFERENCE_SIZE_OPTIONS:
            ref_image_size = "自动"

        primary = images.get(1)
        target_area = _reference_area(ref_image_size, len(images), latent_width, latent_height)
        primary_matches_target = False
        if primary is not None:
            primary_matches_target = _cover_crop_is_small(
                primary.shape[2], primary.shape[1], latent_width, latent_height
            ) and latent_width * latent_height <= MAX_REFERENCE_AREA
            if not primary_matches_target and ref_image_size == "自动" and len(images) <= 2:
                # Preserve the original 1–2 image behavior: a far-aspect-ratio
                # primary reference establishes the shared rounded area for
                # the remaining reference images.
                primary_width, primary_height = _area_limited_size(
                    primary.shape[2], primary.shape[1], target_area
                )
                target_area = primary_width * primary_height

        images_vl = []
        ref_latents = []
        primary_latent = None
        prepared_mask = None
        restore_info = {
            "mode": "none",
            "canvas_width": latent_width,
            "canvas_height": latent_height,
            "content_left": 0,
            "content_top": 0,
            "content_width": latent_width,
            "content_height": latent_height,
            "padding_left": 0,
            "padding_top": 0,
            "padding_right": 0,
            "padding_bottom": 0,
            "fill_value": 0.0,
        }
        for index in range(1, MAX_IMAGES + 1):
            image = images.get(index)
            if image is None:
                continue
            if index == 1 and primary_matches_target:
                width, height = latent_width, latent_height
                if mode == "填充":
                    prepared, restore_info = _resize_contain_black(image, width, height)
                    restore_info["mode"] = "padding"
                else:
                    prepared = _resize_image(image, width, height, "center")
            else:
                width, height = _area_limited_size(image.shape[2], image.shape[1], target_area)
                crop = "center" if index == 1 else "disabled"
                prepared = _resize_image(image, width, height, crop)

            if index == 1 and _valid_mask(mask):
                source_mask = _prepare_mask(mask, image.shape[2], image.shape[1])
                if source_mask is not None:
                    if primary_matches_target and mode == "填充":
                        prepared_mask = _resize_mask_contain(source_mask, width, height, restore_info)
                    else:
                        mask_crop = "center" if index == 1 else "disabled"
                        prepared_mask = _resize_mask(source_mask, width, height, mask_crop)

            images_vl.append(_prepare_vision_image(prepared))
            if vae is not None:
                ref_latent = vae.encode(prepared)
                ref_latents.append(ref_latent)
                if index == 1 and primary_matches_target:
                    primary_latent = ref_latent

        keep_vision = len(ref_latents) == 0
        positive = clip.encode_from_tokens_scheduled(
            clip.tokenize(prompt, images=images_vl, keep_vision=keep_vision, prevent_empty_text=True)
        )
        negative = clip.encode_from_tokens_scheduled(
            clip.tokenize(negative_prompt, images=images_vl, keep_vision=keep_vision, prevent_empty_text=True)
        )
        if ref_latents:
            values = {"reference_latents": ref_latents}
            positive = node_helpers.conditioning_set_values(positive, values, append=True)
            negative = node_helpers.conditioning_set_values(negative, values, append=True)

        if primary_latent is None:
            primary_latent = torch.zeros(
                [1, 64, latent_height // 16, latent_width // 16],
                device=comfy.model_management.intermediate_device(),
            )
        latent = {"samples": primary_latent}
        if prepared_mask is not None and primary_matches_target and vae is not None:
            latent["noise_mask"] = prepared_mask
        return positive, negative, latent, restore_info


class RestoreQwenImage21GH:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "info": (RESTORE_INFO_TYPE,),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "restore"
    CATEGORY = "孤海工具箱/图像"
    DESCRIPTION = "Removes the black canvas added by Text Encode Qwen Image 2.1 GH fill mode."

    def restore(self, image, info):
        if not isinstance(info, dict) or info.get("mode") != "padding":
            return (image,)

        canvas_width = max(1, int(info["canvas_width"]))
        canvas_height = max(1, int(info["canvas_height"]))
        output_width = image.shape[2]
        output_height = image.shape[1]

        left = round(int(info["content_left"]) * output_width / canvas_width)
        top = round(int(info["content_top"]) * output_height / canvas_height)
        right = round((int(info["content_left"]) + int(info["content_width"])) * output_width / canvas_width)
        bottom = round((int(info["content_top"]) + int(info["content_height"])) * output_height / canvas_height)

        left = max(0, min(left, output_width - 1))
        top = max(0, min(top, output_height - 1))
        right = max(left + 1, min(right, output_width))
        bottom = max(top + 1, min(bottom, output_height))
        return (image[:, top:bottom, left:right, :],)


NODE_CLASS_MAPPINGS = {
    "TextEncodeQwenImage21GH": TextEncodeQwenImage21GH,
    "RestoreQwenImage21GH": RestoreQwenImage21GH,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "TextEncodeQwenImage21GH": "Qwen Image 2.1 文本编码 GH",
    "RestoreQwenImage21GH": "Restore Qwen Image 2.1 GH",
}
