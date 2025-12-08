import os
import re
import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from datetime import datetime
from nodes import MAX_RESOLUTION

class IDInfoNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "姓名": ("STRING", {"default": "张三"}),
                "性别": ("STRING", {"default": "男", "choices": ["男", "女"]}),
                "民族": ("STRING", {"default": "汉"}),
                "出生日期": ("STRING", {"default": "19850802"}),
                "住址": ("STRING", {"default": "北京市朝阳区某某街道某某小区某某号楼某某室"}),
                "证号": ("STRING", {"default": "110101198508021234"}),
            }
        }
    
    RETURN_TYPES = ("ID_INFO", "STRING")
    RETURN_NAMES = ("个人信息", "提示词")
    FUNCTION = "generate_id_info"
    CATEGORY = "孤海工具/证件生成"

    def generate_id_info(self, 姓名, 性别, 民族, 出生日期, 住址, 证号):
        # 验证出生日期格式
        digits = re.sub(r'\D', '', 出生日期)
        if len(digits) != 8:
            raise ValueError(f"出生日期格式不正确: '{出生日期}'，必须包含8位数字")
        
        # 计算年龄
        try:
            birth_year = int(digits[0:4])
            birth_month = int(digits[4:6])
            birth_day = int(digits[6:8])
            
            today = datetime.now()
            age = today.year - birth_year
            
            # 如果今年生日还没过，年龄减1
            if (today.month, today.day) < (birth_month, birth_day):
                age -= 1
        except ValueError:
            raise ValueError(f"出生日期格式不正确: '{出生日期}'")
        
        # 生成性别称谓
        if age < 10:
            gender_title = "男童" if 性别 == "男" else "女童"
        elif age < 30:
            gender_title = "男孩" if 性别 == "男" else "女孩"
        elif age < 60:
            gender_title = "男人" if 性别 == "男" else "女人"
        else:
            gender_title = "老爷爷" if 性别 == "男" else "老奶奶"
        
        # 生成提示词
        提示词 = f"一个{age}岁的中国{gender_title}"
        
        # 打包个人信息
        个人信息 = {
            "姓名": 姓名,
            "性别": 性别,
            "民族": 民族,
            "出生日期": 出生日期,
            "住址": 住址,
            "证号": 证号
        }
        
        return (个人信息, 提示词)

