import os
import importlib.util
import sys
from pathlib import Path

# 获取当前包目录的路径
current_dir = Path(__file__).parent
nodes_dir = current_dir / "nodes"

# 初始化全局映射字典
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# 遍历nodes目录中的所有Python文件
for file_path in nodes_dir.glob("*.py"):
    # 跳过__init__.py文件
    if file_path.name == "__init__.py":
        continue
        
    # 提取模块名（不含.py后缀）
    module_name = file_path.stem
    
    # 使用importlib动态加载模块
    spec = importlib.util.spec_from_file_location(f"goohaitools.nodes.{module_name}", file_path)
    module = importlib.util.module_from_spec(spec)
    
    try:
        # 执行模块代码
        spec.loader.exec_module(module)
        
        # 检查并合并NODE_CLASS_MAPPINGS
        if hasattr(module, 'NODE_CLASS_MAPPINGS'):
            NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
            
        # 检查并合并NODE_DISPLAY_NAME_MAPPINGS
        if hasattr(module, 'NODE_DISPLAY_NAME_MAPPINGS'):
            NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
            
    except Exception as e:
        print(f"Error loading node module {module_name}: {str(e)}")
        continue

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']