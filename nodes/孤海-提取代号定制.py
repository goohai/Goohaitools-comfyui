import re

class 孤海_提取代号定制:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {"forceInput": True}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("代号",)
    FUNCTION = "extract_code"
    CATEGORY = "孤海定制"

    def extract_code(self, 文本):
        # 匹配A-H字母（忽略大小写）+ 1-2位数字
        match = re.search(r'([A-Ha-h])(\d{1,2})', 文本)
        
        if not match:
            raise ValueError("错误：未找到有效的A-H代号")
            
        # 提取完整匹配部分
        full_match = match.group(0)
        # 字母转为大写
        result = full_match[0].upper() + full_match[1:]
        
        return (result,)

NODE_CLASS_MAPPINGS = {
    "孤海-提取代号定制": 孤海_提取代号定制
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "孤海-提取代号定制": "孤海-提取代号定制"
}