import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont, ImageColor
import comfy
import os

def convert_units(value, unit, dpi):
    if value <= 0:
        return 0
    if unit == "厘米":
        return int(round(value * dpi / 2.54))
    elif unit == "英寸":
        return int(round(value * dpi))
    return int(round(value))

def get_font_list():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    font_dir = os.path.join(parent_dir, "fonts")
    font_list = []
    if os.path.exists(font_dir):
        for file in os.listdir(font_dir):
            if file.lower().endswith(('.ttf', '.otf')):
                font_list.append(file)
    return ["默认字体"] + font_list if font_list else ["默认字体"]

class MultiSizeLayoutNode_ZH:
    @classmethod
    def INPUT_TYPES(cls):
        font_list = get_font_list()
        return {
            "required": {
                "image": ("IMAGE", {"label": "输入图像"}),
                "单位": (["像素", "厘米", "英寸"], {"default": "厘米", "label": "单位"}),
                "画布宽度": ("FLOAT", {"default": 15.2, "min": 1, "max": 10000, "step": 0.1, "label": "画布宽度"}),
                "画布高度": ("FLOAT", {"default": 10.1, "min": 1, "max": 10000, "step": 0.1, "label": "画布高度"}),
                "分辨率": ("INT", {"default": 300, "min": 72, "max": 5000, "label": "分辨率"}),
                "——": ("STRING", {"default": "———————照片① ——————", "multiline": False}),
                "宽度1": ("FLOAT", {"default": 3.5, "min": 0.1, "step": 0.1, "label": "宽度"}),
                "高度1": ("FLOAT", {"default": 4.5, "min": 0.1, "step": 0.1, "label": "高度"}),
                "水平张数1": ("INT", {"default": 4, "min": 1, "label": "水平张数"}),
                "垂直张数1": ("INT", {"default": 2, "min": 1, "label": "垂直张数"}),
                "旋转1": ("BOOLEAN", {"default": False, "label": "旋转90度"}),
                "————": ("STRING", {"default": "———— 照片② ——————", "multiline": False}),
                "宽度2": ("FLOAT", {"default": 0, "min": 0, "step": 0.1, "label": "宽度"}),
                "高度2": ("FLOAT", {"default": 0, "min": 0, "step": 0.1, "label": "高度"}),
                "照片2排数": ("INT", {"default": 2, "min": 0, "label": "排数"}),
                "排列方向2": (["下", "右"], {"default": "右", "label": "排列方位"}),
                "旋转2": ("BOOLEAN", {"default": False, "label": "旋转90度"}),
                "———": ("STRING", {"default": "———— 照片③ ——————", "multiline": False}),
                "宽度3": ("FLOAT", {"default": 0, "min": 0, "step": 0.1, "label": "宽度"}),
                "高度3": ("FLOAT", {"default": 0, "min": 0, "step": 0.1,"label": "高度"}),
                "照片3排数": ("INT", {"default": 2, "min": 0, "label": "排数"}),
                "排列方向3": (["下", "右"], {"default": "下", "label": "排列方位"}),
                "旋转3": ("BOOLEAN", {"default": False, "label": "旋转90度"}),
                "—————": ("STRING", {"default": "————————————", "multiline": False}),
                "照片间距": ("INT", {"default": 10, "min": 0, "max": 100, "label": "照片间距"}),
                "描边宽度": ("INT", {"default": 1, "min": 0, "max": 50, "label": "描边像素"}),
                "描边颜色": ("COLOR", {"default": "#000000", "label": "描边颜色"}),
                "文件名": ("STRING", {"default": "", "multiline": False, "label": "文件名"}),
                "字体": (get_font_list(), {"default": "默认字体", "label": "字体"}),
                "文字大小": ("INT", {"default": 0, "min": 0, "max": 100, "label": "文字大小"}),
                "文字颜色": ("COLOR", {"default": "#000000", "label": "文字颜色"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "layout_images"
    CATEGORY = "孤海工具箱"

    def layout_images(self, **kwargs):
        unit = kwargs["单位"]
        dpi = kwargs["分辨率"]
        canvas_w = convert_units(kwargs["画布宽度"], unit, dpi)
        canvas_h = convert_units(kwargs["画布高度"], unit, dpi)
        
        img = tensor2pil(kwargs["image"])
        regions = []
        self.prev_groups = []

        # 处理照片组
        group1_regions = self.process_photo_group(img, kwargs, 1, {'x':0,'y':0})
        regions += group1_regions
        if group1_regions:
            self.prev_groups.append(self.get_group_boundary(group1_regions))

        for group_num in [2, 3]:
            if kwargs[f"宽度{group_num}"] > 0 and kwargs[f"高度{group_num}"] > 0:
                group_regions = self.process_secondary_group(img, kwargs, group_num, self.prev_groups)
                if group_regions:
                    regions += group_regions
                    self.prev_groups.append(self.get_group_boundary(group_regions))

        # 文字处理优化
        if kwargs["文字大小"] > 0 and kwargs["文件名"].strip() != "":
            font_size = int(canvas_h * kwargs["文字大小"] / 1000)
            spacing = int(canvas_h * 0.01)
            text_color = ImageColor.getrgb(kwargs["文字颜色"])
            
            # 加载字体
            if kwargs["字体"] != "默认字体":
                current_dir = os.path.dirname(os.path.abspath(__file__))
                parent_dir = os.path.dirname(current_dir)
                font_path = os.path.join(parent_dir, "fonts", kwargs["字体"])
                try:
                    font = ImageFont.truetype(font_path, font_size)
                except:
                    font = ImageFont.load_default()
            else:
                font = ImageFont.load_default()

            # 精确计算文字尺寸
            try:
                ascent, descent = font.getmetrics()
                bbox = font.getbbox(kwargs["文件名"])
                text_w = bbox[2] - bbox[0]
                text_h = ascent + descent  # 包含字体下降部分
            except:
                text_w, text_h = font.getsize(kwargs["文件名"])

            # 创建透明文字图层
            text_img = Image.new("RGBA", (text_w, text_h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(text_img)
            
            # 精确文字定位
            try:
                draw.text((0, -bbox[1]), kwargs["文件名"], font=font, fill=text_color)
            except:
                draw.text((0, 0), kwargs["文件名"], font=font, fill=text_color)

            # 计算文字位置
            if regions:
                # 获取所有照片组的整体边界
                all_min_x = min(r[0] for r in regions)
                all_max_x = max(r[2] for r in regions)
                all_max_y = max(r[3] for r in regions)
                
                text_x = all_min_x + (all_max_x - all_min_x - text_w) // 2  # 相对照片组水平居中
                text_y = all_max_y + spacing
            else:
                text_x = (canvas_w - text_w) // 2
                text_y = spacing

            regions.append((text_x, text_y, text_x + text_w, text_y + text_h, text_img))

        # 创建最终画布并设置DPI
        canvas = self.center_all(canvas_w, canvas_h, regions)
        canvas = canvas.convert("RGB")
        canvas.info['dpi'] = (dpi, dpi)
        
        return (pil2tensor(canvas), )

    def get_group_boundary(self, regions):
        min_x = min(r[0] for r in regions)
        max_x = max(r[2] for r in regions)
        min_y = min(r[1] for r in regions)
        max_y = max(r[3] for r in regions)
        return (min_x, min_y, max_x, max_y)

    def process_photo_group(self, img, kwargs, group_num, start_pos):
        stroke_width = kwargs["描边宽度"]
        spacing = kwargs["照片间距"]
        effective_spacing = spacing if spacing != 0 else -stroke_width

        orig_width = convert_units(kwargs[f"宽度{group_num}"], kwargs["单位"], kwargs["分辨率"])
        orig_height = convert_units(kwargs[f"高度{group_num}"], kwargs["单位"], kwargs["分辨率"])
        rotate = kwargs[f"旋转{group_num}"]
        
        if orig_width <= 0 or orig_height <= 0:
            return []

        cropped = self.center_crop(img, orig_width, orig_height)
        if rotate:
            rotated = cropped.rotate(90, expand=True)
            actual_width, actual_height = rotated.size
        else:
            rotated = cropped
            actual_width, actual_height = orig_width, orig_height

        if kwargs["描边宽度"] > 0:
            self.add_stroke(rotated, stroke_width, kwargs["描边颜色"])

        h_num = max(0, kwargs[f"水平张数{group_num}"])
        v_num = max(0, kwargs[f"垂直张数{group_num}"])

        positions = []
        for row in range(v_num):
            for col in range(h_num):
                x = start_pos['x'] + col * (actual_width + effective_spacing)
                y = start_pos['y'] + row * (actual_height + effective_spacing)
                positions.append((
                    int(x), 
                    int(y), 
                    int(x + actual_width), 
                    int(y + actual_height), 
                    rotated.copy()
                ))
        return positions

    def process_secondary_group(self, img, kwargs, group_num, prev_groups):
        stroke_width = kwargs["描边宽度"]
        spacing = kwargs["照片间距"]
        effective_spacing = spacing if spacing != 0 else -stroke_width

        direction = kwargs[f"排列方向{group_num}"]
        orig_width = convert_units(kwargs[f"宽度{group_num}"], kwargs["单位"], kwargs["分辨率"])
        orig_height = convert_units(kwargs[f"高度{group_num}"], kwargs["单位"], kwargs["分辨率"])
        rotate = kwargs[f"旋转{group_num}"]
        row_col_num = kwargs[f"照片{group_num}排数"]

        if orig_width <= 0 or orig_height <= 0 or row_col_num <= 0:
            return []

        cropped = self.center_crop(img, orig_width, orig_height)
        if rotate:
            rotated = cropped.rotate(90, expand=True)
            actual_width, actual_height = rotated.size
        else:
            rotated = cropped
            actual_width, actual_height = orig_width, orig_height

        if kwargs["描边宽度"] > 0:
            self.add_stroke(rotated, stroke_width, kwargs["描边颜色"])

        if not prev_groups:
            return []
        
        ref_min_x = min(g[0] for g in prev_groups)
        ref_max_x = max(g[2] for g in prev_groups)
        ref_min_y = min(g[1] for g in prev_groups)
        ref_max_y = max(g[3] for g in prev_groups)

        positions = []
        if direction == "右":
            available_height = ref_max_y - ref_min_y
            rows = available_height // (actual_height)
            cols = row_col_num

            if rows > 0 and cols > 0:
                total_height = rows * actual_height
                remaining_space = available_height - total_height
                spacing_adjusted = remaining_space / (rows - 1) if rows > 1 else 0

                start_x = ref_max_x + effective_spacing
                for col in range(cols):
                    x = start_x + col * (actual_width + effective_spacing)
                    for row in range(rows):
                        y = ref_min_y + row * (actual_height + spacing_adjusted)
                        positions.append((
                            int(x),
                            int(y),
                            int(x + actual_width),
                            int(y + actual_height),
                            rotated.copy()
                        ))
        else:
            available_width = ref_max_x - ref_min_x
            cols = available_width // (actual_width)
            rows = row_col_num

            if rows > 0 and cols > 0:
                total_width = cols * actual_width
                remaining_space = available_width - total_width
                spacing_adjusted = remaining_space / (cols - 1) if cols > 1 else 0

                start_y = ref_max_y + effective_spacing
                for row in range(rows):
                    y = start_y + row * (actual_height + effective_spacing)
                    for col in range(cols):
                        x = ref_min_x + col * (actual_width + spacing_adjusted)
                        positions.append((
                            int(x),
                            int(y),
                            int(x + actual_width),
                            int(y + actual_height),
                            rotated.copy()
                        ))

        return positions

    def center_crop(self, img, target_w, target_h):
        if target_w <= 0 or target_h <= 0:
            return img
            
        img_w, img_h = img.size
        target_ratio = target_w / target_h
        img_ratio = img_w / img_h

        if img_ratio < target_ratio:
            scale_w = target_w
            scale_h = int(target_w / img_ratio)
        else:
            scale_h = target_h
            scale_w = int(target_h * img_ratio)

        scaled_img = img.resize((scale_w, scale_h), Image.LANCZOS)
        left = (scale_w - target_w) // 2
        top = (scale_h - target_h) // 10
        return scaled_img.crop((left, top, left + target_w, top + target_h))

    def add_stroke(self, image, width, color):
        if width == 0:
            return
        draw = ImageDraw.Draw(image)
        draw.rectangle(
            [(0, 0), (image.width-1, image.height-1)],
            outline=color,
            width=width
        )

    def center_all(self, canvas_w, canvas_h, regions):
        if not regions:
            return Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))

        min_x = min(r[0] for r in regions)
        max_x = max(r[2] for r in regions)
        min_y = min(r[1] for r in regions)
        max_y = max(r[3] for r in regions)

        content_width = max_x - min_x
        content_height = max_y - min_y
        offset_x = (canvas_w - content_width) // 2 - min_x
        offset_y = (canvas_h - content_height) // 2 - min_y

        canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
        for x1, y1, x2, y2, img in regions:
            if img.mode == 'RGBA':
                canvas.paste(img, (x1 + offset_x, y1 + offset_y), img)
            else:
                canvas.paste(img, (x1 + offset_x, y1 + offset_y))

        return canvas

def tensor2pil(image):
    if isinstance(image, torch.Tensor):
        image = image.cpu().numpy()
    return Image.fromarray(np.clip(255. * image[0], 0, 255).astype(np.uint8))

def pil2tensor(image):
    array = np.array(image).astype(np.float32) / 255.0
    return torch.from_numpy(array)[None,]

NODE_CLASS_MAPPINGS = {
    "MultiSizeLayoutNode_ZH": MultiSizeLayoutNode_ZH
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiSizeLayoutNode_ZH": "孤海-多尺寸混合排版"
}