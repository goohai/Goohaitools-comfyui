import colorsys
import re
import numpy as np
import torch
from PIL import Image, ImageDraw
import comfy.utils

class ColorConverterGuhai:
    """颜色转换节点 - 孤海"""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "色值": ("STRING", {
                    "default": "#FFFFFF",
                    "multiline": False
                }),
                "转换后": (["#HEX", "HEX", "RGB", "HSL"], {
                    "default": "#HEX"
                }),
            }
        }
    
    RETURN_TYPES = ("STRING", "COLORCODE")
    RETURN_NAMES = ("字符串", "颜色控件")
    FUNCTION = "convert_color"
    CATEGORY = "孤海工具箱"
    OUTPUT_NODE = False

    def normalize_symbols(self, text):
        """将全角符号转换为半角符号"""
        text = text.replace('，', ',')
        text = text.replace('（', '(')
        text = text.replace('）', ')')
        text = text.replace('　', ' ')
        return text

    def parse_color(self, color_str):
        """解析多种格式的颜色值"""
        color_str = str(color_str).strip().lower()
        color_str = self.normalize_symbols(color_str)
        color_str = re.sub(r'\s+', '', color_str)
        
        hex_match = re.match(r'^#?([0-9a-f]{3}|[0-9a-f]{6})$', color_str)
        if hex_match:
            hex_code = hex_match.group(1)
            if len(hex_code) == 3:
                hex_code = ''.join([c*2 for c in hex_code])
            return self.hex_to_rgb(hex_code)
        
        rgb_pattern = r'^[\(（]?\s*(\d{1,3})\s*[，,]\s*(\d{1,3})\s*[，,]\s*(\d{1,3})\s*[\)）]?$'
        rgb_match = re.match(rgb_pattern, color_str)
        if rgb_match:
            r, g, b = map(int, rgb_match.groups())
            if 0 <= r <= 255 and 0 <= g <= 255 and 0 <= b <= 255:
                return (r/255, g/255, b/255)
        
        hsl_pattern = r'^[\(（]?\s*(\d{1,3})\s*[，,]\s*(\d{1,3})%\s*[，,]\s*(\d{1,3})%\s*[\)）]?$'
        hsl_match = re.match(hsl_pattern, color_str)
        if hsl_match:
            h, s, l_val = map(float, hsl_match.groups())
            h = h / 360.0
            s = s / 100.0
            l_val = l_val / 100.0
            return self.hsl_to_rgb_normalized(h, s, l_val)
        
        try:
            if re.match(r'^[01]\.\d+\s*[，,]\s*[01]\.\d+\s*[，,]\s*[01]\.\d+$', color_str):
                parts = re.split(r'[，,]\s*', color_str)
                if len(parts) == 3:
                    r, g, b = map(float, parts)
                    if 0 <= r <= 1 and 0 <= g <= 1 and 0 <= b <= 1:
                        return (r, g, b)
        except:
            pass
        
        return (1.0, 1.0, 1.0)
    
    def hex_to_rgb(self, hex_code):
        """十六进制转RGB(0-1范围)"""
        hex_code = hex_code.lstrip('#')
        if len(hex_code) == 3:
            hex_code = ''.join([c*2 for c in hex_code])
        r = int(hex_code[0:2], 16) / 255.0
        g = int(hex_code[2:4], 16) / 255.0
        b = int(hex_code[4:6], 16) / 255.0
        return (r, g, b)
    
    def rgb_to_hex(self, r, g, b, with_hash=True):
        """RGB(0-1范围)转十六进制"""
        r_int = int(min(max(r * 255, 0), 255))
        g_int = int(min(max(g * 255, 0), 255))
        b_int = int(min(max(b * 255, 0), 255))
        hex_code = f"{r_int:02x}{g_int:02x}{b_int:02x}"
        return f"#{hex_code}" if with_hash else hex_code
    
    def rgb_to_hsl_normalized(self, r, g, b):
        """RGB(0-1范围)转HSL(0-360, 0-100%, 0-100%)"""
        h, l_val, s = colorsys.rgb_to_hls(r, g, b)
        h = (h * 360) % 360
        s = s * 100
        l_val = l_val * 100
        return h, s, l_val
    
    def hsl_to_rgb_normalized(self, h, s, l_val):
        """HSL(0-1范围)转RGB(0-1范围)"""
        r, g, b = colorsys.hls_to_rgb(h, l_val, s)
        return (r, g, b)
    
    def convert_color(self, 色值, 转换后):
        """转换颜色格式"""
        rgb_normalized = self.parse_color(色值)
        
        if 转换后 == "#HEX":
            result_str = self.rgb_to_hex(*rgb_normalized, with_hash=True)
        elif 转换后 == "HEX":
            result_str = self.rgb_to_hex(*rgb_normalized, with_hash=False)
        elif 转换后 == "RGB":
            r = int(rgb_normalized[0] * 255)
            g = int(rgb_normalized[1] * 255)
            b = int(rgb_normalized[2] * 255)
            result_str = f"{r},{g},{b}"
        elif 转换后 == "HSL":
            h, s, l_val = self.rgb_to_hsl_normalized(*rgb_normalized)
            result_str = f"{int(round(h))},{int(round(s))}%,{int(round(l_val))}%"
        else:
            result_str = "#ffffff"
        
        color_control = self.rgb_to_hex(*rgb_normalized, with_hash=True)
        
        return (result_str, color_control)


