import os
import re
import numpy as np
from PIL import Image
import folder_paths

class ImageSaveNode:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像输入": ("IMAGE",),
                "输出路径": ("STRING", {"default": ""}),
                "文件名前缀": ("STRING", {"default": "Image"}),
                "文件名分隔符": ("STRING", {"default": "_"}),
                "文件名自动序号": (["开头", "末尾"], {"default": "末尾"}),
                "文件名序号位数": ("INT", {"default": 2, "min": 1, "max": 8}),
                "dpi": ("INT", {"default": 300, "min": 1, "max": 5000}),
                "质量": ("INT", {"default": 100, "min": 10, "max": 100}),
                "使用原始文件名": ("BOOLEAN", {"default": True}),
                "图片格式": ("STRING", {"default": "png"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像输出",)
    FUNCTION = "save_image"
    CATEGORY = "孤海工具箱"

    def get_next_sequence(self, path, prefix, delimiter, num_digits, img_format):
        pattern = re.compile(
            rf"^{re.escape(prefix)}{re.escape(delimiter)}(\d+)\.{re.escape(img_format)}$",
            flags=re.IGNORECASE
        )
        existing_files = [f for f in os.listdir(path) if pattern.match(f)]
        max_num = max((int(pattern.match(f).group(1)) for f in existing_files), default=-1)
        return max_num + 1 if max_num != -1 else 1

    def save_image(self, 图像输入, 输出路径, 文件名前缀, 文件名分隔符, 文件名自动序号, 文件名序号位数, dpi, 质量, 使用原始文件名, 图片格式):
        # 验证图片格式
        allowed_formats = {'jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'tif', 'tiff'}
        img_format = 图片格式.strip().lower()
        if not img_format or img_format not in allowed_formats:
            raise ValueError(f"无效图片格式：{图片格式}，支持的格式为：{', '.join(allowed_formats)}")

        # 处理输出路径
        output_path = 输出路径 if 输出路径 else self.output_dir
        os.makedirs(output_path, exist_ok=True)

        # 转换图像数据
        tensor = 图像输入.cpu().numpy().squeeze()
        if tensor.ndim not in (2, 3):
            raise ValueError("输入图像维度必须为2D（灰度）或3D（RGB/RGBA）")

        # 标准化数据到0-255范围并转换类型
        image_np = np.clip(tensor * 255, 0, 255).astype(np.uint8)

        # 通道处理（重点修改部分）
        if image_np.ndim == 3:
            channels = image_np.shape[-1]
            if channels == 4:
                # 处理RGBA转换（保留原始Alpha通道）
                alpha = image_np[..., 3:4].astype(np.float32) / 255.0
                rgb = image_np[..., :3].astype(np.float32)
                unpremultiplied_rgb = np.clip(rgb / np.where(alpha > 0, alpha, 1.0), 0, 255).astype(np.uint8)
                alpha_channel = image_np[..., 3].astype(np.uint8)  # 使用原始Alpha数据
                combined = np.concatenate([unpremultiplied_rgb, alpha_channel[..., np.newaxis]], axis=-1)
                pil_image = Image.fromarray(combined, mode='RGBA')
            elif channels == 3:
                pil_image = Image.fromarray(image_np[..., :3], mode='RGB')
            else:
                raise ValueError(f"不支持的通道数：{channels}")
        else:  # 灰度图像
            pil_image = Image.fromarray(image_np, mode='L')

        # 文件名生成
        if 使用原始文件名:
            filename = f"{文件名前缀}.{img_format}"
        else:
            next_num = self.get_next_sequence(output_path, 文件名前缀, 文件名分隔符, 文件名序号位数, img_format)
            num_str = f"{next_num:0{文件名序号位数}d}"
            filename = (
                f"{num_str}{文件名分隔符}{文件名前缀}.{img_format}"
                if 文件名自动序号 == "开头" 
                else f"{文件名前缀}{文件名分隔符}{num_str}.{img_format}"
            )

        # 保存参数配置
        format_mapping = {
            'jpg': 'JPEG',
            'jpeg': 'JPEG',
            'png': 'PNG',
            'bmp': 'BMP',
            'gif': 'GIF',
            'webp': 'WEBP',
            'tif': 'TIFF',
            'tiff': 'TIFF'
        }
        pil_format = format_mapping[img_format]

        save_args = {}
        if pil_format in ["JPEG", "WEBP"]:
            save_args["quality"] = 质量
        if pil_format == "WEBP":
            save_args["lossless"] = False
        if pil_format == "TIFF":
            save_args["compression"] = "tiff_deflate"

        # 格式兼容处理（重点修改部分）
        if pil_format in ["JPEG", "BMP"] and pil_image.mode == 'RGBA':
            pil_image = pil_image.convert('RGB')
        elif pil_format == "PNG" and pil_image.mode == 'RGBA':
            pass  # 保持RGBA模式保存透明度

        # 保存图像
        full_path = os.path.join(output_path, filename)
        pil_image.save(
            full_path,
            format=pil_format,
            dpi=(dpi, dpi),
            **save_args
        )

        return (图像输入,)

NODE_CLASS_MAPPINGS = {
    "ImageSaveNode_孤海": ImageSaveNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageSaveNode_孤海": "孤海-图像保存"
}