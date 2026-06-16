import torch
import numpy as np
from PIL import Image
import os
from server import PromptServer
from aiohttp import web


class MarriageRegistrationCloth:
    """结婚登记照服装选择节点 — 孤海"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "服装序号": ("INT", {
                    "default": 1,
                    "min": 0,
                    "max": 512,
                    "step": 1,
                    "display": "number",
                }),
            },
            "hidden": {
                "cloth_name": "STRING",
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "execute"
    CATEGORY = "孤海/结婚登记照"

    # ── 路径与文件列表 ──────────────────────────────
    @classmethod
    def _image_dir(cls):
        return os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "image", "marriage registration"
        )

    @classmethod
    def _image_files(cls):
        d = cls._image_dir()
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
            return []
        return sorted(
            f for f in os.listdir(d)
            if f.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp', '.webp'))
        )

    # ── 执行 ────────────────────────────────────────
    def execute(self, 服装序号, cloth_name=""):
        files = self._image_files()


        if 服装序号 == 0:
            # 创建纯色图像
            img = Image.new('RGB', (1024, 512), '#6c1e27')
            arr = np.array(img, dtype=np.float32) / 255.0
            return (torch.from_numpy(arr).unsqueeze(0),)

        if not files:
            # 如果没有图片文件，也返回纯色图像
            img = Image.new('RGB', (1024, 512), '#6c1e27')
            arr = np.array(img, dtype=np.float32) / 255.0
            return (torch.from_numpy(arr).unsqueeze(0),)

        # 正常情况：处理有效的服装序号
        idx = max(0, min(服装序号 - 1, len(files) - 1))
        
        # 如果cloth_name存在且在files中，优先使用cloth_name
        if cloth_name and cloth_name in files:
            idx = files.index(cloth_name)

        path = os.path.join(self._image_dir(), files[idx])
        img = Image.open(path).convert("RGB")
        if img.size != (1024, 512):
            img = img.resize((1024, 512), Image.LANCZOS)

        arr = np.array(img, dtype=np.float32) / 255.0
        return (torch.from_numpy(arr).unsqueeze(0),)


# ═══════════════════ API 路由 ═══════════════════════
@PromptServer.instance.routes.get("/marriage_registration/list")
async def _api_list(request):
    return web.json_response({
        "images": MarriageRegistrationCloth._image_files()
    })


@PromptServer.instance.routes.get("/marriage_registration/image")
async def _api_image(request):
    name = os.path.basename(request.query.get("name", ""))
    if not name:
        return web.Response(status=400, text="missing name")
    p = os.path.join(MarriageRegistrationCloth._image_dir(), name)
    if not os.path.isfile(p):
        return web.Response(status=404, text="not found")
    return web.FileResponse(p)


# ═══════════════════ 注册 ═══════════════════════════
NODE_CLASS_MAPPINGS = {
    "结婚登记照服装_孤海": MarriageRegistrationCloth,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "结婚登记照服装_孤海": "结婚登记照服装 孤海",
}