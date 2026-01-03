import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import folder_paths

class ImageMaskPreview_Guhai:
    """
    图像与遮罩预览 孤海节点
    输入一张图像和遮罩，在图像上叠加遮罩区域颜色和序号
    """

    @classmethod
    def INPUT_TYPES(cls):
        # 获取字体列表
        fonts = cls.get_fonts()

        return {
            "required": {
                "图像": ("IMAGE",),
                "遮罩": ("MASK",),
                "遮罩不透明": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1}),
                "遮罩颜色": ("COLORCODE", {"default": "#00ffff"}),
                "显示序号": ("BOOLEAN", {"default": False}),
                "序号不透明": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 1.0, "step": 0.1}),
                "序号缩放": (["跟随遮罩缩放", "固定大小"], {"default": "跟随遮罩缩放"}),
                "字号比例": ("FLOAT", {"default": 0.6, "min": 0.1, "max": 2.0, "step": 0.1}),
                "序号字体": (fonts, {"default": "苹方特粗.ttf"}),
                "序号颜色": ("COLORCODE", {"default": "#ffffff"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "preview"
    CATEGORY = "孤海工具箱"
    DESCRIPTION = "输入一张图像和遮罩批次，在图像上叠加每个遮罩区域的颜色和对应序号，可自定义叠加颜色和不透明度"


    @classmethod
    def get_fonts(cls):
        """获取字体目录下的字体列表"""
        try:
            # 获取当前节点所在目录的上层目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(current_dir)
            fonts_dir = os.path.join(parent_dir, "fonts")

            if not os.path.exists(fonts_dir):
                return ["default.ttf"]

            # 获取所有字体文件
            font_files = []
            for file in os.listdir(fonts_dir):
                if file.lower().endswith(('.ttf', '.otf', '.ttc')):
                    font_files.append(file)

            return font_files if font_files else ["default.ttf"]
        except:
            return ["default.ttf"]

    def hex_to_rgb(self, hex_color):
        """将十六进制颜色转换为RGB元组"""
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    def convert_to_binary_mask(self, mask):
        """将输入遮罩转换为二值化遮罩"""
        if isinstance(mask, torch.Tensor):
            mask = mask.cpu().numpy()

        # 确保是单通道
        if len(mask.shape) == 3:
            if mask.shape[0] == 1:  # [1, H, W]
                mask = mask[0]
            elif mask.shape[2] == 1:  # [H, W, 1]
                mask = mask[:, :, 0]
            else:  # 多通道，取平均值并二值化
                mask = np.mean(mask, axis=2)

        # 归一化到0-1范围
        if mask.max() > 1.0:
            mask = mask / 255.0

        # 二值化（阈值0.5）
        binary_mask = (mask > 0.5).astype(np.float32)
        return binary_mask

    def get_mask_center_and_size(self, binary_mask):
        """计算遮罩的中心点和尺寸"""
        # 找到遮罩的边界框
        rows = np.any(binary_mask, axis=1)
        cols = np.any(binary_mask, axis=0)

        if not np.any(rows) or not np.any(cols):
            return None, None, None, None  # 空遮罩

        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]

        # 计算中心点
        center_x = (cmin + cmax) // 2
        center_y = (rmin + rmax) // 2

        # 计算尺寸
        width = cmax - cmin
        height = rmax - rmin

        return center_x, center_y, width, height

    def get_text_metrics(self, draw, text, font):
        """获取文本的精确尺寸和基线信息"""
        try:
            # 新版本PIL使用textbbox
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            
            # 获取基线位置（近似计算）
            # 对于大多数字体，基线大约在文本高度的3/4位置
            baseline_offset = text_height * 0.75
            
            return text_width, text_height, baseline_offset
        except AttributeError:
            # 旧版本PIL使用textsize
            text_width, text_height = draw.textsize(text, font=font)
            # 近似基线位置
            baseline_offset = text_height * 0.75
            return text_width, text_height, baseline_offset

    def preview(self, 图像, 遮罩, 遮罩不透明, 遮罩颜色, 显示序号, 序号字体, 序号不透明, 序号缩放, 字号比例, 序号颜色):
        # 1. 处理输入图像 - 取第一张并转换为PIL
        if 图像.dim() == 4:  # 批次图像
            input_image = 图像[0]  # 取第一张
        else:
            input_image = 图像

        # 转换为numpy数组
        img_np = input_image.cpu().numpy()

        # 如果是RGBA，转换为RGB（透明部分转黑）
        if img_np.shape[2] == 4:
            # 将透明通道转换为黑色
            alpha = img_np[:, :, 3:4]
            rgb = img_np[:, :, :3]
            # 透明部分设为黑色
            img_np = rgb * alpha
            # 转换为0-255范围的uint8
            img_np = (img_np * 255).astype(np.uint8)
        else:
            img_np = (img_np * 255).astype(np.uint8)

        # 转换为PIL图像
        pil_image = Image.fromarray(img_np, mode='RGB')
        width, height = pil_image.size

        # 2. 处理遮罩 - 转换为二值化遮罩列表
        mask_list = []
        if 遮罩.dim() == 2:  # 单张遮罩 [H, W]
            mask_list.append(self.convert_to_binary_mask(遮罩))
        elif 遮罩.dim() == 3:  # 批次遮罩 [B, H, W] 或 [H, W, C]
            if 遮罩.shape[0] == 1:  # 只有一张
                mask_list.append(self.convert_to_binary_mask(遮罩[0]))
            else:  # 多张
                for i in range(遮罩.shape[0]):
                    mask_list.append(self.convert_to_binary_mask(遮罩[i]))
        else:  # 其他形状，尝试处理
            mask_list.append(self.convert_to_binary_mask(遮罩))

        # 3. 创建画布（原图）
        canvas = pil_image.copy()

        # 4. 叠加遮罩颜色
        if len(mask_list) > 0:
            # 解析遮罩颜色
            mask_color_rgb = self.hex_to_rgb(遮罩颜色)

            # 创建颜色层
            color_layer = Image.new('RGBA', (width, height), (*mask_color_rgb, 0))
            draw_color = ImageDraw.Draw(color_layer)

            # 遍历所有遮罩并叠加
            for mask in mask_list:
                if mask is None or mask.size == 0:
                    continue

                # 确保遮罩尺寸与图像一致
                if mask.shape[0] != height or mask.shape[1] != width:
                    # 缩放遮罩到图像尺寸
                    mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')
                    mask_img = mask_img.resize((width, height), Image.NEAREST)
                    mask = np.array(mask_img) / 255.0

                # 创建遮罩的alpha层
                mask_alpha = (mask * 遮罩不透明 * 255).astype(np.uint8)
                alpha_layer = Image.fromarray(mask_alpha, mode='L')

                # 将颜色层应用到画布
                temp_canvas = Image.new('RGBA', (width, height))
                temp_canvas.paste(canvas, (0, 0))
                temp_canvas.paste(color_layer, (0, 0), alpha_layer)

                # 转换回RGB
                canvas = temp_canvas.convert('RGB')

        # 5. 绘制序号（如果启用）
        if 显示序号 and len(mask_list) > 0:
            # 解析序号颜色
            number_color_rgb = self.hex_to_rgb(序号颜色)

            # 计算所有遮罩的尺寸（用于固定大小模式）
            max_height = 0
            mask_info = []

            for idx, mask in enumerate(mask_list):
                if mask is None or mask.size == 0:
                    continue

                center_x, center_y, width_mask, height_mask = self.get_mask_center_and_size(mask)

                if center_x is None:
                    continue

                # 记录遮罩信息
                mask_info.append({
                    'index': idx + 1,
                    'center': (center_x, center_y),
                    'height': height_mask
                })

                # 更新最大高度
                if 序号缩放 == "固定大小":
                    if height_mask > max_height:
                        max_height = height_mask

            # 在画布上绘制序号
            for info in mask_info:
                idx = info['index']
                center_x, center_y = info['center']
                mask_height = info['height']

                # 根据模式计算实际字体大小
                if 序号缩放 == "跟随遮罩缩放":
                    font_size = int(mask_height * 字号比例)
                else:  # 固定大小
                    font_size = int(max_height * 字号比例)

                # 确保字体大小至少为1
                font_size = max(1, font_size)

                # 加载字体
                try:
                    # 获取字体路径
                    current_dir = os.path.dirname(os.path.abspath(__file__))
                    parent_dir = os.path.dirname(current_dir)
                    fonts_dir = os.path.join(parent_dir, "fonts")
                    font_path = os.path.join(fonts_dir, 序号字体)
                    font = ImageFont.truetype(font_path, font_size)
                except:
                    # 如果字体加载失败，使用默认字体
                    font = ImageFont.load_default()

                # 创建临时图像用于透明度处理
                temp_img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
                temp_draw = ImageDraw.Draw(temp_img)

                # 获取文本精确尺寸和基线信息
                text = str(idx)
                text_width, text_height, baseline_offset = self.get_text_metrics(temp_draw, text, font)

                # 计算绘制位置：确保文本中心与遮罩中心重合
                draw_x = center_x - text_width // 2
                # 关键修正：使用基线偏移来确保垂直居中
                draw_y = center_y - baseline_offset

                # 绘制文本
                temp_draw.text((draw_x, draw_y), text, fill=(*number_color_rgb, int(序号不透明 * 255)), font=font)

                # 将临时图像混合到主画布
                canvas_rgba = canvas.convert('RGBA')
                combined = Image.alpha_composite(canvas_rgba, temp_img)
                canvas = combined.convert('RGB')

        # 6. 转换回ComfyUI格式
        output_array = np.array(canvas).astype(np.float32) / 255.0
        output_tensor = torch.from_numpy(output_array).unsqueeze(0)  # [1, H, W, 3]

        return (output_tensor,)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "ImageMaskPreview_Guhai": ImageMaskPreview_Guhai
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageMaskPreview_Guhai": "图像与遮罩预览 孤海"
}