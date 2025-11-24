import torch
import numpy as np
from PIL import Image
import math
import nodes
import cv2

class 孤海_遮罩裁剪V2:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "遮罩": ("MASK",),
                "遮罩填充": ("BOOLEAN", {"default": False}),
                "扩展系数": ("FLOAT", {"default": 1.4, "min": 1.0, "max": 3.0, "step": 0.1}),
                "输出尺寸": (["原像素", "原像素1：1", "自定义宽高"], {"default": "原像素"}),
                "自定义宽": ("INT", {"default": 1024, "min": 1, "max": 8192}),
                "自定义高": ("INT", {"default": 1024, "min": 1, "max": 8192}),
                "倍数取整": ("INT", {"default": 8, "min": 0, "max": 256}),
            }
        }
    
    RETURN_TYPES = ("SEAM", "IMAGE", "MASK")
    RETURN_NAMES = ("接缝", "裁剪图像", "裁剪遮罩")
    FUNCTION = "裁剪图像"
    CATEGORY = "孤海工具箱"
    
    def 填充遮罩孔洞(self, 遮罩_np):
        """填充遮罩内部的孔洞"""
        from scipy import ndimage
        
        # 二值化遮罩
        二值遮罩 = 遮罩_np > 0.1
        
        # 使用形态学操作填充孔洞
        填充遮罩 = ndimage.binary_fill_holes(二值遮罩)
        
        # 转换回原始范围
        填充遮罩 = 填充遮罩.astype(np.float32)
        
        return 填充遮罩
    
    def 计算倍数取整(self, 值, 倍数):
        if 倍数 <= 1:
            return 值
        return math.ceil(值 / 倍数) * 倍数
    
    def 获取边缘像素填充图像(self, 图像, 目标区域, 原始宽, 原始高, is_mask=False):
        """只在超出原始边界时进行边缘像素填充，对于遮罩超出部分始终为黑色"""
        左, 上, 右, 下 = 目标区域
        
        # 计算实际需要的尺寸
        目标宽 = 右 - 左
        目标高 = 下 - 上
        
        # 创建目标图像
        if is_mask:
            # 对于遮罩，超出部分始终用黑色填充
            目标图像 = Image.new("L", (目标宽, 目标高), 0)  # 单通道，黑色
        else:
            # 对于图像，使用原图模式
            目标图像 = Image.new(图像.mode, (目标宽, 目标高))
        
        # 计算在原始图像内的有效区域
        有效左 = max(0, 左)
        有效上 = max(0, 上)
        有效右 = min(原始宽, 右)
        有效下 = min(原始高, 下)
        
        # 计算在目标图像中的对应位置
        目标左偏移 = 有效左 - 左
        目标上偏移 = 有效上 - 上
        
        # 如果有有效区域，从原图复制
        if 有效右 > 有效左 and 有效下 > 有效上:
            有效区域 = 图像.crop((有效左, 有效上, 有效右, 有效下))
            目标图像.paste(有效区域, (目标左偏移, 目标上偏移))
        
        # 对于图像，填充超出边界的部分；对于遮罩，超出部分已经是黑色，不需要额外处理
        if not is_mask:
            # 填充超出边界的部分
            # 左侧超出
            if 左 < 0:
                for x in range(-左):
                    for y in range(目标高):
                        # 使用最左侧边缘像素
                        像素y = max(0, min(原始高 - 1, 上 + y))
                        颜色 = 图像.getpixel((0, 像素y))
                        目标图像.putpixel((x, y), 颜色)
            
            # 右侧超出
            if 右 > 原始宽:
                for x in range(目标宽 - (右 - 原始宽), 目标宽):
                    for y in range(目标高):
                        # 使用最右侧边缘像素
                        像素y = max(0, min(原始高 - 1, 上 + y))
                        颜色 = 图像.getpixel((原始宽 - 1, 像素y))
                        目标图像.putpixel((x, y), 颜色)
            
            # 上方超出
            if 上 < 0:
                for y in range(-上):
                    for x in range(目标宽):
                        # 使用最上方边缘像素
                        像素x = max(0, min(原始宽 - 1, 左 + x))
                        颜色 = 图像.getpixel((像素x, 0))
                        目标图像.putpixel((x, y), 颜色)
            
            # 下方超出
            if 下 > 原始高:
                for y in range(目标高 - (下 - 原始高), 目标高):
                    for x in range(目标宽):
                        # 使用最下方边缘像素
                        像素x = max(0, min(原始宽 - 1, 左 + x))
                        颜色 = 图像.getpixel((像素x, 原始高 - 1))
                        目标图像.putpixel((x, y), 颜色)
            
            # 填充四个角
            # 左上角
            if 左 < 0 and 上 < 0:
                颜色 = 图像.getpixel((0, 0))
                for x in range(-左):
                    for y in range(-上):
                        目标图像.putpixel((x, y), 颜色)
            
            # 右上角
            if 右 > 原始宽 and 上 < 0:
                颜色 = 图像.getpixel((原始宽 - 1, 0))
                for x in range(目标宽 - (右 - 原始宽), 目标宽):
                    for y in range(-上):
                        目标图像.putpixel((x, y), 颜色)
            
            # 左下角
            if 左 < 0 and 下 > 原始高:
                颜色 = 图像.getpixel((0, 原始高 - 1))
                for x in range(-左):
                    for y in range(目标高 - (下 - 原始高), 目标高):
                        目标图像.putpixel((x, y), 颜色)
            
            # 右下角
            if 右 > 原始宽 and 下 > 原始高:
                颜色 = 图像.getpixel((原始宽 - 1, 原始高 - 1))
                for x in range(目标宽 - (右 - 原始宽), 目标宽):
                    for y in range(目标高 - (下 - 原始高), 目标高):
                        目标图像.putpixel((x, y), 颜色)
        
        return 目标图像
    
    def 裁剪图像(self, 图像, 遮罩, 遮罩填充, 扩展系数, 
                  输出尺寸, 自定义宽, 自定义高, 倍数取整):
        # 确保输入是单张图像
        if 图像.shape[0] > 1:
            图像 = 图像[0:1]
        if 遮罩.shape[0] > 1:
            遮罩 = 遮罩[0:1]
            
        # 转换tensor为numpy数组
        图像_np = 图像[0].cpu().numpy()
        遮罩_np = 遮罩[0].cpu().numpy()
        
        # 保存填充后的遮罩到接缝数据
        填充后遮罩_np = 遮罩_np.copy()
        
        # 根据遮罩填充开关处理遮罩
        if 遮罩填充:
            填充后遮罩_np = self.填充遮罩孔洞(遮罩_np)
        
        # 获取原像素
        原始高, 原始宽 = 图像_np.shape[:2]
        
        # 找到遮罩的非零区域边界（使用填充后的遮罩）
        非零区域 = np.where(填充后遮罩_np > 0.1)  # 使用阈值避免噪点
        if len(非零区域[0]) == 0:
            # 如果没有遮罩区域，使用整个图像
            最小y, 最大y, 最小x, 最大x = 0, 原始高, 0, 原始宽
            遮罩宽 = 原始宽
            遮罩高 = 原始高
        else:
            最小y, 最大y = np.min(非零区域[0]), np.max(非零区域[0])
            最小x, 最大x = np.min(非零区域[1]), np.max(非零区域[1])
            遮罩宽 = 最大x - 最小x
            遮罩高 = 最大y - 最小y
        
        # 计算遮罩最短边
        遮罩最短边 = min(遮罩宽, 遮罩高)
        
        # 计算扩展量（四边都扩展遮罩最短边的 (扩展系数-1) 倍）
        扩展量 = int(遮罩最短边 * (扩展系数 - 1.0) / 2)
        
        # 计算基础裁剪区域（遮罩区域 + 扩展量）
        基础顶部 = 最小y - 扩展量
        基础底部 = 最大y + 扩展量
        基础左侧 = 最小x - 扩展量
        基础右侧 = 最大x + 扩展量
        
        # 根据输出尺寸选项确定最终裁剪区域
        if 输出尺寸 == "原像素":
            # 原像素：遮罩+扩展量，然后倍数取整
            裁剪宽 = 基础右侧 - 基础左侧
            裁剪高 = 基础底部 - 基础顶部
            
            if 倍数取整 > 1:
                裁剪宽 = self.计算倍数取整(裁剪宽, 倍数取整)
                裁剪高 = self.计算倍数取整(裁剪高, 倍数取整)
            
            # 保持中心点不变，调整尺寸
            中心x = (基础左侧 + 基础右侧) // 2
            中心y = (基础顶部 + 基础底部) // 2
            
            最终左侧 = 中心x - 裁剪宽 // 2
            最终右侧 = 最终左侧 + 裁剪宽
            最终顶部 = 中心y - 裁剪高 // 2
            最终底部 = 最终顶部 + 裁剪高
            
        elif 输出尺寸 == "原像素1：1":
            # 原像素1：1：取最小外接正方形，然后倍数取整
            基础宽 = 基础右侧 - 基础左侧
            基础高 = 基础底部 - 基础顶部
            目标尺寸 = max(基础宽, 基础高)
            
            if 倍数取整 > 1:
                目标尺寸 = self.计算倍数取整(目标尺寸, 倍数取整)
            
            # 保持中心点不变，调整尺寸
            中心x = (基础左侧 + 基础右侧) // 2
            中心y = (基础顶部 + 基础底部) // 2
            
            最终左侧 = 中心x - 目标尺寸 // 2
            最终右侧 = 最终左侧 + 目标尺寸
            最终顶部 = 中心y - 目标尺寸 // 2
            最终底部 = 最终顶部 + 目标尺寸
            
        else:  # 自定义宽高
            # 先对用户输入进行倍数取整
            目标宽 = 自定义宽
            目标高 = 自定义高
            if 倍数取整 > 1:
                目标宽 = self.计算倍数取整(目标宽, 倍数取整)
                目标高 = self.计算倍数取整(目标高, 倍数取整)
            
            # 计算基础宽高比和目标宽高比
            基础宽 = 基础右侧 - 基础左侧
            基础高 = 基础底部 - 基础顶部
            基础宽高比 = 基础宽 / 基础高
            目标宽高比 = 目标宽 / 目标高
            
            # 确定扩展方向
            if 基础宽高比 < 目标宽高比:
                # 需要扩展宽度
                扩展后宽 = int(基础高 * 目标宽高比)
                扩展后高 = 基础高
            else:
                # 需要扩展高度
                扩展后宽 = 基础宽
                扩展后高 = int(基础宽 / 目标宽高比)
            
            # 保持中心点不变，调整尺寸
            中心x = (基础左侧 + 基础右侧) // 2
            中心y = (基础顶部 + 基础底部) // 2
            
            最终左侧 = 中心x - 扩展后宽 // 2
            最终右侧 = 最终左侧 + 扩展后宽
            最终顶部 = 中心y - 扩展后高 // 2
            最终底部 = 最终顶部 + 扩展后高
        
        # 转换为整数坐标
        最终左侧 = int(最终左侧)
        最终右侧 = int(最终右侧)
        最终顶部 = int(最终顶部)
        最终底部 = int(最终底部)
        
        # 计算实际裁剪尺寸
        裁剪宽 = 最终右侧 - 最终左侧
        裁剪高 = 最终底部 - 最终顶部
        
        # 转换为PIL图像进行处理
        pil图像 = Image.fromarray((图像_np * 255).astype(np.uint8))
        pil遮罩 = Image.fromarray((填充后遮罩_np * 255).astype(np.uint8))
        
        # 获取裁剪区域（只在超出边界时进行边缘填充）
        # 对于遮罩，超出部分始终为黑色
        裁剪图像 = self.获取边缘像素填充图像(pil图像, (最终左侧, 最终顶部, 最终右侧, 最终底部), 原始宽, 原始高, is_mask=False)
        裁剪遮罩 = self.获取边缘像素填充图像(pil遮罩, (最终左侧, 最终顶部, 最终右侧, 最终底部), 原始宽, 原始高, is_mask=True)
        
        # 对于自定义宽高模式，需要等比例缩放到目标尺寸
        if 输出尺寸 == "自定义宽高":
            当前宽, 当前高 = 裁剪图像.size
            缩放比例宽 = 目标宽 / 当前宽
            缩放比例高 = 目标高 / 当前高
            缩放比例 = min(缩放比例宽, 缩放比例高)
            
            缩放宽 = int(当前宽 * 缩放比例)
            缩放高 = int(当前高 * 缩放比例)
            
            裁剪图像 = 裁剪图像.resize((缩放宽, 缩放高), Image.LANCZOS)
            裁剪遮罩 = 裁剪遮罩.resize((缩放宽, 缩放高), Image.LANCZOS)
            
            # 如果需要，填充到目标尺寸
            if 缩放宽 != 目标宽 or 缩放高 != 目标高:
                # 创建目标尺寸图像，用黑色填充
                最终图像 = Image.new(裁剪图像.mode, (目标宽, 目标高), 0)
                最终遮罩 = Image.new(裁剪遮罩.mode, (目标宽, 目标高), 0)
                
                # 计算粘贴位置（居中）
                左偏移 = (目标宽 - 缩放宽) // 2
                上偏移 = (目标高 - 缩放高) // 2
                
                最终图像.paste(裁剪图像, (左偏移, 上偏移))
                最终遮罩.paste(裁剪遮罩, (左偏移, 上偏移))
                
                裁剪图像 = 最终图像
                裁剪遮罩 = 最终遮罩
        else:
            # 其他模式保持当前尺寸
            目标宽, 目标高 = 裁剪图像.size
        
        # 转换回numpy数组
        最终图像_np = np.array(裁剪图像).astype(np.float32) / 255.0
        最终遮罩_np = np.array(裁剪遮罩).astype(np.float32) / 255.0
        
        # 转换为tensor
        最终图像_tensor = torch.from_numpy(最终图像_np)[None, ...]
        最终遮罩_tensor = torch.from_numpy(最终遮罩_np)[None, ...]
        
        # 计算缩放比例（用于恢复）
        if 输出尺寸 == "自定义宽高":
            # 自定义宽高模式下，有两次缩放：从裁剪区域到扩展区域，再到目标尺寸
            原始裁剪宽 = 最终右侧 - 最终左侧
            原始裁剪高 = 最终底部 - 最终顶部
            扩展后宽 = 裁剪图像.size[0] if 输出尺寸 != "自定义宽高" else 缩放宽
            扩展后高 = 裁剪图像.size[1] if 输出尺寸 != "自定义宽高" else 缩放高
            
            缩放比例宽 = 扩展后宽 / 原始裁剪宽
            缩放比例高 = 扩展后高 / 原始裁剪高
            最终缩放宽 = 目标宽 / 扩展后宽 if 输出尺寸 == "自定义宽高" else 1.0
            最终缩放高 = 目标高 / 扩展后高 if 输出尺寸 == "自定义宽高" else 1.0
        else:
            # 其他模式下，只有一次缩放：从裁剪区域到目标尺寸
            原始裁剪宽 = 最终右侧 - 最终左侧
            原始裁剪高 = 最终底部 - 最终顶部
            缩放比例宽 = 目标宽 / 原始裁剪宽
            缩放比例高 = 目标高 / 原始裁剪高
            最终缩放宽 = 1.0
            最终缩放高 = 1.0
        
        # 创建接缝数据（包含所有必要信息）
        接缝数据 = {
            "原始图像": 图像,  # 原始图像tensor
            "原始遮罩": 遮罩,    # 原始遮罩tensor
            "填充后遮罩": torch.from_numpy(填充后遮罩_np)[None, ...],  
            "原像素": (原始高, 原始宽),
            "裁剪区域": (最终顶部, 最终底部, 最终左侧, 最终右侧),
            "目标尺寸": (目标高, 目标宽),
            "缩放比例宽": 缩放比例宽,
            "缩放比例高": 缩放比例高,
            "最终缩放宽": 最终缩放宽,
            "最终缩放高": 最终缩放高,
            "输出尺寸模式": 输出尺寸,
            "填充信息": (最终左侧, 最终顶部, 最终右侧, 最终底部, 原始宽, 原始高),
            "遮罩填充": 遮罩填充, 
            "扩展系数": 扩展系数, 
            "遮罩白色区域宽": 遮罩宽, 
            "遮罩白色区域高": 遮罩高 
        }
        
        return (接缝数据, 最终图像_tensor, 最终遮罩_tensor)


