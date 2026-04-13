import math

class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

any = AnyType("*")

HELP_TEXT = """┌─────────────────────────────┐
│         数学运算 孤海 — 表达式用法        │
└─────────────────────────────┘

【输入变量】
  a, b, c, d, f  (支持 int / float / 字符串数字)

【算术运算符】
  +   加法        a + b
  -   减法        a - b
  *   乘法        a * b
  /   除法        a / b          → 浮点结果
  //  整除        a // b         → 向下取整
  %   取余        a % b
  **  幂运算      a ** 10        → a 的 10 次方

【比较运算符】
  ==  等于        a == b  → True:1 / False:0
  !=  不等于      a != b
  >   大于        a > b
  <   小于        a < b
  >=  大于等于    a >= b
  <=  小于等于    a <= b

【逻辑运算符】
  and  与         (a>0) and (b>0)
  or   或         (a>0) or (b>0)
  not  非         not(a>0)

【数学函数 — 取整函数】
  ceil(x)    向上取整        ceil(a)
  floor(x)   向下取整        floor(a)
  trunc(x)   截断小数        trunc(a)


【位运算符】
  &   按位与      int(a) & int(b)
  |   按位或      int(a) | int(b)
  ^   按位异或    int(a) ^ int(b)
  ~   按位取反    ~int(a)
  <<  左移        int(a) << int(b)
  >>  右移        int(a) >> int(b)

【内置函数】
  abs(x)          绝对值          abs(a)
  round(x)        四舍五入        round(a)
  round(x, n)     保留n位小数     round(a, 2)
  min(a, b, ...)  最小值          min(a, b, c)
  max(a, b, ...)  最大值          max(a, b, c)
  pow(x, y)       幂运算          pow(a, 10)
  int(x)          转整数          int(a)
  float(x)        转浮点          float(a)
  sum([...])      求和            sum([a, b, c])

【数学函数 — 三角函数】
  sin(x)     正弦            sin(a)
  cos(x)     余弦            cos(a)
  tan(x)     正切            tan(a)
  asin(x)    反正弦          asin(a)
  acos(x)    反余弦          acos(a)
  atan(x)    反正切          atan(a)
  atan2(y,x) 双参反正切      atan2(a, b)
  sinh(x)    双曲正弦        sinh(a)
  cosh(x)    双曲余弦        cosh(a)
  tanh(x)    双曲正切        tanh(a)

【数学函数 — 对数与指数】
  sqrt(x)    平方根          sqrt(a)
  exp(x)     e 的 x 次方     exp(a)
  log(x)     自然对数 ln     log(a)
  log(x, b)  指定底数对数    log(a, 10)
  log2(x)    以2为底对数     log2(a)
  log10(x)   以10为底对数    log10(a)
  pow(x, y)  幂运算(返回float) pow(a, 2)

【数学函数 — 其他函数】
  fabs(x)    绝对值(返回float)  fabs(a)
  fmod(x,y)  浮点取余         fmod(a, b)
  fsum([...]) 精确浮点求和     fsum([a, b])
  copysign(x,y) 用y的符号赋给x  copysign(a, b)
  hypot(x, y) 欧几里得距离     hypot(a, b)
  degrees(x) 弧度转角度        degrees(a)
  radians(x) 角度转弧度        radians(a)
  isnan(x)   是否为NaN        isnan(a)  → 1/0
  isinf(x)   是否为无穷大      isinf(a)  → 1/0
  isfinite([0,0],[a,b])
  prod([...])(x) 是否为有限数     isfinite(a) → 1/0
  factorial(x) 阶乘            factorial(int(a))
  gcd(x, y)  最大公约数        gcd(int(a), int(b))
  dist([...],[...]) 两点距离   dist 列表乘积         prod([a, b, c])

【数学常量】
  pi         圆周率 3.141592653589793
  e          自然常数 2.718281828459045
  tau        2π = 6.283185307179586

【常用示例】
  a**10                  a 的 10 次方
  sqrt(a**2 + b**2)      勾股定理
  round(a/b * 100, 2)    百分比保留2位
  max(a, b, c)           三者取最大
  min(a, b) * 0.5        最小值的一半
  int(a) | int(b)        位运算或
  (a + b + c) / 3        平均值
  log(a, 2)              以2为底的对数
  radians(a)             角度转弧度
  a if a > b else b      三元表达式"""

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
                "f": (any, {"default": 0, "forceInput": True}),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "INT", "FLOAT", "STRING")
    RETURN_NAMES = ("整数1", "浮点1", "整数2", "浮点2", "？帮助")
    FUNCTION = "calculate"
    CATEGORY = "孤海工具箱"
    OUTPUT_NODE = False

    def to_number(self, value):
        if value is None:
            return 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def calculate(self, 值1, 值2, a=0, b=0, c=0, d=0, f=0):
        # 两个表达式都为空时返回默认值 + 帮助文本
        if not 值1 and not 值2:
            return (0, 0.0, 0, 0.0, HELP_TEXT)

        a = self.to_number(a)
        b = self.to_number(b)
        c = self.to_number(c)
        d = self.to_number(d)
        f = self.to_number(f)

        # 构建安全字典，包含变量和内置函数
        safe_dict = {
            'a': a, 'b': b, 'c': c, 'd': d, 'f': f,
            'abs': abs, 'round': round, 'min': min, 'max': max,
            'pow': pow, 'int': int, 'float': float,
            'math': math,
            'sum': sum,
            'sqrt': math.sqrt,
            'sin': math.sin, 'cos': math.cos, 'tan': math.tan,
            'log': math.log, 'log10': math.log10,
            'pi': math.pi, 'e': math.e
        }

        # 将math模块的所有公共函数和常量以短名称形式添加到字典中
        # 这样在表达式中就可以直接使用 ceil(a) 而不需要 math.ceil(a)
        for name in dir(math):
            if name.startswith('_'):
                continue
            obj = getattr(math, name)
            # 添加可调用的函数和常量（数值）
            if callable(obj) or isinstance(obj, (int, float)):
                # 如果该名称尚未在字典中（避免覆盖已显式定义的如 'sqrt'）
                if name not in safe_dict:
                    safe_dict[name] = obj

        整数1, 浮点1, 整数2, 浮点2 = 0, 0.0, 0, 0.0

        if 值1:
            try:
                result1 = eval(值1, {"__builtins__": {}}, safe_dict)
                浮点1 = float(result1)
                整数1 = int(round(浮点1))
            except Exception as ex:
                raise ValueError(f"值1计算错误: {str(ex)}")

        if 值2:
            try:
                result2 = eval(值2, {"__builtins__": {}}, safe_dict)
                浮点2 = float(result2)
                整数2 = int(round(浮点2))
            except Exception as ex:
                raise ValueError(f"值2计算错误: {str(ex)}")

        return (整数1, 浮点1, 整数2, 浮点2, HELP_TEXT)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        def _norm(v):
            if v is None:
                return 0.0
            try:
                return float(v)
            except (TypeError, ValueError):
                return 0.0

        值1 = kwargs.get("值1", "")
        值2 = kwargs.get("值2", "")
        a = _norm(kwargs.get("a", 0))
        b = _norm(kwargs.get("b", 0))
        c = _norm(kwargs.get("c", 0))
        d = _norm(kwargs.get("d", 0))
        f = _norm(kwargs.get("f", 0))

        return f"{值1}|{值2}|{a:.10g}|{b:.10g}|{c:.10g}|{d:.10g}|{f:.10g}"

# 节点注册
NODE_CLASS_MAPPINGS = {
    "数学运算_孤海": MathExpressionNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "数学运算_孤海": "数学运算 孤海"
}