class IDCardGenerator:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模板图": ("IMAGE",),
                "头像": ("IMAGE",),
                "个人信息": ("ID_INFO",),
                "输出透明背景": ("BOOLEAN", {"default": True}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("图像", "蒙版")
    FUNCTION = "generate_id_card"
    CATEGORY = "孤海工具/证件生成"

    def generate_id_card(self, 模板图, 头像, 个人信息, 输出透明背景):
        # 从个人信息中提取字段
        姓名 = 个人信息["姓名"]
        性别 = 个人信息["性别"]
        民族 = 个人信息["民族"]
        出生日期 = 个人信息["出生日期"]
        住址 = 个人信息["住址"]
        证号 = 个人信息["证号"]
        
        # 转换张量为PIL图像
        template_img = self.tensor2pil(模板图)
        avatar_img = self.tensor2pil(头像)
        
        # 验证模板尺寸
        if template_img.size != (2048, 1536):
            raise ValueError("模板图尺寸必须是2048x1536像素")
        
        # 处理头像
        avatar_img = self.process_avatar(avatar_img)
        
        # 创建绘制对象 - 确保使用RGBA模式
        composite_img = template_img.copy().convert('RGBA')
        composite_img.paste(avatar_img, (1568 - avatar_img.width // 2, 700 - avatar_img.height // 2), avatar_img)
        
        # 获取字体路径
        font_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts")
        
        # 设置文字颜色 (带透明度)
        text_color = (12, 12, 15, 255)  # #0c0c0f
        
        # 1. 绘制姓名
        composite_img = self.draw_name(composite_img, 姓名, font_dir, text_color)
        
        # 2. 绘制性别
        composite_img = self.draw_gender(composite_img, 性别, font_dir, text_color)
        
        # 3. 绘制民族
        composite_img = self.draw_ethnicity(composite_img, 民族, font_dir, text_color)
        
        # 4. 绘制出生日期
        year, month, day = self.parse_birth_date(出生日期)
        composite_img = self.draw_birth_date(composite_img, year, month, day, font_dir, text_color)
        
        # 5. 绘制住址
        composite_img = self.draw_address(composite_img, 住址, font_dir, text_color)
        
        # 6. 绘制证号
        composite_img = self.draw_id_number(composite_img, 证号, font_dir, text_color)
        
        # 7. 验证证号逻辑
        self.validate_id_number(证号, year, month, day, 性别)
        
        # 处理背景
        if not 输出透明背景:
            # 创建白色背景
            bg = Image.new("RGB", composite_img.size, (255, 255, 255))
            # 将透明图像合成到白色背景上
            bg.paste(composite_img, (0, 0), composite_img)
            composite_img = bg
            # 创建全白蒙版
            mask = Image.new("L", composite_img.size, 255)
        else:
            # 保持RGBA透明背景
            # 从alpha通道创建蒙版
            mask = composite_img.getchannel("A")
        
        # 转换回张量
        return (self.pil2tensor(composite_img), self.pil2tensor(mask)[:, :, :, 0])
    
    def tensor2pil(self, image):
        # 处理单张图像或批处理图像
        if len(image.shape) == 4:
            image = image[0]
        i = 255. * image.cpu().numpy().squeeze()
        img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        # 确保输出RGBA格式以保持透明度
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        return img
    
    def pil2tensor(self, image):
        # 处理不同图像模式
        if image.mode == 'RGBA':
            # 对于RGBA图像，转换为float32并保持4通道
            image_array = np.array(image).astype(np.float32) / 255.0
        elif image.mode == 'RGB':
            # 对于RGB图像，转换为float32
            image_array = np.array(image).astype(np.float32) / 255.0
        elif image.mode == 'L':
            # 对于灰度图像，转换为float32并添加通道维度
            image_array = np.array(image).astype(np.float32) / 255.0
            image_array = np.expand_dims(image_array, axis=-1)
        else:
            # 其他模式转换为RGB
            image = image.convert('RGB')
            image_array = np.array(image).astype(np.float32) / 255.0
        
        # 添加批次维度
        if len(image_array.shape) == 3:
            image_array = np.expand_dims(image_array, axis=0)
        
        return torch.from_numpy(image_array)
    
    def process_avatar(self, avatar_img):
        # 确保头像是RGBA格式
        if avatar_img.mode != 'RGBA':
            avatar_img = avatar_img.convert('RGBA')
            
        # 计算目标尺寸 (26:32比例)
        target_width = 584
        target_height = int(target_width * 32 / 26)
        
        # 等比例缩放
        avatar_img = avatar_img.resize((target_width, target_height), Image.LANCZOS)
        return avatar_img
    
    def load_font(self, font_dir, font_name, size):
        """安全加载字体文件"""
        font_path = os.path.join(font_dir, font_name)
        
        # 检查字体文件是否存在
        if not os.path.exists(font_path):
            raise FileNotFoundError(f"字体文件不存在: {font_path}")
        
        try:
            return ImageFont.truetype(font_path, size)
        except OSError as e:
            raise OSError(f"无法加载字体文件 '{font_name}' (大小: {size}): {str(e)}")
    
    def draw_text_with_stroke(self, img, position, text, font, fill_color, stroke_width=1):
        """实现精确的0.5像素描边效果"""
        # 创建临时图像用于绘制
        temp_img = Image.new("RGBA", img.size, (0, 0, 0, 0))
        temp_draw = ImageDraw.Draw(temp_img)
        
        # 在临时图像上绘制描边
        x, y = position
        stroke_color = (0, 0, 0, 128)  # 半透明黑色描边
        
        # 精确的0.5像素描边实现
        # 在四个方向绘制半透明描边
        temp_draw.text((x-0.5, y), text, font=font, fill=stroke_color)
        temp_draw.text((x+0.5, y), text, font=font, fill=stroke_color)
        temp_draw.text((x, y-0.5), text, font=font, fill=stroke_color)
        temp_draw.text((x, y+0.5), text, font=font, fill=stroke_color)
        
        # 合成描边到主图像
        img = Image.alpha_composite(img, temp_img)
        
        # 在主图像上绘制填充文字
        draw = ImageDraw.Draw(img)
        draw.text(position, text, font=font, fill=fill_color)
        
        return img
    
    def draw_name(self, img, name, font_dir, text_color):
        # 处理名字格式：去除所有空格
        name = name.replace(" ", "").replace("　", "")
        
        # 加载字体
        font = self.load_font(font_dir, "华文细黑.ttf", 80)
        
        # 位置
        x = 425
        y = 317  # 原338 -> 328 -> 323 -> 317 (再上移3像素)
        
        # 如果是两个字的名字，分开绘制并添加固定间距
        if len(name) == 2:
            # 计算第一个字的位置
            x1 = x
            y1 = y
            
            # 绘制第一个字（带0.5像素描边）
            img = self.draw_text_with_stroke(img, (x1, y1), name[0], font, text_color, stroke_width=1)
            
            # 计算第二个字的位置（第一个字宽度 + 50像素间距）
            char1_width = font.getlength(name[0])
            x2 = x1 + char1_width + 50
            
            # 绘制第二个字（带0.5像素描边）
            img = self.draw_text_with_stroke(img, (x2, y1), name[1], font, text_color, stroke_width=1)
        else:
            # 不是两个字的名字，直接绘制（带0.5像素描边）
            img = self.draw_text_with_stroke(img, (x, y), name, font, text_color, stroke_width=1)
        
        return img
    
    def draw_gender(self, img, gender, font_dir, text_color):
        # 加载字体
        font = self.load_font(font_dir, "华文细黑.ttf", 66)
        # 位置调整：Y坐标上移18像素 (原485 -> 479)
        img = self.draw_text_with_stroke(img, (425, 479), gender, font, text_color, stroke_width=1)
        return img
    
    def draw_ethnicity(self, img, ethnicity, font_dir, text_color):
        # 加载字体
        font = self.load_font(font_dir, "华文细黑.ttf", 66)
        # 位置调整：Y坐标上移18像素 (原485 -> 479)
        img = self.draw_text_with_stroke(img, (815, 479), ethnicity, font, text_color, stroke_width=1)
        return img
    
    def parse_birth_date(self, birth_date):
        # 提取日期数字
        digits = re.sub(r'\D', '', birth_date)
        if len(digits) != 8:
            raise ValueError(f"出生日期格式不正确: '{birth_date}'，必须包含8位数字")
        
        year = digits[0:4]
        month = str(int(digits[4:6]))  # 去掉前导零
        day = str(int(digits[6:8]))    # 去掉前导零
        
        return year, month, day
    
    def draw_birth_date(self, img, year, month, day, font_dir, text_color):
        # 使用wsis721.ttf字体绘制所有日期部分
        date_font = self.load_font(font_dir, "wsis721.ttf", 70)
        
        # 绘制年份 - 中心对齐（向上偏移18像素）
        year_width = date_font.getlength(year)
        year_x = 505 - year_width/2
        year_y = 680 - 35 - 18
        img = self.draw_text_with_stroke(img, (year_x, year_y), year, date_font, text_color, stroke_width=1)
        
        # 绘制月份（中心对齐，向上偏移18像素）
        month_width = date_font.getlength(month)
        month_x = 732 - month_width/2
        month_y = 680 - 35 - 18
        img = self.draw_text_with_stroke(img, (month_x, month_y), month, date_font, text_color, stroke_width=1)
        
        # 绘制日期（极速对齐，向上偏移18像素）
        day_width = date_font.getlength(day)
        day_x = 920 - day_width/2
        day_y = 680 - 35 - 18
        img = self.draw_text_with_stroke(img, (day_x, day_y), day, date_font, text_color, stroke_width=1)
        
        return img
    
    def draw_address(self, img, address, font_dir, text_color):
        # 加载字体
        font = self.load_font(font_dir, "华文细黑.ttf", 66)
        
        # 分行处理
        lines = []
        line = ""
        for char in address:
            # 每个中文字符算一个长度
            line += char
            if len(line) >= 11:  # 达到11个字符时换行
                lines.append(line)
                line = ""
        if line:
            lines.append(line)
        
        # 最多显示3行
        lines = lines[:3]
        
        # 计算行高（字体高度 + 行间距）
        # 使用"中"字测量高度
        _, _, _, height = font.getbbox("中")
        line_height = height + 38  # 行间距38像素
        
        # 绘制文本 - 位置调整：Y坐标上移18像素 (原786 -> 783)
        y_pos = 783
        for line in lines:
            img = self.draw_text_with_stroke(img, (425, y_pos), line, font, text_color, stroke_width=1)
            y_pos += line_height
        
        return img
    
    def draw_id_number(self, img, id_number, font_dir, text_color):
        # 使用92像素字体大小
        font = self.load_font(font_dir, "OCR-B 10 BT.ttf", 92)
        
        img = self.draw_text_with_stroke(img, (726, 1175), id_number, font, text_color, stroke_width=1)
        return img
    
    def validate_id_number(self, id_number, year, month, day, gender):
        # 验证长度
        if len(id_number) != 18:
            raise ValueError(f"证号必须是18位数字，当前长度: {len(id_number)}")
        
        # 提取出生日期部分
        id_date = id_number[6:14]
        
        # 将出生日期格式化为8位数字字符串
        formatted_birth_date = f"{year}{month.zfill(2)}{day.zfill(2)}"
        
        # 验证出生日期
        if id_date != formatted_birth_date:
            raise ValueError(f"出生日期与证号不符: 证号日期 {id_date} ≠ 出生日期 {formatted_birth_date}")
        
        # 验证性别
        try:
            gender_digit = int(id_number[16])
        except ValueError:
            raise ValueError(f"证号第17位不是数字: '{id_number[16]}'")
        
        if gender == "男" and gender_digit % 2 == 0:
            raise ValueError(f"证号倒数第二位与性别不符: 男性应为奇数，当前为 {gender_digit}")
        if gender == "女" and gender_digit % 2 == 1:
            raise ValueError(f"证号倒数第二位与性别不符: 女性应为偶数，当前为 {gender_digit}")

# 节点注册
NODE_CLASS_MAPPINGS = {
    "孤海_ID信息": IDInfoNode,
    "孤海_ID证生成器": IDCardGenerator
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海_ID信息": "孤海-ID信息",
    "孤海_ID证生成器": "孤海-ID证生成器"
}