class 孤海_裁剪恢复:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "接缝": ("SEAM",),
                "裁剪图像": ("IMAGE",),
                "遮罩扩展百分比": ("INT", {"default": 5, "min": 0, "max": 30, "step": 1}),
                "遮罩羽化百分比": ("INT", {"default": 5, "min": 0, "max": 30, "step": 1}),
            },
            "optional": {
                "背景图像": ("IMAGE",),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "恢复图像"
    CATEGORY = "孤海工具箱"
    
    def tensor2pil(self, image):
        """将tensor转换为PIL图像"""
        return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))
    
    def pil2tensor(self, image):
        """将PIL图像转换为tensor"""
        return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)
    
    def image_to_rgb(self, images):
        """将图像转换为RGB格式"""
        if len(images) > 1:
            tensors = []
            for image in images:
                pil_image = self.tensor2pil(image)
                pil_image = pil_image.convert('RGB')
                tensors.append(self.pil2tensor(pil_image))
            tensors = torch.cat(tensors, dim=0)
            return (tensors, )
        else:
            pil_image = self.tensor2pil(images)
            pil_image = pil_image.convert('RGB')
            return (self.pil2tensor(pil_image), )
    
    def 计算百分比像素值(self, 百分比, 遮罩宽, 遮罩高):
        """将百分比转换为像素值，基于遮罩白色区域宽高的平均值"""
        if 百分比 == 0:
            return 0
        平均值 = (遮罩宽 + 遮罩高) / 2
        像素值 = int(平均值 * 百分比 / 100)
        return max(1, 像素值)  # 确保至少为1像素，避免为0
    
    def 创建羽化遮罩(self, 遮罩, 扩展, 羽化):
        """使用OpenCV创建带有扩展和羽化效果的遮罩（性能优化版）"""
        if 扩展 == 0 and 羽化 == 0:
            return 遮罩
        
        # 确保遮罩是单通道的numpy数组
        if 遮罩.ndim == 3:
            遮罩 = 遮罩[:, :, 0] if 遮罩.shape[2] > 1 else 遮罩[:, :, 0]
        
        # 转换为8位无符号整数（0-255范围）
        遮罩_uint8 = (遮罩 * 255).astype(np.uint8)
        
        # 扩展遮罩 - 使用OpenCV的形态学操作（比PIL快得多）
        if 扩展 > 0:
            # 创建椭圆形的结构元素，大小根据扩展值调整
            核大小 = max(3, 扩展 * 2 + 1)  # 确保是奇数
            核 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (核大小, 核大小))
            
            # 使用膨胀操作进行扩展（单次操作完成，而不是循环多次）
            遮罩_uint8 = cv2.dilate(遮罩_uint8, 核, iterations=1)
        
        # 羽化遮罩 - 使用OpenCV的高斯模糊（比PIL快得多）
        if 羽化 > 0:
            # 计算高斯核大小（必须是正奇数）
            核大小 = max(3, 羽化 * 2 + 1)
            if 核大小 % 2 == 0:
                核大小 += 1  # 确保是奇数
                
            # 应用高斯模糊
            遮罩_uint8 = cv2.GaussianBlur(遮罩_uint8, (核大小, 核大小), 羽化)
        
        # 转换回浮点数并归一化
        羽化遮罩 = 遮罩_uint8.astype(np.float32) / 255.0
        
        return 羽化遮罩
    
    def 恢复图像(self, 接缝, 裁剪图像, 遮罩扩展百分比, 遮罩羽化百分比, 背景图像=None):
        # 添加RGB转换功能
        裁剪图像_rgb = self.image_to_rgb(裁剪图像)[0]
        if 背景图像 is not None:
            背景图像_rgb = self.image_to_rgb(背景图像)[0]
        else:
            背景图像_rgb = None
        
        # 获取接缝数据
        原始高, 原始宽 = 接缝["原像素"]
        裁剪顶部, 裁剪底部, 裁剪左侧, 裁剪右侧 = 接缝["裁剪区域"]
        目标高, 目标宽 = 接缝["目标尺寸"]
        缩放比例宽 = 接缝["缩放比例宽"]
        缩放比例高 = 接缝["缩放比例高"]
        最终缩放宽 = 接缝.get("最终缩放宽", 1.0)
        最终缩放高 = 接缝.get("最终缩放高", 1.0)
        输出尺寸模式 = 接缝.get("输出尺寸模式", "原像素")
        原始图像 = 接缝["原始图像"]
        遮罩填充 = 接缝.get("遮罩填充", False)
        遮罩白色区域宽 = 接缝.get("遮罩白色区域宽", 0)
        遮罩白色区域高 = 接缝.get("遮罩白色区域高", 0)
        
        # 使用填充后的遮罩（如果存在且开启了遮罩填充），否则使用原始遮罩
        if 遮罩填充 and "填充后遮罩" in 接缝:
            原始遮罩 = 接缝["填充后遮罩"]
        else:
            原始遮罩 = 接缝["原始遮罩"]
        
        # 将百分比转换为像素值
        遮罩扩展 = self.计算百分比像素值(遮罩扩展百分比, 遮罩白色区域宽, 遮罩白色区域高)
        遮罩羽化 = self.计算百分比像素值(遮罩羽化百分比, 遮罩白色区域宽, 遮罩白色区域高)
        
        # 获取背景图像
        if 背景图像_rgb is not None:
            # 检查背景图像尺寸是否匹配
            背景高, 背景宽 = 背景图像_rgb.shape[1:3]
            if 背景高 != 原始高 or 背景宽 != 原始宽:
                raise ValueError(f"背景图像尺寸({背景宽}x{背景高})与原始图像尺寸({原始宽}x{原始高})不匹配")
            背景 = 背景图像_rgb[0].cpu().numpy()
        else:
            # 使用接缝中的原始图像作为背景，也需要转换为RGB
            原始图像_rgb = self.image_to_rgb(原始图像)[0]
            背景 = 原始图像_rgb[0].cpu().numpy()
        
        # 转换裁剪图像为numpy
        裁剪_np = 裁剪图像_rgb[0].cpu().numpy()
        处理高, 处理宽 = 裁剪_np.shape[:2]
        
        强制匹配尺寸 = True  # 硬编码为True
        if 强制匹配尺寸 and (处理高 != 目标高 or 处理宽 != 目标宽):
            pil裁剪 = Image.fromarray((裁剪_np * 255).astype(np.uint8))
            pil裁剪 = pil裁剪.resize((目标宽, 目标高), Image.LANCZOS)
            裁剪_np = np.array(pil裁剪).astype(np.float32) / 255.0
            处理高, 处理宽 = 裁剪_np.shape[:2]

        
        # 检查尺寸是否匹配（如果强制匹配后仍不匹配，则使用原始逻辑）
        if 处理高 != 目标高 or 处理宽 != 目标宽:
            # 如果不匹配，先缩放到目标尺寸
            pil裁剪 = Image.fromarray((裁剪_np * 255).astype(np.uint8))
            pil裁剪 = pil裁剪.resize((目标宽, 目标高), Image.LANCZOS)
            裁剪_np = np.array(pil裁剪).astype(np.float32) / 255.0
        
        # 计算原始裁剪区域的尺寸
        原始裁剪高 = 裁剪底部 - 裁剪顶部
        原始裁剪宽 = 裁剪右侧 - 裁剪左侧
        
        # 对于自定义宽高模式，需要先恢复到扩展后的尺寸
        if 输出尺寸模式 == "自定义宽高":
            # 计算扩展后的尺寸
            扩展后宽 = int(处理宽 / 最终缩放宽)
            扩展后高 = int(处理高 / 最终缩放高)
            
            # 从处理后的图像中提取有效区域（去除填充）
            左填充 = (处理宽 - 扩展后宽) // 2
            上填充 = (处理高 - 扩展后高) // 2
            有效区域 = 裁剪_np[上填充:上填充+扩展后高, 左填充:左填充+扩展后宽]
            
            # 缩放到原始裁剪尺寸
            pil有效区域 = Image.fromarray((有效区域 * 255).astype(np.uint8))
            恢复后_pil = pil有效区域.resize((原始裁剪宽, 原始裁剪高), Image.LANCZOS)
            恢复后_np = np.array(恢复后_pil).astype(np.float32) / 255.0
        else:
            # 其他模式直接缩放到原始裁剪尺寸
            pil裁剪 = Image.fromarray((裁剪_np * 255).astype(np.uint8))
            恢复后_pil = pil裁剪.resize((原始裁剪宽, 原始裁剪高), Image.LANCZOS)
            恢复后_np = np.array(恢复后_pil).astype(np.float32) / 255.0
        
        # 获取原始遮罩的对应区域
        原始遮罩_np = 原始遮罩[0].cpu().numpy()
        
        # 计算遮罩在原始图像中的有效区域
        遮罩顶部 = max(0, 裁剪顶部)
        遮罩底部 = min(原始高, 裁剪底部)
        遮罩左侧 = max(0, 裁剪左侧)
        遮罩右侧 = min(原始宽, 裁剪右侧)
        
        遮罩区域 = 原始遮罩_np[遮罩顶部:遮罩底部, 遮罩左侧:遮罩右侧]
        
        # 缩放遮罩到恢复后的尺寸
        if 遮罩区域.size > 0:
            pil遮罩 = Image.fromarray((遮罩区域 * 255).astype(np.uint8))
            恢复遮罩_pil = pil遮罩.resize((原始裁剪宽, 原始裁剪高), Image.LANCZOS)
            恢复遮罩_np = np.array(恢复遮罩_pil).astype(np.float32) / 255.0
        else:
            恢复遮罩_np = np.zeros((原始裁剪高, 原始裁剪宽), dtype=np.float32)
        
        # 应用遮罩扩展和羽化（使用优化后的OpenCV方法）
        羽化遮罩 = self.创建羽化遮罩(恢复遮罩_np, 遮罩扩展, 遮罩羽化)
        
        # 确保遮罩是3通道的
        if 恢复后_np.ndim == 3:
            遮罩3d = np.stack([羽化遮罩, 羽化遮罩, 羽化遮罩], axis=-1)
        else:
            遮罩3d = 羽化遮罩
        
        # 将裁剪图像融合到背景中
        结果 = 背景.copy()
        
        # 计算粘贴位置（只粘贴在原始图像内的部分）
        粘贴x = max(0, 裁剪左侧)
        粘贴y = max(0, 裁剪顶部)
        
        # 计算在恢复图像中对应的区域
        源x偏移 = max(0, -裁剪左侧)
        源y偏移 = max(0, -裁剪顶部)
        源宽 = min(原始裁剪宽 - 源x偏移, 原始宽 - 粘贴x)
        源高 = min(原始裁剪高 - 源y偏移, 原始高 - 粘贴y)
        
        if 源宽 > 0 and 源高 > 0:
            # 提取要粘贴的区域
            粘贴区域 = 结果[粘贴y:粘贴y+源高, 粘贴x:粘贴x+源宽]
            
            # 提取对应的恢复图像区域
            恢复区域 = 恢复后_np[源y偏移:源y偏移+源高, 源x偏移:源x偏移+源宽]
            
            # 提取对应的遮罩区域
            遮罩区域 = 遮罩3d[源y偏移:源y偏移+源高, 源x偏移:源x偏移+源宽]
            
            # 使用遮罩进行融合
            融合区域 = 粘贴区域 * (1 - 遮罩区域) + 恢复区域 * 遮罩区域
            结果[粘贴y:粘贴y+源高, 粘贴x:粘贴x+源宽] = 融合区域
        
        # 转换回tensor
        结果_tensor = torch.from_numpy(结果)[None, ...]
        
        return (结果_tensor,)


# 注册节点
NODE_CLASS_MAPPINGS = {
    "GH_MaskCropV2": 孤海_遮罩裁剪V2,
    "GH_CropRestore": 孤海_裁剪恢复
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GH_MaskCropV2": "孤海-遮罩裁剪V2",
    "GH_CropRestore": "孤海-裁剪恢复"
}