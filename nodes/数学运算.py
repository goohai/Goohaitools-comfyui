import math
import ast
import operator as op

# 创建可以接受任何类型的输入端口
class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

any = AnyType("*")

class MathExpressionNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "值1": ("STRING", {"default": "", "placeholder": "例如: a+b*c, round(c/a)"}),
                "值2": ("STRING", {"default": "", "placeholder": "例如: (a+c-d*f)//2"}),
            },
            "optional": {
                "a": (any, {"default": 0, "forceInput": True}),
                "b": (any, {"default": 0, "forceInput": True}),
                "c": (any, {"default": 0, "forceInput": True}),
                "d": (any, {"default": 0, "forceInput": True}),
                "f": (any, {"default": 0, "forceInput": True}),  # 将 e 改为 f
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "INT", "FLOAT")
    RETURN_NAMES = ("整数1", "浮点1", "整数2", "浮点2")
    FUNCTION = "calculate"
    CATEGORY = "孤海工具箱"
    OUTPUT_NODE = False

    def calculate(self, 值1, 值2, a=0, b=0, c=0, d=0, f=0):  # 将 e 改为 f
        # 检查表达式是否都为空
        if not 值1 and not 值2:
            raise ValueError("值1和值2不能同时为空")
        
        # 将输入转换为数值
        def to_number(value):
            if value is None:
                return 0
            try:
                return float(value)
            except (TypeError, ValueError):
                return 0
        
        a = to_number(a)
        b = to_number(b)
        c = to_number(c)
        d = to_number(d)
        f = to_number(f)  # 将 e 改为 f
        
        # 创建安全的数学运算环境
        safe_dict = {
            'a': a, 'b': b, 'c': c, 'd': d, 'f': f,  # 将 e 改为 f
            'abs': abs, 'round': round, 'min': min, 'max': max,
            'pow': pow, 'int': int, 'float': float,
            'math': math
        }
        
        # 添加数学常量
        safe_dict.update({name: getattr(math, name) for name in dir(math) 
                         if not name.startswith('_') and isinstance(getattr(math, name), (int, float))})
        
        # 添加基本数学运算
        safe_dict.update({
            'sum': sum,
            'sqrt': math.sqrt,
            'sin': math.sin, 'cos': math.cos, 'tan': math.tan,
            'log': math.log, 'log10': math.log10,
            'pi': math.pi, 'e': math.e  # 保留数学常数 e
        })
        
        整数1, 浮点1, 整数2, 浮点2 = 0, 0.0, 0, 0.0
        
        # 计算值1
        if 值1:
            try:
                result1 = eval(值1, {"__builtins__": {}}, safe_dict)
                浮点1 = float(result1)
                整数1 = int(round(浮点1))
            except Exception as ex:
                raise ValueError(f"值1计算错误: {str(ex)}")
        
        # 计算值2
        if 值2:
            try:
                result2 = eval(值2, {"__builtins__": {}}, safe_dict)
                浮点2 = float(result2)
                整数2 = int(round(浮点2))
            except Exception as ex:
                raise ValueError(f"值2计算错误: {str(ex)}")
        
        return (整数1, 浮点1, 整数2, 浮点2)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

# 节点注册
NODE_CLASS_MAPPINGS = {
    "数学运算_孤海": MathExpressionNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "数学运算_孤海": "数学运算 孤海"
}