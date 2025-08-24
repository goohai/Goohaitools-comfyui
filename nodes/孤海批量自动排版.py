import os
import math
import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
import comfy
import folder_paths

def convert_unit(value, unit, dpi):
    if unit == "厘米":
        return int(round(value * dpi / 2.54, 0))
    elif unit == "英寸":
        return int(round(value * dpi, 0))
    return int(round(value, 0))

class GH_BatchLayout:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        font_dir = os.path.join(parent_dir, "fonts")
        fonts = ["默认"]
        if os.path.exists(font_dir):
            fonts += [f for f in os.listdir(font_dir) if f.lower().endswith(('.ttf', '.otf'))]
        
        return {
            "required": {
                "输入文件夹路径": ("STRING", {"default": "", "folder": True}),
                "输出文件夹路径": ("STRING", {"default": "", "folder": True}),
                "图片格式筛选": (["所有图片", "JPG/JPEG", "PNG", "BMP", "GIF", "TIF/TIFF", "WEBP"], {"default": "所有图片"}),
                "输出文件名": ("STRING", {"default": "孤海排版"}),              
                "保存格式": (["JPG", "PNG"], {"default": "JPG"}),
                "开启批处理": ("BOOLEAN", {"default": True}),
                "包含子文件夹": ("BOOLEAN", {"default": False}),
                "单位": (["像素", "厘米", "英寸"], {"default": "厘米"}),
                "画布宽度": ("FLOAT", {"default": 15.2, "min": 1.0, "max": 10000.0, "step": 0.1}),
                "画布高度": ("FLOAT", {"default": 10.1, "min": 1.0, "max": 10000.0, "step": 0.1}),
                "分辨率": ("INT", {"default": 300, "min": 72, "max": 1200}),
                "照片宽度": ("FLOAT", {"default": 3.5, "min": 1.0, "max": 10000.0, "step": 0.1}),
                "照片高度": ("FLOAT", {"default": 4.5, "min": 1.0, "max": 10000.0, "step": 0.1}),
                "水平间距": ("FLOAT", {"default": 15.0, "min": 0.0, "max": 1000.0, "step": 0.1}),
                "垂直间距": ("FLOAT", {"default": 15.0, "min": 0.0, "max": 1000.0, "step": 0.1}),
                "裁剪模式": (["填充", "裁剪"], {"default": "裁剪"}),
                "自适应旋转": ("BOOLEAN", {"default": True}),
                "背景颜色": ("COLOR", {"default": "#FFFFFF"}),
                "圆角半径": ("INT", {"default": 0, "min": 0, "max": 1000}),
                "描边像素": ("INT", {"default": 0, "min": 0, "max": 50}),
                "描边颜色": ("COLOR", {"default": "#000000"}),
                "显示文件名": (["关闭", "仅显示文件名", "文件名+扩展", "路径+文件名", "路径+文件名+扩展", "仅显示路径名", "路径名+第一张图像名"], {"default": "关闭"}),
                "字体选择": (fonts, {"default": "默认"}),
                # 新增优先显示选项
                "优先显示": (["左", "右"], {"default": "左"}),
                "字体颜色": ("COLOR", {"default": "#000000"}),
                "字体大小": ("INT", {"default": 24, "min": 5, "max": 150}),
                "安全边距": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 200.0, "step": 0.1}),  # 新增安全边距参数
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "完成报告")
    FUNCTION = "process"
    CATEGORY = "孤海工具箱"

    def process(self, **kwargs):
        参数 = self.预处理参数(kwargs)
        file_list = self.获取文件列表(参数["输入文件夹路径"], 参数["包含子文件夹"], 参数["图片格式筛选"])
        
        if not file_list:
            raise ValueError("未找到任何有效图片文件")

        布局参数 = self.计算布局参数(参数, len(file_list))
        
        if not 参数["开启批处理"]:
            布局参数["总页数"] = 1
            布局参数["每页数量"] = min(布局参数["每页数量"], len(file_list))
            file_list = file_list[:布局参数["每页数量"]]

        result_tensors = []
        start_num = self.获取起始编号(参数["输出文件夹路径"], 参数["输出文件名"], 参数["保存格式"])
        
        processed_count = 布局参数["总页数"] * 布局参数["每页数量"]
        report = f"共处理{min(len(file_list), processed_count)}张图片，\n排了{布局参数['总页数']}个版面，\n每版{布局参数['每页数量']}张图片。"

        first_canvas = None  # 用于存储第一张排版图像
        
        for page in range(布局参数["总页数"]):
            current_files = file_list[
                page*布局参数["每页数量"] : (page+1)*布局参数["每页数量"]
            ]
            images = self.加载当前页图片(current_files)
            
            # 判断是否是最后一页且图片不足一页
            is_last_page = (page == 布局参数["总页数"] - 1)
            is_full_page = len(images) == 布局参数["每页数量"]
            
            canvas = self.生成画布(images, 布局参数, 参数, is_last_page and not is_full_page)
            
            output_path = os.path.join(
                参数["输出文件夹路径"], 
                f"{参数['输出文件名']}_{start_num + page:02d}.{参数['保存格式'].lower()}"
            )
            self.保存画布(canvas, output_path, 参数)
            
            # 只保存第一张排版图像
            if page == 0:
                first_canvas = canvas
                result_tensors.append(self.转换到Tensor(canvas))
            
            del images, canvas

        # 如果没有任何排版图像，返回空张量
        if first_canvas is None:
            return (torch.zeros(0), report)
        
        return (torch.stack(result_tensors), report)

    # ================ 核心方法 ================
    def 预处理参数(self, raw_params):
        params = raw_params.copy()
        
        # 根据保存格式处理背景颜色
        if params["保存格式"] == "PNG":
            # PNG使用透明背景
            params["bg_color"] = (0, 0, 0, 0)
        else:
            # 其他格式使用用户指定颜色
            params["bg_color"] = self.解析颜色(params["背景颜色"])
        
        # 将安全边距转换为像素
        params["安全边距_px"] = int(convert_unit(params["安全边距"], params["单位"], params["分辨率"]))
        
        # 计算扣除安全边距后的画布尺寸
        params["画布宽度_px"] = int(convert_unit(params["画布宽度"], params["单位"], params["分辨率"]))
        params["画布高度_px"] = int(convert_unit(params["画布高度"], params["单位"], params["分辨率"]))
        params["可用宽度_px"] = max(0, params["画布宽度_px"] - 2 * params["安全边距_px"])
        params["可用高度_px"] = max(0, params["画布高度_px"] - 2 * params["安全边距_px"])
        
        params["照片宽度_px"] = int(convert_unit(params["照片宽度"], params["单位"], params["分辨率"]))
        params["照片高度_px"] = int(convert_unit(params["照片高度"], params["单位"], params["分辨率"]))
        # 修改间距单位处理
        params["水平间距_px"] = int(convert_unit(params["水平间距"], params["单位"], params["分辨率"]))
        params["垂直间距_px"] = int(convert_unit(params["垂直间距"], params["单位"], params["分辨率"]))
   
        if not os.path.isdir(params["输入文件夹路径"]):
            raise NotADirectoryError(f"输入路径不存在: {params['输入文件夹路径']}")
        os.makedirs(params["输出文件夹路径"], exist_ok=True)
        
        params["font"] = self.加载字体(params["字体选择"], params["字体大小"])
        
        params["stroke_color"] = self.解析颜色(params["描边颜色"])
        params["text_color"] = self.解析颜色(params["字体颜色"])
        
        # 新增优先显示参数处理
        params["优先显示"] = raw_params.get("优先显示", "左")

        # 处理输出文件名
        params["输出文件名"] = params["输出文件名"].strip() or "孤海排版"
        
        return params

    def 加载字体(self, font_choice, font_size):
        if font_choice != "默认":
            current_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(current_dir)
            font_path = os.path.join(parent_dir, "fonts", font_choice)
            try:
                return ImageFont.truetype(font_path, font_size)
            except Exception as e:
                print(f"字体加载失败: {str(e)}")
        
        try:
            font = ImageFont.load_default()
            return font.font_variant(size=font_size)
        except:
            raise RuntimeError("无法加载系统默认字体")

    def 解析颜色(self, color_input):
        # 处理整数输入（如0xFFFFFF）
        if isinstance(color_input, int):
            color_str = f"{color_input:06x}"  # 转换为6位十六进制字符串
        else:
            color_str = str(color_input).lstrip('#')  # 处理字符串输入
    
        # 处理短格式（如#RGB转RRGGBB）
        length = len(color_str)
        if length in (3, 4):
            color_str = ''.join([c*2 for c in color_str])
    
        # 解析颜色值并补充alpha通道
        return tuple(int(color_str[i:i+2], 16) for i in range(0, len(color_str), 2)) + (255,)*(4 - len(color_str)//2)

    # ================ 文件处理 ================
    def 获取文件列表(self, input_dir, include_subfolders, format_filter):
        格式映射 = {
            "所有图片": ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp'),
            "JPG/JPEG": ('.jpg', '.jpeg'),
            "PNG": ('.png',),
            "BMP": ('.bmp',),
            "GIF": ('.gif',),
            "TIF/TIFF": ('.tif', '.tiff'),
            "WEBP": ('.webp',)
        }
        valid_exts = 格式映射.get(format_filter, 格式映射["所有图片"])
        
        file_list = []
        if include_subfolders:
            for root, _, files in os.walk(input_dir):
                for f in files:
                    if f.lower().endswith(valid_exts):
                        rel_path = os.path.relpath(os.path.join(root, f), input_dir)
                        file_list.append((rel_path, os.path.join(root, f)))
        else:
            for f in os.listdir(input_dir):
                if f.lower().endswith(valid_exts):
                    file_list.append((f, os.path.join(input_dir, f)))
        return file_list

    def 获取起始编号(self, output_dir, base_name, save_format):
        existing_files = [f for f in os.listdir(output_dir) 
                         if f.startswith(f"{base_name}_") and f.lower().endswith(f".{save_format.lower()}")]
        max_num = 0
        for f in existing_files:
            try:
                num_part = f.rsplit("_", 1)[-1].split(".")[0]
                num = int(num_part)
                max_num = max(max_num, num)
            except (ValueError, IndexError):
                continue
        return max_num + 1

    # ================ 布局计算 ================
    def 计算布局参数(self, params, total_files):
        # 计算文本高度（仅当需要每张图片下的文本时才计算）
        if params["显示文件名"] in ["仅显示文件名", "文件名+扩展", "路径+文件名", "路径+文件名+扩展"]:
            text_height = self.计算文本高度(params["font"])
        else:
            text_height = 0
        
        # 使用扣除安全边距后的可用尺寸计算布局
        每行数量 = max(1, (params["可用宽度_px"] - params["水平间距_px"]) // 
                    (params["照片宽度_px"] + params["水平间距_px"]))
        每列数量 = max(1, (params["可用高度_px"] - params["垂直间距_px"]) // 
                    (params["照片高度_px"] + params["垂直间距_px"] + text_height))
        每页数量 = 每行数量 * 每列数量
        
        if params["开启批处理"]:
            总页数 = math.ceil(total_files / 每页数量)
        else:
            总页数 = 1
            每页数量 = min(每页数量, total_files)
        
        return {
            "每行数量": 每行数量,
            "每列数量": 每列数量,
            "每页数量": 每页数量,
            "总页数": 总页数,
            "text_height": text_height
        }

    def 计算文本高度(self, font):
        try:
            metrics = font.getmetrics()
            return metrics[0] + metrics[1] + 5 if isinstance(metrics, tuple) else font.size + 5
        except:
            return int(font.size * 1.2) + 5

    # ================ 图像处理 ================
    def 加载当前页图片(self, file_paths):
        images = []
        for rel_path, abs_path in file_paths:
            try:
                img = Image.open(abs_path).convert('RGBA')
                images.append((rel_path, img))
            except Exception as e:
                print(f"图片加载失败: {abs_path} - {str(e)}")
        return images

    def 生成画布(self, images, 布局参数, params, is_incomplete_page):
        # 使用预处理后的背景颜色
        canvas = Image.new('RGBA', 
                         (params["画布宽度_px"], params["画布高度_px"]), 
                         params["bg_color"])
        draw = ImageDraw.Draw(canvas)
        
        # 内容宽度和高度计算（基于安全边距内的可用空间）
        content_width = 布局参数["每行数量"] * (params["照片宽度_px"] + params["水平间距_px"]) - params["水平间距_px"]
        
        # 计算完整版的内容高度（满版）
        content_height_full = 布局参数["每列数量"] * (params["照片高度_px"] + params["垂直间距_px"] + 布局参数["text_height"]) - params["垂直间距_px"]
        
        # 计算完整版起始位置（垂直居中在安全边距内）
        start_y_full = params["安全边距_px"] + max(0, (params["可用高度_px"] - content_height_full) // 2)
        
        # 计算当前页内容高度
        num_rows = math.ceil(len(images) / 布局参数["每行数量"])
        content_height_current = num_rows * (params["照片高度_px"] + params["垂直间距_px"] + 布局参数["text_height"]) - params["垂直间距_px"]
        
        # 水平方向居中在安全边距内
        start_x = params["安全边距_px"] + max(0, (params["可用宽度_px"] - content_width) // 2)
        
        # 垂直方向处理：如果是最后一页且图片不足，使用完整版的顶部留白距离
        if is_incomplete_page:
            start_y = start_y_full
        else:
            start_y = params["安全边距_px"] + max(0, (params["可用高度_px"] - content_height_current) // 2)
        
        x, y = start_x, start_y
        
        # 初始化第一张图片的文件名（用于"路径名+第一张图像名"选项）
        first_image_name = None
        
        # 处理每张图片下的文件名显示
        for idx, (filename, img) in enumerate(images):
            # 记录第一张图片的文件名（用于"路径名+第一张图像名"）
            if idx == 0:
                first_image_name = filename
                
            # 仅当不是"仅显示路径名"时才在图片下显示文本
            if params["显示文件名"] != "仅显示路径名" and params["显示文件名"] != "路径名+第一张图像名":
                text, text_x, text_y = self.准备文件名(
                    filename, params["显示文件名"], x, y, 
                    params["照片宽度_px"], params["照片高度_px"], 
                    params["font"]
                )
            else:
                text, text_x, text_y = None, 0, 0
            
            processed_img = self.处理单张图片(
                img, 
                params["照片宽度_px"], 
                params["照片高度_px"], 
                params["裁剪模式"], 
                params["自适应旋转"], 
                params["bg_color"], 
                params["stroke_color"], 
                params["描边像素"],
                params["圆角半径"]
            )
            
            canvas.paste(processed_img, (x, y), processed_img)
            if text:
                draw.text((text_x, text_y), text, fill=params["text_color"], font=params["font"])
            
            x += params["照片宽度_px"] + params["水平间距_px"]
            if (idx + 1) % 布局参数["每行数量"] == 0:
                x = start_x
                y += params["照片高度_px"] + params["垂直间距_px"] + 布局参数["text_height"]
        
        # 处理底部文本（"仅显示路径名"和"路径名+第一张图像名"）
        if params["显示文件名"] in ["仅显示路径名", "路径名+第一张图像名"]:
            if params["显示文件名"] == "仅显示路径名":
                # 获取输入文件夹的basename（最后一级目录名）
                folder_name = os.path.basename(os.path.normpath(params["输入文件夹路径"]))
                folder_name = folder_name if folder_name else "根目录"
                text_content = folder_name
            else:  # "路径名+第一张图像名"
                folder_name = os.path.basename(os.path.normpath(params["输入文件夹路径"]))
                folder_name = folder_name if folder_name else "根目录"
                
                # 提取第一张图片的文件名（不含扩展名）
                if first_image_name:
                    _, file_part = os.path.split(first_image_name)
                    file_name, _ = os.path.splitext(file_part)
                    text_content = f"{folder_name}_{file_name}"
                else:
                    text_content = f"{folder_name}_无图片"
            
            # 计算文本宽度和可用区域宽度
            text_width = params["font"].getlength(text_content)
            available_width = params["可用宽度_px"]
            
            # 计算边距限制（整个画布宽度的0.5%）
            margin_bound = int(0.005 * params["画布宽度_px"])
            
            if text_width <= available_width:
                # 文本宽度在可用宽度内，居中显示
                text_x = params["安全边距_px"] + (available_width - text_width) // 2
            else:
                # 文本宽度超出可用宽度，根据"优先显示"选项调整
                if params["优先显示"] == "左":
                    # 从安全边距内左侧0.5%画布宽度的位置开始
                    text_x = params["安全边距_px"] + margin_bound
                else:  # "右"
                    # 文本的右侧与安全边距内右侧0.5%画布宽度的位置对齐
                    text_x = params["安全边距_px"] + available_width - text_width - margin_bound
            
            # 文本的y坐标不变
            text_y = params["画布高度_px"] - params["安全边距_px"] - self.计算文本高度(params["font"]) - 50
            
            # 绘制文件夹名
            draw.text((text_x, text_y), text_content, fill=params["text_color"], font=params["font"])
        
        return canvas

    def 准备文件名(self, filename, show_mode, x, y, img_w, img_h, font):
        if show_mode == "关闭" or show_mode == "仅显示路径名" or show_mode == "路径名+第一张图像名":
            return None, 0, 0
        
        path_part, file_part = os.path.split(filename)
        name_part, ext_part = os.path.splitext(file_part)
    
        # 根据显示模式构造文本
        if show_mode == "仅显示文件名":
            text = name_part
        elif show_mode == "文件名+扩展":
            text = file_part
        elif show_mode == "路径+文件名":
            text = os.path.join(path_part, name_part)
        elif show_mode == "路径+文件名+扩展":
            text = filename
        else:
            text = ""

        max_width = img_w
        ellipsis = "…"
    
        # 如果原始文本不需要截断
        if font.getlength(text) <= max_width:
            return text, x + (img_w - font.getlength(text)) // 2, y + img_h + 2
    
        ellipsis_width = font.getlength(ellipsis)
        available_width = max_width - ellipsis_width
    
        # 初始化候选文本为省略号（极端情况处理）
        candidate = ellipsis
    
        if available_width > 0:
            front_max = available_width // 2
            back_max = available_width - front_max

            # 获取前部保留内容
            front_part = ""
            current_front = 0
            for char in text:
                char_width = font.getlength(char)
                if current_front + char_width > front_max:
                    break
                front_part += char
                current_front += char_width

            # 获取后部保留内容
            back_part = ""
            current_back = 0
            for char in reversed(text):
                char_width = font.getlength(char)
                if current_back + char_width > back_max:
                    break
                back_part = char + back_part
                current_back += char_width

            candidate = front_part + ellipsis + back_part

        # 最终宽度校验
        while font.getlength(candidate) > max_width and len(candidate) > 1:
            candidate = candidate[:-1]  # 强制截断直到宽度合适

        # 最小保留逻辑（至少保留首尾各1字符）
        if len(candidate) < 4 and len(text) >= 2:
            new_candidate = text[0] + ellipsis + text[-1]
            if font.getlength(new_candidate) <= max_width:
                candidate = new_candidate
            elif font.getlength(ellipsis) <= max_width:
                candidate = ellipsis
            else:
                candidate = ""

        # 计算最终坐标
        text_width = font.getlength(candidate)
        return candidate, x + (img_w - text_width) // 2, y + img_h + 2

    def 处理单张图片(self, img, target_w, target_h, crop_mode, auto_rotate, bg_color, stroke_color, stroke_size, corner_radius):
        # 预处理图像
        if auto_rotate:
            target_ratio = target_w / target_h
            orig_ratio = img.width / img.height
            if (target_ratio < 1 and orig_ratio > 1) or (target_ratio > 1 and orig_ratio < 1):
                img = img.rotate(90, expand=True)
        
        if crop_mode == "裁剪":
            processed = ImageOps.fit(img, (target_w, target_h), method=Image.Resampling.LANCZOS)
        else:
            processed = ImageOps.pad(img, (target_w, target_h), color=bg_color, centering=(0.5, 0.5))
        
        # 优化圆角处理（4倍超采样）
        if corner_radius > 0:
            mask = Image.new('L', (target_w*4, target_h*4), 0)
            draw = ImageDraw.Draw(mask)
            draw.rounded_rectangle(
                [(0, 0), (target_w*4, target_h*4)],
                radius=corner_radius*4,
                fill=255
            )
            mask = mask.resize((target_w, target_h), Image.Resampling.LANCZOS)
            alpha = processed.split()[-1]
            alpha = Image.composite(alpha, Image.new('L', alpha.size, 0), mask)
            processed.putalpha(alpha)

        # 改进的描边处理逻辑
        if stroke_size > 0:
            # 使用超采样绘制描边
            scale = 4
            scaled_size = stroke_size * scale
            scaled_w = target_w * scale
            scaled_h = target_h * scale
            
            # 创建描边层
            stroke_layer = Image.new('RGBA', (scaled_w, scaled_h))
            draw = ImageDraw.Draw(stroke_layer)
        
            # 绘制外部形状
            if corner_radius > 0:
                cr = corner_radius * scale
                draw.rounded_rectangle(
                    [(0, 0), (scaled_w, scaled_h)],
                    radius=cr,
                    fill=stroke_color
                )
                # 绘制内部形状（收缩描边像素）
                inner_rect = (
                    scaled_size, 
                    scaled_size, 
                    scaled_w - scaled_size, 
                    scaled_h - scaled_size
                )
                inner_radius = max(0, cr - scaled_size)
                draw.rounded_rectangle(
                    inner_rect,
                    radius=inner_radius,
                    fill=(0,0,0,0)  # 透明填充
                )
            else:
                draw.rectangle(
                    [(0, 0), (scaled_w, scaled_h)],
                    fill=stroke_color
                )
                # 绘制内部矩形
                draw.rectangle(
                    [
                        (scaled_size, scaled_size),
                        (scaled_w - scaled_size, scaled_h - scaled_size)
                    ],
                    fill=(0,0,0,0)
                )
            
            # 缩小描边层并应用抗锯齿
            stroke_layer = stroke_layer.resize((target_w, target_h), Image.Resampling.LANCZOS)
            
            # 合并描边层和图像
            processed = Image.alpha_composite(stroke_layer, processed)

        return processed

    # ================ 输出方法 ================
    def 保存画布(self, canvas, output_path, params):
        if params["保存格式"] == "JPG":
            # 转换为RGB并填充背景色
            rgb_canvas = Image.new("RGB", canvas.size, params["bg_color"][:3])
            rgb_canvas.paste(canvas, mask=canvas.split()[-1])
            rgb_canvas.save(
                output_path,
                format="JPEG",
                quality=100,
                subsampling=0,
                dpi=(params["分辨率"], params["分辨率"])
            )
        else:
            canvas.save(
                output_path,
                format="PNG",
                optimize=False,
                dpi=(params["分辨率"], params["分辨率"])
            )

    def 转换到Tensor(self, canvas):
        return torch.from_numpy(
            np.array(canvas.convert("RGB")).astype(np.float32) / 255.0
        )

NODE_CLASS_MAPPINGS = {"GH_BatchLayout": GH_BatchLayout}
NODE_DISPLAY_NAME_MAPPINGS = {"GH_BatchLayout": "孤海批量自动排版"}