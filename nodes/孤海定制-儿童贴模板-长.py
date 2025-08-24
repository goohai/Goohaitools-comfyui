import re
import os
import urllib.parse
import sys

class GuhaiCustomChildrenStickerLong:
    """
    孤海定制-儿童贴模板-长
    根据两个下拉菜单选择输出对应的图像路径和尺寸
    """
    
    # 使用原始字符串避免转义问题
    TEMPLATE_STYLES = r"""
【01. 彩虹小飞机圆+长】{image_display\PNG长\01. 彩虹小飞机圆+长.png}
【02. 粉色小熊】{image_display\PNG长\02. 粉色小熊.png}
【03. 粉色星星圆+长】{image_display\PNG长\03. 粉色星星圆+长.png}
【04. 黄白圆+长】{image_display\PNG长\04. 黄白圆+长.png}
【05. 蓝色小熊】{image_display\PNG长\05. 蓝色小熊.png}
【06. 绿色小熊】{image_display\PNG长\06. 绿色小熊.png}
【07. 绿色圆+长】{image_display\PNG长\07. 绿色圆+长.png}
【08. 小蜜蜂圆+长】{image_display\PNG长\08. 小蜜蜂圆+长.png}
【09. 小太阳月亮圆+长】{image_display\PNG长\09. 小太阳月亮圆+长.png}
【10. 长款爱心小屋】{image_display\PNG长\10. 长款爱心小屋.png}
【11. 长款彩虹太阳】{image_display\PNG长\11. 长款彩虹太阳.png}
【12. 长款海船】{image_display\PNG长\12. 长款海船.png}
【13. 长款蝴蝶结】{image_display\PNG长\13. 长款蝴蝶结.png}
【14. 长款火箭】{image_display\PNG长\14. 长款火箭.png}
【15. 长款鲸鱼】{image_display\PNG长\15. 长款鲸鱼.png}
【16. 长款马卡龙星星】{image_display\PNG长\16. 长款马卡龙星星.png}
【17. 长款小房子】{image_display\PNG长\17. 长款小房子.png}
【18. 长款小海狮】{image_display\PNG长\18. 长款小海狮.png}
【19. 长款小鸡】{image_display\PNG长\19. 长款小鸡.png}
【20. 长款小兔子】{image_display\PNG长\20. 长款小兔子.png}
【21. 长款小蜗牛】{image_display\PNG长\21. 长款小蜗牛.png}
【22. 长款星星】{image_display\PNG长\22. 长款星星.png}
【23. 长款樱桃】{image_display\PNG长\23. 长款樱桃.png}
【24. 紫色小熊】{image_display\PNG长\24. 紫色小熊.png}
【25. 紫色圆+长】{image_display\PNG长\25. 紫色圆+长.png}
    """
    
    # 尺寸清单同样使用原始字符串
    LAYOUT_SIZES = r"""
【小号 78贴】{小号 78贴}
【中号 60贴】{中号 60贴}
【大号 44贴】{大号 44贴}
【特大号 30贴】{特大号 30贴}
【超大号 20贴】{超大号 20贴}
【（小份） 小号 36贴】{（小份） 小号 36贴}
【（小份） 中号 30贴】{（小份） 中号 30贴}
【（小份） 大号 20贴】{（小份） 大号 20贴}
【（组合） 大24 + 中30】{（组合） 大24 + 中30}
【（组合） 大16 + 中20 + 小24】{（组合） 大16 + 中20 + 小24}
    """
    
    # 预解析的列表
    _parsed_templates = None
    _parsed_sizes = None
    
    @classmethod
    def _parse_list(cls, text):
        """解析清单文本，返回(显示文本, 对应值)的列表"""
        parsed = []
        pattern = r"【(.+?)】{([^}]+)}"
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            match = re.match(pattern, line)
            if match:
                display = match.group(1).strip()
                value = match.group(2).strip()
                parsed.append((display, value))
            else:
                print(f"[孤海定制] 忽略无法解析的行: {line}")
        return parsed
    
    @classmethod
    def get_template_styles(cls):
        """获取解析后的模板样式列表"""
        if cls._parsed_templates is None:
            cls._parsed_templates = cls._parse_list(cls.TEMPLATE_STYLES)
        return cls._parsed_templates
    
    @classmethod
    def get_layout_sizes(cls):
        """获取解析后的拼版尺寸列表"""
        if cls._parsed_sizes is None:
            cls._parsed_sizes = cls._parse_list(cls.LAYOUT_SIZES)
        return cls._parsed_sizes
    
    @classmethod
    def INPUT_TYPES(cls):
        """定义输入类型"""
        templates = cls.get_template_styles()
        sizes = cls.get_layout_sizes()
        
        # 创建下拉菜单选项
        template_choices = [display for display, _ in templates]
        size_choices = [display for display, _ in sizes]
        
        return {
            "required": {
                "模板样式": (template_choices, {"default": template_choices[0] if template_choices else ""}),
                "拼版尺寸": (size_choices, {"default": size_choices[0] if size_choices else ""}),
            }
        }
    
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("图像路径", "尺寸")
    FUNCTION = "get_selected"
    CATEGORY = "孤海定制"
    
    def get_selected(self, 模板样式, 拼版尺寸):
        """根据选择输出对应的图像路径（自动转换路径分隔符）和尺寸"""
        # 获取选中的模板路径
        selected_path = ""
        for display, path in self.get_template_styles():
            if display == 模板样式:
                # 直接使用原始路径，不再进行任何转义处理
                selected_path = path
                
                # 检查是否为URL，URL不转换路径分隔符
                if not urllib.parse.urlparse(path).scheme:  # 仅处理本地路径
                    # 关键优化：根据操作系统自动转换路径分隔符
                    if sys.platform.startswith('win'):
                        # Windows系统保持反斜杠
                        selected_path = path.replace('/', '\\')
                    else:
                        # Linux/macOS系统使用正斜杠
                        selected_path = path.replace('\\', '/')
                break
        
        # 获取选中的尺寸
        selected_size = ""
        for display, size in self.get_layout_sizes():
            if display == 拼版尺寸:
                selected_size = size
                break
        
        return (selected_path, selected_size)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "GuhaiCustomChildrenStickerLong": GuhaiCustomChildrenStickerLong
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuhaiCustomChildrenStickerLong": "孤海定制-儿童贴模板-长"
}