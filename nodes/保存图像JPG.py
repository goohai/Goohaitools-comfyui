# -*- coding: utf-8 -*-

import os
import io
import re
from datetime import datetime
from PIL import Image
import numpy as np
import torch

class SaveImageJPG_GH:
    """
    保存图像JPG节点
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        """
        定义节点的输入类型
        """
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
   
自定义变量支持：  
1. %Y(年), %m(月), %d(日), %H(时), %M(分), %S(秒)-时间戳  
2. %INDEX%- 当前图片序号  
3. %BATCH_SIZE%- 批次大小  
4. %BATCH_INDEX%- 批次内序号  
5. 子目录/测试_%Y%m%d_%H%M%S"→ 在output下自动新建"子目录"文件夹，并命名为：测试_20261215_143022.jpg
"""
    
    def 保存_jpg(cls, 图像, 文件名前缀):
        """
        保存图像为JPG格式，使用高质量压缩
        """
        # 处理文件名前缀中的路径分隔符
        文件名前缀 = 文件名前缀.strip()
        
        # 替换所有路径分隔符为当前系统的路径分隔符
        文件名前缀 = 文件名前缀.replace('\\', '/').replace('//', '/')
        
        # 分离路径和文件名
        路径, 文件名模式 = cls.分离路径和文件名(文件名前缀)
        
        # 构建完整输出路径
        输出目录 = os.path.join("output", 路径) if 路径 else "output"
        
        # 创建输出目录（包括子目录）
        if not os.path.exists(输出目录):
            os.makedirs(输出目录, exist_ok=True)
        
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
            
            # 生成文件名（包含日期时间）
            当前时间 = datetime.now()
            文件名 = cls.格式化文件名(文件名模式, 当前时间, 索引, 批次大小)
            
            # 确保文件名唯一
            文件名完整 = cls.确保文件名唯一(输出目录, 文件名)
            文件路径 = os.path.join(输出目录, 文件名完整)
            
            # 使用高质量压缩保存图像
            # 质量90，优化选项，子采样1（最高质量）
            pil图像.save(文件路径, format="JPEG", quality=90, optimize=True, subsampling=1)
            
            # 记录保存的图像信息，用于预览
            子文件夹 = 路径 if 路径 else ""
            已保存图像列表.append({
                "filename": 文件名完整,
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
    
    def 分离路径和文件名(cls, 路径字符串):
        """
        分离路径和文件名
        """
        if not 路径字符串:
            return "", "Comfyui_%Y%m%d_%H%M%S"
        
        # 将路径字符串按最后一个/或\分割
        路径字符串 = 路径字符串.replace('\\', '/')
        
        # 如果字符串以/结尾，说明是目录
        if 路径字符串.endswith('/'):
            路径 = 路径字符串.rstrip('/')
            文件名 = "Comfyui_%Y%m%d_%H%M%S"
        else:
            # 分割路径和文件名
            分割结果 = 路径字符串.rsplit('/', 1)
            if len(分割结果) == 1:
                路径 = ""
                文件名 = 分割结果[0] if 分割结果[0] else "Comfyui_%Y%m%d_%H%M%S"
            else:
                路径 = 分割结果[0]
                文件名 = 分割结果[1] if 分割结果[1] else "Comfyui_%Y%m%d_%H%M%S"
        
        # 清理路径中的多余分隔符
        路径 = 路径.rstrip('/')
        
        return 路径, 文件名
    
    def 格式化文件名(cls, 文件名模式, 当前时间, 索引, 批次大小):
        """
        格式化文件名，支持日期时间变量
        """
        # 先替换自定义变量，避免strftime报错
        文件名 = 文件名模式
        
        # 替换自定义变量
        文件名 = 文件名.replace("%INDEX%", f"{索引+1:03d}")  # 改为3位数
        文件名 = 文件名.replace("%BATCH_SIZE%", f"{批次大小:03d}")  # 改为3位数
        文件名 = 文件名.replace("%BATCH_INDEX%", f"{索引+1:03d}")  # 改为3位数
        
        # 再处理时间变量（使用strftime）
        文件名 = 当前时间.strftime(文件名)
        
        # 添加序号（如果批次大于1）
        if 批次大小 > 1:
            文件名主体, 扩展名 = os.path.splitext(文件名)
            文件名 = f"{文件名主体}_{索引+1:03d}{扩展名}"  # 改为3位数
        
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
            新文件名 = f"{文件名主体}_{序号:03d}{扩展名}"  # 改为3位数
            序号 += 1
        
        return 新文件名

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "SaveImageJPG_GH": SaveImageJPG_GH
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SaveImageJPG_GH": "保存图像JPG 孤海"
}