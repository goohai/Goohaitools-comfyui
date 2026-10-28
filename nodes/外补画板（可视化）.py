"""可视化外补画板：独立处理图像、遮罩和最终输出尺寸。"""
import json
import math

import torch
import torch.nn.functional as F
from PIL import ImageColor


def _nearest(value):
    return math.floor(value + 0.5)


def _output_geometry(width, height, pads, maximum, multiple):
    """与前端 outputGeometry 保持一致；有外补时仅裁剪外补区域。"""
    total_w = width + pads[0] + pads[1]
    total_h = height + pads[2] + pads[3]
    scale = min(1, maximum / max(total_w, total_h)) if maximum > 0 else 1
    horizontal = pads[0] + pads[1] > 0
    vertical = pads[2] + pads[3] > 0
    if multiple > 0 and horizontal != vertical:
        # 没有外补的轴通过统一缩放取整，另一轴只调整外补色块。
        base = total_h if horizontal else total_w
        target = max(multiple, _nearest(base * scale / multiple) * multiple)
        if maximum > 0 and target / base * max(total_w, total_h) > maximum:
            target = math.floor(base * scale / multiple) * multiple
        if target > 0:
            scale = target / base
    elif multiple > 0 and not horizontal and not vertical:
        scale = max(scale, multiple / min(total_w, total_h))
    scaled_w = max(1, _nearest(total_w * scale))
    scaled_h = max(1, _nearest(total_h * scale))
    adjustments = [0, 0, 0, 0]
    if multiple > 0:
        for first, second, total, original in ((0, 1, scaled_w, total_w), (2, 3, scaled_h, total_h)):
            pad_total = pads[first] + pads[second]
            if not pad_total:
                if not horizontal and not vertical:
                    delta = max(multiple, math.floor(total / multiple) * multiple) - total
                    adjustments[first] = -((-delta) // 2)
                    adjustments[second] = delta - adjustments[first]
                continue
            # 使用实际整数缩放尺寸计算安全裁剪量，确保不碰原图。
            safe_first = math.floor(pads[first] * total / original)
            safe_second = math.floor(pads[second] * total / original)
            minimum = math.ceil((total - safe_first - safe_second) / multiple) * multiple
            target = max(multiple, minimum, _nearest(total / multiple) * multiple)
            delta = target - total
            amount = _nearest(abs(delta) * pads[first] / pad_total)
            if delta < 0:
                amount = max(abs(delta) - safe_second, min(safe_first, amount))
            adjustments[first] = -amount if delta < 0 else amount
            adjustments[second] = delta - adjustments[first]
    return {
        "scaled_w": scaled_w, "scaled_h": scaled_h,
        "width": scaled_w + adjustments[0] + adjustments[1],
        "height": scaled_h + adjustments[2] + adjustments[3],
        "adjustments": adjustments,
    }


class 孤海外补画板可视化:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "单位": (["像素", "百分比"], {"default": "百分比"}),
                "左": ("INT", {"default": 0, "min": 0, "max": 3000}),
                "右": ("INT", {"default": 0, "min": 0, "max": 3000}),
                "上": ("INT", {"default": 0, "min": 0, "max": 3000}),
                "下": ("INT", {"default": 0, "min": 0, "max": 3000}),
                "最大输出长边": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 128}),
                "整除数": ([0, 8, 16, 32, 64], {"default": 0}),
                "外补颜色": ("GHCOLOR", {"default": "#808080"}),
            },
            "optional": {
                "遮罩": ("MASK",),
                "gh_visual_ratio": ("STRING", {"default": "自由比例", "socketless": True}),
                "gh_visual_layout": ("STRING", {"default": "", "socketless": True}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "BOOLEAN")
    RETURN_NAMES = ("图像", "遮罩", "外补是否存在")
    FUNCTION = "处理"
    CATEGORY = "孤海工具箱"

    def 处理(self, 图像, 单位, 左, 右, 上, 下, 最大输出长边, 整除数,
           遮罩=None, 外补颜色="#808080", gh_visual_ratio="自由比例", gh_visual_layout=""):
        batch, height, width, channels = 图像.shape
        raw = [左, 右, 上, 下]
        pads = [max(0, int(value * (width if index < 2 else height) / 100)
                    if 单位 == "百分比" else int(value))
                for index, value in enumerate(raw)]
        try:
            layout = json.loads(gh_visual_layout)
            exact = layout["pads"]
            if (layout["signature"] == [width, height, 单位, *raw]
                    and len(exact) == 4
                    and all(isinstance(v, (int, float)) and math.isfinite(v) and v >= 0 for v in exact)):
                pads = [_nearest(v) for v in exact]
        except (ValueError, TypeError, KeyError):
            pass
        ratios = {"1:1", "2:3", "3:2", "3:4", "4:3", "5:7", "9:16", "16:9", "21:9", "1:2", "2:1"}
        if gh_visual_ratio in ratios:
            rw, rh = map(int, gh_visual_ratio.split(":"))
            common = math.gcd(rw, rh)
            rw, rh = rw // common, rh // common
            factor = math.ceil(max((width + pads[0] + pads[1]) / rw,
                                   (height + pads[2] + pads[3]) / rh))
            for start, end, total in ((0, 1, rw * factor - width), (2, 3, rh * factor - height)):
                old_total = pads[start] + pads[end]
                first = _nearest(total * pads[start] / old_total) if old_total else total // 2
                pads[start], pads[end] = first, total - first

        geometry = _output_geometry(width, height, pads, 最大输出长边, 整除数)
        left, right, top, bottom = pads
        color = 图像.new_ones(channels)
        color[:min(3, channels)] = 图像.new_tensor(ImageColor.getrgb(外补颜色)[:min(3, channels)]) / 255
        image = color.expand(batch, height + top + bottom, width + left + right, channels).clone()
        image[:, top:top + height, left:left + width] = 图像
        if 遮罩 is None:
            source_mask = 图像.new_zeros((batch, height, width))
        else:
            source_mask = 遮罩.to(device=图像.device, dtype=图像.dtype)
            if source_mask.ndim == 2:
                source_mask = source_mask.unsqueeze(0)
            if source_mask.shape[-2:] != (height, width):
                source_mask = F.interpolate(source_mask.unsqueeze(1), size=(height, width),
                                            mode="bilinear", align_corners=False).squeeze(1)
            indices = torch.arange(batch, device=图像.device).clamp(max=source_mask.shape[0] - 1)
            source_mask = source_mask[indices]
            image[:, top:top + height, left:left + width] = torch.lerp(
                图像, color, source_mask.clamp(0, 1).unsqueeze(-1))
        mask = 图像.new_ones((batch, height + top + bottom, width + left + right))
        mask[:, top:top + height, left:left + width] = source_mask

        size = (geometry["scaled_h"], geometry["scaled_w"])
        if image.shape[1:3] != size:
            image = F.interpolate(image.movedim(-1, 1), size=size, mode="bilinear",
                                  align_corners=False, antialias=True).movedim(1, -1)
            mask = F.interpolate(mask.unsqueeze(1), size=size, mode="bilinear",
                                 align_corners=False, antialias=True).squeeze(1)
        left, right, top, bottom = geometry["adjustments"]
        image = image[:, max(0, -top):size[0] - max(0, -bottom), max(0, -left):size[1] - max(0, -right)]
        mask = mask[:, max(0, -top):size[0] - max(0, -bottom), max(0, -left):size[1] - max(0, -right)]
        if any(value > 0 for value in (left, right, top, bottom)):
            output = color.expand(batch, geometry["height"], geometry["width"], channels).clone()
            output_mask = mask.new_ones((batch, geometry["height"], geometry["width"]))
            x, y = max(0, left), max(0, top)
            output[:, y:y + image.shape[1], x:x + image.shape[2]] = image
            output_mask[:, y:y + mask.shape[1], x:x + mask.shape[2]] = mask
            image, mask = output, output_mask
        return image, mask, any(pads)


NODE_CLASS_MAPPINGS = {"孤海外补画板可视化": 孤海外补画板可视化}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海外补画板可视化": "外补画板（可视化）"}
