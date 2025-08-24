import os
import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths

class 孤海加载批次图像:
    """ 智能图像批次加载器，支持EXIF方向校正与相对路径输出 """
    
    def __init__(self):
        self.内部计数器 = 0
        self.历史模式 = None
        self.递增总次数 = 0
        self.重置递增标记 = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文件夹路径": ("STRING", {
                    "default": "",
                    "folder_media": "",
                    "display_name": "图片目录"
                }),
                "起始索引": ("INT", {
                    "default": 0, 
                    "min": 0,
                    "display_name": "基准序号"
                }),
                "加载模式": (["单张模式", "递增模式"], {"default": "单张模式"}),
                "保留透明通道": ("BOOLEAN", {
                    "default": False,
                    "display_name": "RGBA模式"
                }),
                "包含子文件夹": ("BOOLEAN", {
                    "default": False,
                    "display_name": "扫描子目录"
                }),
                "显示扩展名": ("BOOLEAN", {
                    "default": True,
                    "display_name": "包含后缀"
                }),
                "自定义扩展名": ("STRING", {
                    "default": "",
                    "display_name": "强制扩展名"
                }),
                "重置递增": ("BOOLEAN", {
                    "default": False,
                    "display_name": "重置递增序号"
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("图像", "文件名", "图像路径", "扩展名", "路径+文件名", "序号")
    FUNCTION = "加载图片"
    CATEGORY = "孤海工具箱"

    def 加载图片(self, 文件夹路径, 起始索引, 加载模式, 保留透明通道, 包含子文件夹, 显示扩展名, 自定义扩展名, 重置递增):
        # 处理模式切换和缓存清理
        if self.历史模式 != 加载模式 or (重置递增 and not self.重置递增标记):
            self.递增总次数 = 0
            self.内部计数器 = max(起始索引, 0) if 加载模式 == "递增模式" else 0
            self.历史模式 = 加载模式
            self.重置递增标记 = True if 重置递增 else False

        # 构建图片列表
        图片列表 = self.遍历目录(文件夹路径, 包含子文件夹)
        if not 图片列表:
            raise ValueError("❌❌ 目录中未发现有效图片文件")
        总数 = len(图片列表)

        # 特殊重置递增逻辑
        if 重置递增 and 加载模式 == "递增模式":
            self.递增总次数 = 0
            实际索引 = 起始索引 % 总数
            序号 = 实际索引 + 1
        else:
            # 常规递增逻辑
            if 加载模式 == "递增模式":
                self.递增总次数 += 1
                实际索引 = (起始索引 + self.递增总次数 - 1) % 总数
                序号 = self.递增总次数 % 总数 or 总数
            else:  # 单张模式
                实际索引 = 起始索引 % 总数
                序号 = 实际索引 + 1

        选中路径 = 图片列表[实际索引]
        
        # 图像处理（新增EXIF方向校正）
        图像对象 = Image.open(选中路径)
        # 应用EXIF方向信息自动旋转图像
        图像对象 = ImageOps.exif_transpose(图像对象)
        # 转换为指定通道模式
        图像对象 = 图像对象.convert("RGBA" if 保留透明通道 else "RGB")
        图像张量 = torch.from_numpy(np.array(图像对象).astype(np.float32) / 255.0)[None,]
        
        # 路径处理
        基础路径 = os.path.normpath(文件夹路径)
        相对路径 = os.path.relpath(选中路径, 基础路径).replace("\\", "/")

        # 文件名处理
        文件名带后缀 = os.path.basename(选中路径)
        文件名 = 文件名带后缀 if 显示扩展名 else os.path.splitext(文件名带后缀)[0]

        # 扩展名处理
        原始扩展名 = os.path.splitext(文件名带后缀)[1][1:]
        最终扩展名 = 自定义扩展名.strip() or 原始扩展名

        # 强制重置递增后重置标记
        if 重置递增:
            self.重置递增标记 = False

        return (图像张量, 文件名, os.path.dirname(选中路径), 最终扩展名, 相对路径, 序号)

    def 遍历目录(self, 路径, 包含子目录):
        有效后缀 = {'.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'}
        文件列表 = []
        if os.path.isdir(路径):
            walk_method = os.walk(路径) if 包含子目录 else [next(os.walk(路径))]
            for 根目录, _, 文件 in walk_method:
                文件列表.extend(
                    os.path.join(根目录, f)
                    for f in 文件
                    if os.path.splitext(f)[-1].lower() in 有效后缀
                )
        return sorted(文件列表)

NODE_CLASS_MAPPINGS = {"GuHai_ImageLoaderPro": 孤海加载批次图像}
NODE_DISPLAY_NAME_MAPPINGS = {"GuHai_ImageLoaderPro": "孤海-加载批次图像"}