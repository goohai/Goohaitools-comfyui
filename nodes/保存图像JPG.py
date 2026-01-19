# -*- coding: utf-8 -*-

import os
import io
import re
import shutil
from datetime import datetime
from PIL import Image
import numpy as np
import torch

class SaveImageJPG_GH:
    """
    保存图像JPG 孤海
    """
    
    @classmethod
    def INPUT_TYPES(cls):

        return {
            "required": {
                "图像": ("IMAGE",),
                "文件名前缀": ("STRING", {"default": "ComfyUI"}),
            },
        }
    
    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "保存_jpg"
    CATEGORY = "孤海工具箱"
    OUTPUT_NODE = True
    DESCRIPTION = """保持图像画质不变，保存为体积非常小的JPG格式  
   
自定义文件名变量：  
① %date:yyyymmdd% - 年月日；%time:hhmmss% - 时分秒  
② %INDEX% - 当前图片序号   
③ %BATCH_SIZE% - 批次大小  
④ %BATCH_INDEX% - 批次内序号   
举例：  
 %date:yyyy年M月dd日%/测试_%time:hhmmss% → 在output下自动新建"2026年1月20日"文件夹，并保存为：测试_143022.jpg  
 %date:YYmmdd%\%date:mmdd%-%time:hhmmss% → 在output下新建"260120"文件夹，并保存为：0120-143022.jpg  
 （支持绝对路径）D:\桌面\批量输出\高清_%time:h时m分s秒% → D:\桌面\批量输出\高清_8时12分56秒.jpg
"""
    
    def 保存_jpg(cls, 图像, 文件名前缀):
        """
        保存图像为JPG格式，使用高质量压缩
        """
        # 处理文件名前缀中的路径分隔符
        文件名前缀 = 文件名前缀.strip()
        
        # 获取当前时间
        当前时间 = datetime.now()
        
        # 先处理日期时间变量
        文件名前缀 = cls.处理日期时间变量(文件名前缀, 当前时间)
        
        # 检查是否是绝对路径
        是否是绝对路径 = os.path.isabs(文件名前缀)
        
        # 分离路径和文件名
        路径, 文件名模式 = cls.分离路径和文件名(文件名前缀, 是否是绝对路径)
        
        # 构建完整输出路径
        if 是否是绝对路径:
            # 绝对路径：直接使用指定路径
            输出目录 = 路径
            预览目录 = os.path.join("output", "preview_absolute")
        else:
            # 相对路径：在output目录下创建
            输出目录 = os.path.join("output", 路径) if 路径 else "output"
            预览目录 = 输出目录
        
        # 创建输出目录（包括子目录）
        if not os.path.exists(输出目录):
            os.makedirs(输出目录, exist_ok=True)
        
        # 如果是绝对路径，创建预览目录
        if 是否是绝对路径 and not os.path.exists(预览目录):
            os.makedirs(预览目录, exist_ok=True)
        
        批次大小 = 图像.shape[0]
        已保存图像列表 = []
        
        for 索引 in range(批次大小):
            # 获取单张图像
            单张图像 = 图像[索引]
            
            # 转换为[0, 255]范围的numpy数组
            图像数组 = (单张图像.cpu().numpy() * 255).astype(np.uint8)
            
            # 转换为PIL图像（确保是RGB格式）
            if 图像数组.shape[-1] == 4:
                # 处理RGBA图像，转换为RGB
                pil图像 = Image.fromarray(图像数组).convert("RGB")
            else:
                pil图像 = Image.fromarray(图像数组)
            
            # 生成文件名
            文件名 = cls.格式化文件名(文件名模式, 当前时间, 索引, 批次大小)
            
            # 确保文件名唯一
            文件名完整 = cls.确保文件名唯一(输出目录, 文件名)
            文件路径 = os.path.join(输出目录, 文件名完整)
            
            # 使用高质量压缩保存图像
            # 质量90，优化选项，子采样1（最高质量）
            pil图像.save(文件路径, format="JPEG", quality=90, optimize=True, subsampling=1)
            
            # 如果是绝对路径，创建预览副本
            if 是否是绝对路径:
                预览文件路径 = os.path.join(预览目录, 文件名完整)
                # 确保预览文件名唯一
                预览文件名完整 = cls.确保文件名唯一(预览目录, 文件名)
                预览文件路径 = os.path.join(预览目录, 预览文件名完整)
                
                # 复制文件到预览目录
                shutil.copy2(文件路径, 预览文件路径)
                
                # 记录保存的图像信息，用于预览
                子文件夹 = "preview_absolute"
            else:
                # 相对路径：使用正常路径
                子文件夹 = 路径 if 路径 else ""
            
            已保存图像列表.append({
                "filename": 文件名完整 if not 是否是绝对路径 else 预览文件名完整,
                "subfolder": 子文件夹,
                "type": "output"
            })
        
        # 返回ComfyUI OUTPUT_NODE标准格式
        return {
            "ui": {
                "images": 已保存图像列表
            },
            "result": ()
        }
    
    def 处理日期时间变量(cls, 字符串, 当前时间):
        """
        处理字符串中的日期时间变量
        """
        # 处理日期变量 %date:格式%
        def 替换日期变量(匹配):
            格式 = 匹配.group(1)
            return cls.自定义日期格式化(格式, 当前时间)
        
        # 处理时间变量 %time:格式%
        def 替换时间变量(匹配):
            格式 = 匹配.group(1)
            return cls.自定义时间格式化(格式, 当前时间)
        
        # 替换日期变量
        字符串 = re.sub(r'%date:([^%]+)%', 替换日期变量, 字符串, flags=re.IGNORECASE)
        
        # 替换时间变量
        字符串 = re.sub(r'%time:([^%]+)%', 替换时间变量, 字符串, flags=re.IGNORECASE)
        
        return 字符串
    
    def 自定义日期格式化(cls, 格式, 当前时间):
        """
        自定义日期格式化
        """
        # 获取日期组件
        年 = 当前时间.year
        月 = 当前时间.month
        日 = 当前时间.day
        
        # 替换格式代码（不区分大小写）
        结果 = 格式
        
        # 年份处理
        结果 = 结果.replace('yyyy', f'{年:04d}').replace('YYYY', f'{年:04d}')  # 4位年份
        结果 = 结果.replace('yy', f'{年 % 100:02d}').replace('YY', f'{年 % 100:02d}')  # 2位年份
        
        # 月份处理
        结果 = 结果.replace('MM', f'{月:02d}').replace('mm', f'{月:02d}')  # 2位月份
        if 'M' in 结果 and 'MM' not in 结果:
            结果 = 结果.replace('M', f'{月}')  # 1-2位月份
        if 'm' in 结果 and 'mm' not in 结果:
            结果 = 结果.replace('m', f'{月}')  # 1-2位月份
        
        # 日期处理
        结果 = 结果.replace('DD', f'{日:02d}').replace('dd', f'{日:02d}')  # 2位日期
        if 'D' in 结果 and 'DD' not in 结果:
            结果 = 结果.replace('D', f'{日}')  # 1-2位日期
        if 'd' in 结果 and 'dd' not in 结果:
            结果 = 结果.replace('d', f'{日}')  # 1-2位日期
        
        return 结果
    
    def 自定义时间格式化(cls, 格式, 当前时间):
        """
        自定义时间格式化
        """
        # 获取时间组件
        小时 = 当前时间.hour
        分钟 = 当前时间.minute
        秒 = 当前时间.second
        
        # 替换格式代码
        结果 = 格式
        
        # 小时处理
        结果 = 结果.replace('HH', f'{小时:02d}').replace('hh', f'{小时:02d}')  # 2位小时
        if 'H' in 结果 and 'HH' not in 结果:
            结果 = 结果.replace('H', f'{小时}')  # 1-2位小时
        if 'h' in 结果 and 'hh' not in 结果:
            结果 = 结果.replace('h', f'{小时}')  # 1-2位小时
        
        # 分钟处理
        结果 = 结果.replace('MM', f'{分钟:02d}').replace('mm', f'{分钟:02d}')  # 2位分钟
        if 'M' in 结果 and 'MM' not in 结果:
            结果 = 结果.replace('M', f'{分钟}')  # 1-2位分钟
        if 'm' in 结果 and 'mm' not in 结果:
            结果 = 结果.replace('m', f'{分钟}')  # 1-2位分钟
        
        # 秒处理
        结果 = 结果.replace('SS', f'{秒:02d}').replace('ss', f'{秒:02d}')  # 2位秒
        if 'S' in 结果 and 'SS' not in 结果:
            结果 = 结果.replace('S', f'{秒}')  # 1-2位秒
        if 's' in 结果 and 'ss' not in 结果:
            结果 = 结果.replace('s', f'{秒}')  # 1-2位秒
        
        return 结果
    
    def 清理路径(cls, 路径, 是否是绝对路径=False):
        """
        清理路径中的非法字符，但保留路径分隔符和绝对路径中的冒号
        """
        if not 路径:
            return ""
        
        # 如果是绝对路径，需要特殊处理盘符后的冒号
        if 是否是绝对路径 and ':' in 路径:
            # 分离盘符和路径部分
            盘符, 剩余路径 = 路径.split(':', 1)
            盘符 += ':'  # 恢复冒号
            
            # 清理剩余路径部分
            清理后的剩余路径 = cls.清理路径部分(剩余路径)
            
            return 盘符 + 清理后的剩余路径
        else:
            # 相对路径或没有盘符的路径
            return cls.清理路径部分(路径)
    
    def 清理路径部分(cls, 路径):
        """
        清理路径部分中的非法字符
        """
        # 按路径分隔符分割路径
        路径部分 = 路径.replace('\\', '/').split('/')
        
        # 清理每个路径部分中的非法字符
        清理后的路径部分 = []
        for 部分 in 路径部分:
            if 部分:  # 跳过空的部分
                清理后的部分 = cls.移除文件名特殊字符(部分)
                if 清理后的部分:  # 确保清理后不为空
                    清理后的路径部分.append(清理后的部分)
        
        # 重新组合路径
        return '/'.join(清理后的路径部分)
    
    def 移除文件名特殊字符(cls, 字符串):
        """
        移除文件名中不允许的特殊字符（不包括路径分隔符和绝对路径中的冒号）
        """
        # Windows文件名中不允许的字符（不包括路径分隔符和冒号）
        非法字符 = r'[<>"|?*]'
        return re.sub(非法字符, '', 字符串)
    
    def 分离路径和文件名(cls, 路径字符串, 是否是绝对路径=False):
        """
        分离路径和文件名
        """
        if not 路径字符串:
            return "", "ComfyUI"
        
        # 统一使用正斜杠
        路径字符串 = 路径字符串.replace('\\', '/')
        
        # 如果是绝对路径，需要特殊处理
        if 是否是绝对路径:
            # 绝对路径：直接分离路径和文件名
            分割结果 = 路径字符串.rsplit('/', 1)
            if len(分割结果) == 1:
                路径 = 路径字符串
                文件名 = "ComfyUI"
            else:
                路径 = 分割结果[0]
                文件名 = 分割结果[1] if 分割结果[1] else "ComfyUI"
            
            # 清理路径
            路径 = cls.清理路径(路径, 是否是绝对路径)
        else:
            # 相对路径：原有逻辑
            # 如果字符串以/结尾，说明是目录
            if 路径字符串.endswith('/'):
                路径 = 路径字符串.rstrip('/')
                文件名 = "ComfyUI"
            else:
                # 分割路径和文件名
                分割结果 = 路径字符串.rsplit('/', 1)
                if len(分割结果) == 1:
                    路径 = ""
                    文件名 = 分割结果[0] if 分割结果[0] else "ComfyUI"
                else:
                    路径 = 分割结果[0]
                    文件名 = 分割结果[1] if 分割结果[1] else "ComfyUI"
            
            # 清理路径
            路径 = cls.清理路径(路径, 是否是绝对路径)
        
        # 清理路径中的多余分隔符
        路径 = 路径.rstrip('/')
        
        return 路径, 文件名
    
    def 格式化文件名(cls, 文件名模式, 当前时间, 索引, 批次大小):
        """
        格式化文件名，支持日期时间变量
        """
        # 先处理日期时间变量
        文件名 = cls.处理日期时间变量(文件名模式, 当前时间)
        
        # 清理文件名中的非法字符
        文件名 = cls.移除文件名特殊字符(文件名)
        
        # 替换自定义变量
        文件名 = 文件名.replace("%INDEX%", f"{索引+1:03d}")
        文件名 = 文件名.replace("%BATCH_SIZE%", f"{批次大小:03d}")
        文件名 = 文件名.replace("%BATCH_INDEX%", f"{索引+1:03d}")
        
        # 添加序号（如果批次大于1）
        if 批次大小 > 1:
            文件名主体, 扩展名 = os.path.splitext(文件名)
            文件名 = f"{文件名主体}_{索引+1:03d}{扩展名}"
        
        # 确保有扩展名
        if not 文件名.endswith('.jpg') and not 文件名.endswith('.jpeg'):
            文件名 += '.jpg'
        
        return 文件名
    
    def 确保文件名唯一(cls, 目录, 文件名):
        """
        确保文件名唯一，如果存在则添加序号
        """
        文件名主体, 扩展名 = os.path.splitext(文件名)
        序号 = 1
        新文件名 = 文件名
        
        while os.path.exists(os.path.join(目录, 新文件名)):
            新文件名 = f"{文件名主体}_{序号:03d}{扩展名}"
            序号 += 1
        
        return 新文件名

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "SaveImageJPG_GH": SaveImageJPG_GH
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SaveImageJPG_GH": "保存图像JPG 孤海"
}