class 取色器_孤海:
    """
    取色器节点，支持多种颜色格式输出
    """
    
    def __init__(self):
        self.color_cache = None
        self.string_cache = None
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "颜色": ("COLORCODE", {"default": "#213d50"}),
                "模式": (["HEX", "RGB", "HSL"], {"default": "HEX"}),
            },
        }
    
    RETURN_TYPES = ("COLORCODE", "STRING")
    RETURN_NAMES = ("颜色控件", "字符串")
    FUNCTION = "获取颜色"
    CATEGORY = "孤海工具箱"
    
    def 十六进制转rgb(self, hex_color):
        """将十六进制颜色转换为RGB"""
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 3:
            hex_color = ''.join([c*2 for c in hex_color])
        
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        
        return r, g, b
    
    def rgb转hsl(self, r, g, b):
        """将RGB颜色转换为HSL"""
        r_norm = r / 255.0
        g_norm = g / 255.0
        b_norm = b / 255.0
        
        h, l, s = colorsys.rgb_to_hls(r_norm, g_norm, b_norm)
        
        h = round(h * 360)
        s = round(s * 100)
        l = round(l * 100)
        
        return h, s, l
    
    def 获取颜色(self, 颜色, 模式):
        """
        根据输入的颜色和模式，输出对应的颜色值和字符串
        """
        颜色 = 颜色.strip().lower()
        
        if not re.match(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', 颜色):
            颜色 = "#213d50"
        
        if 模式 == "HEX":
            颜色字符串 = 颜色.upper()
        
        elif 模式 == "RGB":
            r, g, b = self.十六进制转rgb(颜色)
            颜色字符串 = f"{r}, {g}, {b}"
        
        elif 模式 == "HSL":
            r, g, b = self.十六进制转rgb(颜色)
            h, s, l = self.rgb转hsl(r, g, b)
            颜色字符串 = f"{h}, {s}%, {l}%"
        
        else:
            颜色字符串 = 颜色.upper()
        
        self.color_cache = 颜色
        self.string_cache = 颜色字符串
        
        return (颜色, 颜色字符串)
    
    @classmethod
    def VALIDATE_INPUTS(cls, 颜色, 模式):
        """
        验证输入值
        """
        if not 颜色:
            return True
            
        颜色 = 颜色.strip().lower()
        
        if re.match(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', 颜色):
            return True
        
        return "颜色格式无效，请使用十六进制格式（例如：#FF0000 或 #F00）"


class 孤海取色器:
    """
    孤海-取色器节点 - 输出颜色模式和颜色值
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模式": (["纯色", "上下渐变", "中心渐变"], {"default": "纯色"}),
                "主色": ("COLORCODE", {"default": "#213d50"}),
                "辅色": ("COLORCODE", {"default": "#402633"})
            }
        }
    
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("模式", "主色", "辅色")
    FUNCTION = "取色"
    CATEGORY = "孤海工具箱"
    
    def 取色(self, 模式, 主色, 辅色):
        主色 = 孤海取色器.标准化颜色(主色)
        辅色 = 孤海取色器.标准化颜色(辅色)
        
        return (模式, 主色, 辅色)
    
    @staticmethod
    def 标准化颜色(color):
        """确保颜色格式为#RRGGBB"""
        if isinstance(color, tuple):
            return f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"
        
        color = str(color).lower().strip()
        
        if not color.startswith("#"):
            color = f"#{color}"
        
        if len(color) == 4:
            return f"#{color[1]*2}{color[2]*2}{color[3]*2}"
        
        return color[:7]


class 孤海自定义颜色:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽度": ("INT", {"default": 512, "min": 1, "max": 8192}),
                "高度": ("INT", {"default": 512, "min": 1, "max": 8192}),
                "模式": (["纯色", "上下渐变", "中心渐变"], {"default": "纯色"}),
                "颜色1": ("COLORCODE", {"default": "#364254"}),
                "颜色2": ("COLORCODE", {"default": "#4C3843"}),
                "缩放": ("INT", {"default": 100, "min": 0, "max": 300, "step": 1}),
                "颗粒": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "生成颜色"
    CATEGORY = "孤海工具箱"

    def 生成颜色(self, 宽度, 高度, 模式, 颜色1, 颜色2, 缩放, 颗粒):
        def hex_to_rgb(hex_color):
            return tuple(int(hex_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))

        color1 = hex_to_rgb(颜色1)
        color2 = hex_to_rgb(颜色2)

        image = Image.new("RGB", (宽度, 高度))
        draw = ImageDraw.Draw(image)

        scale_factor = 缩放 / 100.0

        if 模式 == "纯色":
            draw.rectangle([(0,0), (宽度, 高度)], fill=color1)
        elif 模式 == "上下渐变":
            for y in range(高度):
                ratio = y / 高度
                adjusted_ratio = (ratio * scale_factor) if scale_factor != 0 else ratio
                r = int(color1[0] + (color2[0] - color1[0]) * adjusted_ratio)
                g = int(color1[1] + (color2[1] - color1[1]) * adjusted_ratio)
                b = int(color1[2] + (color2[2] - color1[2]) * adjusted_ratio)
                draw.line([(0, y), (宽度, y)], fill=(r, g, b))
        elif 模式 == "中心渐变":
            center_x = 宽度 // 2
            center_y = 高度 // 2
            max_radius = ((宽度**2 + 高度**2)**0.5) / 2
            current_radius = max_radius * scale_factor

            for y in range(高度):
                for x in range(宽度):
                    distance = ((x - center_x)**2 + (y - center_y)**2)**0.5
                    ratio = min(distance / current_radius, 1.0) if current_radius != 0 else 1.0
                    r = int(color2[0] + (color1[0] - color2[0]) * ratio)
                    g = int(color2[1] + (color1[1] - color2[1]) * ratio)
                    b = int(color2[2] + (color1[2] - color2[2]) * ratio)
                    draw.point((x, y), fill=(r, g, b))

        image_np = np.array(image).astype(np.float32) / 255.0

        if 颗粒 > 0:
            strength = 颗粒 / 100.0 * 0.15
            noise = np.random.normal(scale=strength, size=(高度, 宽度, 1))
            noise_rgb = np.repeat(noise, 3, axis=2)
            image_np = np.clip(image_np + noise_rgb, 0, 1)

        image_tensor = torch.from_numpy(image_np)[None,]

        return (image_tensor,)


NODE_CLASS_MAPPINGS = {
    "ColorConverterGuhai": ColorConverterGuhai,
    "取色器_孤海": 取色器_孤海,
    "孤海-取色器": 孤海取色器,
    "孤海-自定义颜色": 孤海自定义颜色
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ColorConverterGuhai": "颜色转换 孤海",
    "取色器_孤海": "孤海🎨 取色器",
    "孤海-取色器": "孤海 取色器（双）",
    "孤海-自定义颜色": "孤海-自定义颜色"
}