from PIL import Image, ImageOps, ImageDraw
import numpy as np
import torch
import comfy.utils

class 孤海图像缩放按像素:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "缩放方法": (["按长边保持比例", "按短边保持比例", "自定义宽高"], {"default": "按长边保持比例"}),
                "宽度": ("INT", {"default": 512, "min": 0, "max": 100000}),
                "高度": ("INT", {"default": 512, "min": 0, "max": 100000}),
                "将边缩放到": ("INT", {"default": 1024, "min": 1, "max": 100000}),
                "缩放插值": (["双线性插值", "双三次插值", "区域", "邻近-精确", "Lanczos"], {"default": "Lanczos"}),
                "缩放模式": (["拉伸", "裁剪", "填充"], {"default": "裁剪"}),
                "执行条件": (["总是", "最长边大于时", "最小边小于时"], {"default": "总是"}),
                "启用填充色": ("BOOLEAN", {"default": False}),
                "填充颜色": ("COLOR", {"default": "#ffffff"}),
                "自适应旋转": ("BOOLEAN", {"default": False}),
                "整除数": ("INT", {"default": 0, "min": 0, "max": 256}),
            },
            "optional": {
                "遮罩": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "MASK", "MASK", "BOOLEAN")
    RETURN_NAMES = ("图像", "宽度", "高度", "遮罩", "扩展遮罩", "布尔")
    FUNCTION = "执行缩放"
    CATEGORY = "孤海工具箱"

    def 执行缩放(self, 图像, 缩放方法, 宽度, 高度, 将边缩放到, 缩放插值, 缩放模式, 执行条件, 启用填充色, 填充颜色, 自适应旋转, 整除数, 遮罩=None):
        img = tensor2pil(图像)
        原宽度, 原高度 = img.size
        
        # 处理输入遮罩
        if 遮罩 is not None:
            mask_pil = tensor2mask(遮罩)
            if mask_pil.size != (原宽度, 原高度):
                mask_pil = mask_pil.resize((原宽度, 原高度), Image.NEAREST)
        else:
            mask_pil = Image.new("L", (原宽度, 原高度), 0)
        
        扩展遮罩 = Image.new("L", (原宽度, 原高度), 0)
        布尔 = False

        # 自适应旋转逻辑
        if 自适应旋转 and 缩放方法 == "自定义宽高" and 宽度 != 0 and 高度 != 0:
            输入宽高比 = 宽度 / 高度
            原图宽高比 = 原宽度 / 原高度
            
            if not (abs(输入宽高比 - 1) < 0.1 or abs(原图宽高比 - 1) < 0.1):
                输入横版 = 输入宽高比 > 1.1
                输入竖版 = 输入宽高比 < 0.9
                原图横版 = 原图宽高比 > 1.1
                原图竖版 = 原图宽高比 < 0.9
                
                if (输入横版 and 原图竖版) or (输入竖版 and 原图横版):
                    img = img.rotate(90, expand=True)
                    mask_pil = mask_pil.rotate(90, expand=True)
                    扩展遮罩 = 扩展遮罩.rotate(90, expand=True)
                    原宽度, 原高度 = 原高度, 原宽度

        # 执行条件判断
        最长边 = max(原宽度, 原高度)
        最短边 = min(原宽度, 原高度)
        需要缩放 = True
        
        if 执行条件 == "最长边大于时" and 最长边 <= 将边缩放到:
            需要缩放 = False
        elif 执行条件 == "最小边小于时" and 最短边 >= 将边缩放到:
            需要缩放 = False
        
        # 应用整除数要求（在缩放前处理）
        def 应用整除(目标宽, 目标高):
            if 整除数 > 1:
                目标宽 = (目标宽 // 整除数) * 整除数
                目标高 = (目标高 // 整除数) * 整除数
                # 确保最小尺寸为整除数
                目标宽 = max(整除数, 目标宽)
                目标高 = max(整除数, 目标高)
            return 目标宽, 目标高
        
        if 需要缩放:
            if 缩放方法 == "按长边保持比例":
                比例 = 将边缩放到 / 最长边
                新宽度 = round(原宽度 * 比例)
                新高度 = round(原高度 * 比例)
                # 应用整除数要求
                新宽度, 新高度 = 应用整除(新宽度, 新高度)
                img, mask_pil = self.调整尺寸(img, mask_pil, 新宽度, 新高度, 缩放插值)
                扩展遮罩 = Image.new("L", (新宽度, 新高度), 0)
                
            elif 缩放方法 == "按短边保持比例":
                比例 = 将边缩放到 / 最短边
                新宽度 = round(原宽度 * 比例)
                新高度 = round(原高度 * 比例)
                # 应用整除数要求
                新宽度, 新高度 = 应用整除(新宽度, 新高度)
                img, mask_pil = self.调整尺寸(img, mask_pil, 新宽度, 新高度, 缩放插值)
                扩展遮罩 = Image.new("L", (新宽度, 新高度), 0)
                
            else:  # 自定义宽高模式
                # 特殊处理：当其中一个尺寸为0时，保持原始比例
                if 宽度 == 0 and 高度 != 0:
                    比例 = 高度 / 原高度
                    新宽度 = round(原宽度 * 比例)
                    新高度 = 高度
                elif 高度 == 0 and 宽度 != 0:
                    比例 = 宽度 / 原宽度
                    新宽度 = 宽度
                    新高度 = round(原高度 * 比例)
                else:
                    新宽度, 新高度 = 宽度, 高度
                
                # 应用整除数要求（在缩放操作前）
                新宽度, 新高度 = 应用整除(新宽度, 新高度)
                
                if 缩放模式 == "拉伸":
                    img, mask_pil = self.调整尺寸(img, mask_pil, 新宽度, 新高度, 缩放插值)
                    布尔 = False
                elif 缩放模式 == "裁剪":
                    img, mask_pil, 扩展遮罩 = self.居中裁剪(img, mask_pil, 新宽度, 新高度, 缩放插值)
                    布尔 = False
                else:
                    img, mask_pil, 扩展遮罩, 布尔 = self.智能填充(img, mask_pil, 新宽度, 新高度, 缩放插值, 启用填充色, 填充颜色)
        else:
            # 不需要缩放时，直接应用整除数要求
            新宽度, 新高度 = 原宽度, 原高度
            if 整除数 > 1:
                整除宽度 = (原宽度 // 整除数) * 整除数
                整除高度 = (原高度 // 整除数) * 整除数
                整除宽度 = max(整除数, 整除宽度)
                整除高度 = max(整除数, 整除高度)
                
                if 整除宽度 < 原宽度 or 整除高度 < 原高度:
                    # 居中裁剪到整除尺寸
                    左边 = (原宽度 - 整除宽度) // 2
                    顶边 = (原高度 - 整除高度) // 2
                    右边 = 左边 + 整除宽度
                    底边 = 顶边 + 整除高度
                    
                    img = img.crop((左边, 顶边, 右边, 底边))
                    mask_pil = mask_pil.crop((左边, 顶边, 右边, 底边))
                    扩展遮罩 = 扩展遮罩.crop((左边, 顶边, 右边, 底边))
                    新宽度, 新高度 = 整除宽度, 整除高度

        img_tensor = pil2tensor(img)
        mask_tensor = pil2mask(mask_pil)
        扩展遮罩_tensor = pil2mask(扩展遮罩)

        return (img_tensor, 新宽度, 新高度, mask_tensor, 扩展遮罩_tensor, 布尔)

    def 调整尺寸(self, img, mask, 宽度, 高度, 插值方法):
        插值映射 = {
            "双线性插值": Image.BILINEAR,
            "双三次插值": Image.BICUBIC,
            "邻近-精确": Image.NEAREST,
            "Lanczos": Image.LANCZOS,
            "区域": Image.BOX
        }
        return (
            img.resize((宽度, 高度), 插值映射.get(插值方法, Image.LANCZOS)),
            mask.resize((宽度, 高度), 插值映射.get(插值方法, Image.LANCZOS))
        )

    def 居中裁剪(self, img, mask, 目标宽度, 目标高度, 插值方法):
        # 计算需要缩放的尺寸以覆盖目标区域
        宽比 = 目标宽度 / img.width
        高比 = 目标高度 / img.height
        比例 = max(宽比, 高比)
        
        缩放宽度 = round(img.width * 比例)
        缩放高度 = round(img.height * 比例)
        
        img_scaled = img.resize((缩放宽度, 缩放高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((缩放宽度, 缩放高度), self.获取插值方法(插值方法))
        
        # 居中裁剪
        左边 = (缩放宽度 - 目标宽度) // 2
        顶边 = (缩放高度 - 目标高度) // 2
        return (
            img_scaled.crop((左边, 顶边, 左边 + 目标宽度, 顶边 + 目标高度)),
            mask_scaled.crop((左边, 顶边, 左边 + 目标宽度, 顶边 + 目标高度)),
            Image.new("L", (目标宽度, 目标高度), 0)
        )

    def 智能填充(self, img, mask, 目标宽度, 目标高度, 插值方法, 启用填充色, 颜色):
        填充色 = 颜色 if 启用填充色 else "#808080"
        
        # 保持原始比例缩放
        宽比 = 目标宽度 / img.width
        高比 = 目标高度 / img.height
        比例 = min(宽比, 高比)
        
        新宽度 = round(img.width * 比例)
        新高度 = round(img.height * 比例)
        
        img_scaled = img.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        
        # 创建新图像并居中放置缩放后的图像
        new_img = Image.new("RGB", (目标宽度, 目标高度), color=填充色)
        new_mask = Image.new("L", (目标宽度, 目标高度), color=0)
        
        左边 = (目标宽度 - 新宽度) // 2
        顶边 = (目标高度 - 新高度) // 2
        
        new_img.paste(img_scaled, (左边, 顶边))
        new_mask.paste(mask_scaled, (左边, 顶边))
        
        # 创建扩展遮罩
        扩展遮罩 = Image.new("L", (目标宽度, 目标高度), 0)
        draw = ImageDraw.Draw(扩展遮罩)
        
        # 填充区域在顶部和底部
        if 新高度 < 目标高度:
            顶部填充高度 = (目标高度 - 新高度) // 2
            底部填充高度 = 目标高度 - 新高度 - 顶部填充高度
            draw.rectangle([0, 0, 目标宽度, 顶部填充高度], fill=255)
            draw.rectangle([0, 目标高度 - 底部填充高度, 目标宽度, 目标高度], fill=255)
        
        # 填充区域在左侧和右侧
        if 新宽度 < 目标宽度:
            左侧填充宽度 = (目标宽度 - 新宽度) // 2
            右侧填充宽度 = 目标宽度 - 新宽度 - 左侧填充宽度
            draw.rectangle([0, 0, 左侧填充宽度, 目标高度], fill=255)
            draw.rectangle([目标宽度 - 右侧填充宽度, 0, 目标宽度, 目标高度], fill=255)
        
        填充区域 = (新宽度 < 目标宽度) or (新高度 < 目标高度)
        
        return new_img, new_mask, 扩展遮罩, 填充区域

    def 获取插值方法(self, 插值名称):
        插值映射 = {
            "双线性插值": Image.BILINEAR,
            "双三次插值": Image.BICUBIC,
            "邻近-精确": Image.NEAREST,
            "Lanczos": Image.LANCZOS,
            "区域": Image.BOX
        }
        return 插值映射.get(插值名称, Image.LANCZOS)

def tensor2pil(image):
    return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

def tensor2mask(mask):
    return Image.fromarray(np.clip(255. * mask.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

def pil2tensor(image):
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def pil2mask(image):
    return torch.from_numpy(np.array(image.convert("L")).astype(np.float32) / 255.0).unsqueeze(0)

NODE_CLASS_MAPPINGS = {"孤海图像缩放按像素": 孤海图像缩放按像素}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海图像缩放按像素": "孤海图像缩放按像素"}