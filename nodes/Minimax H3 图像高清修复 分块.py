import gc
import math
import zlib

import cv2
import numpy as np
import torch
from aiohttp import web

import comfy.model_management
import comfy.sample
import comfy.samplers
import comfy.utils
import folder_paths
import latent_preview
import node_helpers
import nodes
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ImageConditioning
from comfy_execution.graph_utils import GraphBuilder
from server import PromptServer


OVERLAP = 256
FEATHER = 96
COLOR_METHODS = ["无", "wavelet", "lab", "adain", "mkl"]
H3TileConditions = io.Custom("GH_H3_TILE_CONDITIONS")
H3RepairedTiles = io.Custom("GH_H3_REPAIRED_TILES")


def _axis_plans(length, lower, upper):
    plans = []
    if length <= upper:
        plans.append([(0, length)])
    max_count = max(1, math.ceil((length - OVERLAP) / (512 - OVERLAP)))
    for count in range(2, max_count + 1):
        needed = math.ceil((length + OVERLAP * (count - 1)) / (count * 32)) * 32
        for size in sorted({needed, max(needed, math.ceil(lower / 32) * 32)}):
            if size < min(512, length) or size > upper or size >= length:
                continue
            starts = [round(index * (length - size) / (count - 1)) for index in range(count)]
            if any(b - a > size - OVERLAP for a, b in zip(starts, starts[1:])):
                continue
            plans.append([(start, start + size) for start in starts])
    return plans


def _plan_tiles(width, height, tile_size):
    tile_size = max(1536, min(4096, tile_size))
    lower, upper = max(1536, tile_size - 512), min(4096, tile_size + 512)
    if max(width, height) < lower:
        return [(0, width)], [(0, height)]
    best, best_score = None, None
    x_plans = _axis_plans(width, lower, upper)
    y_plans = _axis_plans(height, lower, upper)
    for xs in x_plans:
        for ys in y_plans:
            tile_w, tile_h = xs[0][1], ys[0][1]
            if not lower <= max(tile_w, tile_h) <= upper:
                continue
            # Count the actual 32-aligned sampling area, including every overlap.
            area = math.ceil(tile_w / 32) * 32 * math.ceil(tile_h / 32) * 32 * len(xs) * len(ys)
            score = (area, len(xs) * len(ys), abs(max(tile_w, tile_h) - tile_size), abs(tile_w - tile_h))
            if best_score is None or score < best_score:
                best, best_score = (xs, ys), score
    if best is None:
        # Prefer full coverage over the reference-size constraint when it cannot be met.
        best = tuple(min(plans, key=lambda intervals: (sum(end - start for start, end in intervals), len(intervals)))
                     for plans in (x_plans, y_plans))
    return best


def _tile_plan(width, height, output_long_edge, tile_size):
    scale = output_long_edge / max(width, height)
    output_width, output_height = (max(1, round(side * scale)) for side in (width, height))
    xs, ys = _plan_tiles(output_width, output_height, tile_size)

    text = (
        f"输出 {output_width}×{output_height} | 分块 {xs[0][1]}×{ys[0][1]} | {len(ys)}行×{len(xs)}列"
    )
    return output_width, output_height, xs, ys, text


@PromptServer.instance.routes.post("/goohai/h3_upscale/plan")
async def preview_tile_plan(request):
    data = await request.json()
    try:
        width, height, long_edge, tile_size = (int(data[key]) for key in ("width", "height", "output_long_edge", "tile_size"))
        if min(width, height) < 1 or not 2048 <= long_edge <= 12800 or not 1536 <= tile_size <= 4096:
            raise ValueError("尺寸超出支持范围")
        _, _, xs, ys, text = _tile_plan(width, height, long_edge, tile_size)
    except (KeyError, TypeError, ValueError, OverflowError):
        return web.json_response({"error": "无法计算分块，请检查图像及尺寸。"}, status=400)
    return web.json_response({"plan": text, "tile_count": len(xs) * len(ys)})


def _axis_blend(intervals, index):
    start, end = intervals[index]
    left = (intervals[index - 1][1] + start) / 2 if index else None
    right = (end + intervals[index + 1][0]) / 2 if index + 1 < len(intervals) else None
    keep_start = max(start, math.floor(left - FEATHER / 2)) if left is not None else start
    keep_end = min(end, math.ceil(right + FEATHER / 2)) if right is not None else end
    positions = np.arange(keep_start, keep_end, dtype=np.float32) + 0.5
    weights = np.ones(len(positions), dtype=np.float32)
    if left is not None:
        weights *= np.clip((positions - left + FEATHER / 2) / FEATHER, 0, 1)
    if right is not None:
        weights *= np.clip((right + FEATHER / 2 - positions) / FEATHER, 0, 1)
    return keep_start, keep_end, weights


def _match_colors(image, reference, method):
    if method == "无":
        return image
    if method == "wavelet":
        low_image, low_reference = image, reference
        for radius in (1, 2, 4, 8, 16):
            kernel = np.zeros(2 * radius + 1, dtype=np.float32)
            kernel[[0, radius, 2 * radius]] = (0.25, 0.5, 0.25)
            low_image = cv2.sepFilter2D(low_image, -1, kernel, kernel, borderType=cv2.BORDER_REPLICATE)
            low_reference = cv2.sepFilter2D(low_reference, -1, kernel, kernel, borderType=cv2.BORDER_REPLICATE)
        return np.clip(image - low_image + low_reference, 0, 1)

    working, guide = image, reference
    if method == "lab":
        working = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
        guide = cv2.cvtColor(reference, cv2.COLOR_RGB2LAB)
    stride = max(1, math.ceil(max(image.shape[:2]) / 256))
    source_pixels = working[::stride, ::stride].reshape(-1, 3).astype(np.float64)
    reference_pixels = guide[::stride, ::stride].reshape(-1, 3).astype(np.float64)
    source_mean, reference_mean = source_pixels.mean(0), reference_pixels.mean(0)

    if method == "mkl":
        source_centered = source_pixels - source_mean
        reference_centered = reference_pixels - reference_mean
        source_cov = source_centered.T @ source_centered / max(1, len(source_pixels) - 1)
        reference_cov = reference_centered.T @ reference_centered / max(1, len(reference_pixels) - 1)
        values, vectors = np.linalg.eigh(source_cov)
        roots = np.sqrt(np.maximum(values, 1e-8))
        source_root = (vectors * roots) @ vectors.T
        source_inverse = (vectors / roots) @ vectors.T
        values, vectors = np.linalg.eigh(source_root @ reference_cov @ source_root)
        middle_root = (vectors * np.sqrt(np.maximum(values, 0))) @ vectors.T
        transform = source_inverse @ middle_root @ source_inverse
    else:
        transform = np.diag(reference_pixels.std(0) / np.maximum(source_pixels.std(0), 1e-6))
    matrix = np.column_stack((transform, reference_mean - transform @ source_mean)).astype(np.float32)
    result = cv2.transform(working, matrix)
    if method == "lab":
        result = cv2.cvtColor(result, cv2.COLOR_LAB2RGB)
    return np.clip(result, 0, 1)


def _model_default(options, filename):
    default = next((name for name in options if name.replace("\\", "/").rsplit("/", 1)[-1] == filename), filename)
    if default not in options:
        options.append(default)
    return default


def _registration_image(image, size):
    small = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small[..., :3], cv2.COLOR_RGB2GRAY)
    return cv2.GaussianBlur(gray, (0, 0), 1.5)


def _correlation(reference, aligned):
    return cv2.computeECC(reference[4:-4, 4:-4], aligned[4:-4, 4:-4])


def _local_offsets(reference, aligned):
    height, width = reference.shape
    rows = np.linspace(0, height - 1, 7).round().astype(int)
    columns = np.linspace(0, width - 1, 7).round().astype(int)
    radius = max(24, min(height, width) // 7)
    limit = min(height, width) * 0.01
    offsets = np.zeros((len(rows), len(columns), 2), dtype=np.float32)
    for row, y in enumerate(rows):
        for column, x in enumerate(columns):
            window = np.s_[max(0, y - radius):y + radius + 1, max(0, x - radius):x + radius + 1]
            fixed, moving = reference[window].copy(), aligned[window].copy()
            if min(fixed.std(), moving.std()) < 0.015:
                continue
            try:
                score, matrix = cv2.findTransformECC(
                    fixed, moving, np.eye(2, 3, dtype=np.float32), cv2.MOTION_TRANSLATION,
                    (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 35, 1e-5),
                )
                delta = matrix[:, 2]
                corrected = cv2.warpAffine(
                    moving, matrix, fixed.shape[::-1], flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                    borderMode=cv2.BORDER_REFLECT_101,
                )
                if score >= 0.94 and np.linalg.norm(delta) <= limit and (
                    _correlation(fixed, corrected) > _correlation(fixed, moving) + 0.0001
                ):
                    offsets[row, column] = delta
            except cv2.error:
                continue
    grid_x, grid_y = np.meshgrid(
        np.interp(np.arange(width), columns, np.arange(len(columns))).astype(np.float32),
        np.interp(np.arange(height), rows, np.arange(len(rows))).astype(np.float32),
    )
    flow = cv2.remap(offsets, grid_x, grid_y, cv2.INTER_LINEAR)
    return cv2.GaussianBlur(flow, (0, 0), 4)


def _align_image(reference, generated):
    height, width = generated.shape[:2]
    scale = min(1.0, 640 / max(height, width))
    small_width, small_height = round(width * scale), round(height * scale)
    if min(small_width, small_height) < 64:
        return generated
    size = (small_width, small_height)
    fixed, moving = _registration_image(reference, size), _registration_image(generated, size)
    if min(fixed.std(), moving.std()) < 0.01:
        return generated
    try:
        score, matrix = cv2.findTransformECC(
            fixed, moving, np.eye(2, 3, dtype=np.float32), cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 100, 1e-6),
        )
    except cv2.error:
        return generated
    linear = matrix[:, :2]
    if score < 0.94 or not np.isfinite(matrix).all() or np.max(np.abs(linear - np.eye(2))) > 0.025:
        return generated
    corners = np.array([[0, 0], [0, small_height - 1], [small_width - 1, 0],
                        [small_width - 1, small_height - 1]])
    if np.max(np.abs(corners @ (linear - np.eye(2)).T + matrix[:, 2])) > 0.035 * min(size):
        return generated
    aligned = cv2.warpAffine(
        moving, matrix, size, flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_REFLECT_101,
    )
    base_score, aligned_score = _correlation(fixed, moving), _correlation(fixed, aligned)
    if aligned_score < base_score:
        matrix = np.eye(2, 3, dtype=np.float32)
        aligned, aligned_score = moving, base_score
    flow = _local_offsets(fixed, aligned)
    x, y = np.meshgrid(np.arange(small_width, dtype=np.float32), np.arange(small_height, dtype=np.float32))
    px, py = x + flow[..., 0], y + flow[..., 1]
    map_x = matrix[0, 0] * px + matrix[0, 1] * py + matrix[0, 2]
    map_y = matrix[1, 0] * px + matrix[1, 1] * py + matrix[1, 2]
    local = cv2.remap(moving, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    if _correlation(fixed, local) <= aligned_score + 0.000025:
        if aligned_score <= base_score + 0.000025:
            return generated
        map_x = matrix[0, 0] * x + matrix[0, 1] * y + matrix[0, 2]
        map_y = matrix[1, 0] * x + matrix[1, 1] * y + matrix[1, 2]
    # Resample the full-resolution detail only once after estimating the displacement.
    dx = cv2.resize(map_x - x, (width, height), interpolation=cv2.INTER_LINEAR) * (width / small_width)
    dy = cv2.resize(map_y - y, (width, height), interpolation=cv2.INTER_LINEAR) * (height / small_height)
    dx += np.arange(width, dtype=np.float32)
    dy += np.arange(height, dtype=np.float32)[:, None]
    return cv2.remap(generated, dx, dy, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT_101)


def _encode_tile(clip, vae, reference, prompt, vision_size="1024"):
    height, width = reference.shape[:2]
    prepared = reference
    if vision_size != "跟随分块":
        scale = int(vision_size) / min(width, height)
        ref_width, ref_height = (max(32, round(side * scale / 32) * 32) for side in (width, height))
        if max(ref_width, ref_height) < max(width, height):
            prepared = cv2.resize(reference, (ref_width, ref_height), interpolation=cv2.INTER_CUBIC)
    # Whole-image axes can retain an arbitrary output size; stretch rather than crop them.
    prepared_height, prepared_width = prepared.shape[:2]
    aligned_width, aligned_height = (math.ceil(side / 32) * 32 for side in (prepared_width, prepared_height))
    if (aligned_width, aligned_height) != (prepared_width, prepared_height):
        prepared = cv2.resize(prepared, (aligned_width, aligned_height), interpolation=cv2.INTER_CUBIC)
    prepared = torch.from_numpy(np.clip(prepared, 0, 1)).unsqueeze(0)
    sample_width, sample_height = (math.ceil(side / 32) * 32 for side in (width, height))
    conditioning = MiniMaxH3ImageConditioning.execute(
        clip=clip, prompt=prompt, width=sample_width, height=sample_height,
        images={"image_0": prepared},
    )
    positive, latent = conditioning.args
    reference_latent = vae.encode(prepared)
    positive = node_helpers.conditioning_set_values(positive, {"minimax_refs": [{
        "kind": "image", "latent_h": reference_latent.shape[-2],
        "latent_w": reference_latent.shape[-1], "latent": reference_latent,
    }]})
    positive = _conditioning_to_cpu(positive)
    negative, = nodes.ConditioningZeroOut().zero_out(positive)
    return positive, negative, tuple(latent["samples"].shape)


def _sample_tile(model, encoded, seed, steps, sampler_name, scheduler, report):
    positive, negative, latent_shape = encoded
    latent = {"samples": torch.zeros(latent_shape, device=comfy.model_management.intermediate_device())}
    latent_image = comfy.sample.fix_empty_latent_channels(model, latent["samples"])
    noise = comfy.sample.prepare_noise(latent_image, seed)
    preview_callback = latent_preview.prepare_callback(model, steps)

    def callback(step, x0, x, total_steps):
        preview_callback(step, x0, x, total_steps)
        report("采样", step + 1, total_steps)

    report("采样", 0, steps)
    samples = comfy.sample.sample(
        model, noise, steps, 1.0, sampler_name, scheduler, positive, negative, latent_image,
        denoise=1.0, callback=callback, disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED, seed=seed,
    )
    return samples.detach().to(device="cpu")


def _decode_tile(vae, reference, samples, report):
    height, width = reference.shape[:2]
    report("VAE解码中...")
    decoded, = nodes.VAEDecode().decode(vae, {"samples": samples})
    decoded = decoded.detach().to(device="cpu", dtype=torch.float32)
    if decoded.shape[1:3] != (height, width):
        restored = cv2.resize(decoded[0].numpy(), (width, height), interpolation=cv2.INTER_CUBIC)
        decoded = torch.from_numpy(np.clip(restored, 0, 1)).unsqueeze(0)
    report("像素对齐中...")
    aligned = _align_image(reference, decoded[0].numpy())
    return np.clip(aligned, 0, 1)


class MinimaxH3图像高清修复分块(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        models = folder_paths.get_filename_list("diffusion_models")
        clips = folder_paths.get_filename_list("text_encoders")
        vaes = folder_paths.get_filename_list("vae")
        loras = ["无", *folder_paths.get_filename_list("loras")]
        return io.Schema(
            node_id="Minimax H3 图像高清修复 分块",
            category="孤海工具箱/图像",
            description="MiniMax H3 Image 分块高清修复。参考VAE短边默认1024，可选择尺寸或跟随分块；至少256像素重叠，中心96像素羽化；逐块对齐并还原颜色。",
            inputs=[
                io.Image.Input("图像", raw_link=True),
                io.Combo.Input("模型", options=models, socketless=True,
                               default=_model_default(models, "minimax_h3_image_pruned_int8_convrot.safetensors")),
                io.Combo.Input("CLIP", options=clips, socketless=True,
                               default=_model_default(clips, "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors")),
                io.Combo.Input("VAE", options=vaes, socketless=True,
                               default=_model_default(vaes, "minimax_h3_image_vae_fp16.safetensors")),
                io.Combo.Input("LoRA", options=loras,
                               default=_model_default(loras, "minimax-H3-image-高清放大_GH.safetensors"), socketless=True),
                io.Float.Input("LoRA强度", default=1.0, min=-100.0, max=100.0, step=0.01,
                               socketless=True),
                io.String.Input("提示词", multiline=True, raw_link=True, default="保持构图与颜色不变，将图像高清还原为惊人的8K画质。"),
                io.Int.Input("输出长边", default=3072, min=2048, max=12800, step=256,
                             display_mode=io.NumberDisplay.slider, socketless=True),
                io.Int.Input("分块尺寸", default=3072, min=1536, max=4096, step=256,
                             display_mode=io.NumberDisplay.slider, socketless=True),
                io.Combo.Input("视觉编码尺寸", options=["跟随分块", "1024", "1280", "1536", "1792", "2048"],
                               default="1024", socketless=True,
                               tooltip="VAE参考图编码短边，编码长边不超过实际分块长边。跟随分块时不做缩放。"),
                io.Int.Input("种子值", default=833914818116436, min=0, max=0xffffffffffffffff,
                             control_after_generate=io.ControlAfterGenerate.fixed, socketless=True),
                io.Int.Input("步数", default=6, min=1, max=10000, socketless=True),
                io.Combo.Input("采样器", options=comfy.samplers.KSampler.SAMPLERS, default="lcm",
                               socketless=True),
                io.Combo.Input("调度器", options=comfy.samplers.KSampler.SCHEDULERS, default="simple",
                               socketless=True),
                io.Combo.Input("颜色匹配", options=COLOR_METHODS, default="无", socketless=True),
                io.Boolean.Input("释放模型", default=False, socketless=True,
                                 tooltip="完成后卸载本节点模型并释放空闲显存，保留条件及分块缓存；下次采样需重新加载模型到显卡。"),
                io.Combo.Input("LoRA2", options=loras, default="无", socketless=True, optional=True),
                io.Float.Input("LoRA2强度", default=1.0, min=-100.0, max=100.0, step=0.01,
                               socketless=True, optional=True),
                io.Int.Input("LoRA数量", default=1, min=0, max=2, socketless=True, optional=True),
            ],
            outputs=[io.Image.Output("图像")],
            hidden=[io.Hidden.unique_id],
            enable_expand=True,
        )

    @classmethod
    def validate_inputs(cls, 模型, CLIP, VAE, LoRA, LoRA2="无"):
        # Check files at execution; inactive LoRAs are ignored.
        return True

    @classmethod
    def execute(cls, 图像, 模型, CLIP, VAE, LoRA, LoRA强度, 提示词,
                输出长边, 分块尺寸, 颜色匹配, 种子值, 步数, 采样器, 调度器, 释放模型=False, 视觉编码尺寸="1024",
                LoRA2="无", LoRA2强度=1.0, LoRA数量=1):
        required_models = [("模型", "diffusion_models", 模型), ("CLIP", "text_encoders", CLIP), ("VAE", "vae", VAE)]
        active_loras = [(index, name, strength)
                        for index, (name, strength) in enumerate(((LoRA, LoRA强度), (LoRA2, LoRA2强度)))
                        if index < LoRA数量 and name != "无" and strength != 0]
        for index, name, strength in active_loras:
            required_models.append(("LoRA" if index == 0 else "LoRA2", "loras", name))
        for label, folder, name in required_models:
            if folder_paths.get_full_path(folder, name) is None:
                raise FileNotFoundError(f"找不到{label}模型：{name}。请放入 models/{folder} 或选择已安装的模型。")
        graph = GraphBuilder()
        owner = cls.hidden.unique_id
        clip = graph.node("CLIPLoader", id="clip", clip_name=CLIP, type="minimax", device="default")
        vae = graph.node("VAELoader", id="vae", vae_name=VAE)
        conditions = graph.node(
            "H3TiledEncodeGH", id="conditions", image=图像, clip=clip.out(0), vae=vae.out(0),
            prompt=提示词, output_long_edge=输出长边, tile_size=分块尺寸, owner=owner,
            vision_size=视觉编码尺寸,
        )
        model = graph.node("UNETLoader", id="model", unet_name=模型, weight_dtype="default")
        for index, name, strength in active_loras:
            model = graph.node(
                "LoraLoaderModelOnly", id=f"lora{index + 1}", model=model.out(0),
                lora_name=name, strength_model=strength,
            )
            model.set_override_display_id(owner)
        sampling = graph.node(
            "H3TiledSampleGH", id="sampling", image=图像, model=model.out(0), vae=vae.out(0),
            conditions=conditions.out(0),
            seed=种子值, steps=步数, sampler_name=采样器, scheduler=调度器, owner=owner,
        )
        finish = graph.node(
            "H3TiledFinishGH", id="finish", image=图像, tiles=sampling.out(0),
            color_match=颜色匹配, owner=owner, release_models=释放模型,
            model=model.out(0), clip=clip.out(0), vae=vae.out(0),
        )
        for internal in (clip, vae, conditions, model, sampling, finish):
            internal.set_override_display_id(owner)
        return io.NodeOutput(finish.out(0), expand=graph.finalize())


def _report_tile(plan, image, owner, batch_index, tile_number, tile_count, phase, completed=0, total=0):
    status = {
        "plan": plan, "phase": phase, "tile": tile_number, "tile_count": tile_count,
        "completed": completed, "total": total, "batch": batch_index + 1, "batch_count": image.shape[0],
        "source_width": image.shape[2], "source_height": image.shape[1],
    }
    if owner:
        PromptServer.instance.send_sync(
            "goohai_h3_upscale_status", {"node_id": owner, **status}, PromptServer.instance.client_id,
        )
    return status


def _conditioning_to_cpu(value):
    if isinstance(value, torch.Tensor):
        return value.to(device="cpu")
    if isinstance(value, dict):
        return {key: _conditioning_to_cpu(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_conditioning_to_cpu(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_conditioning_to_cpu(item) for item in value)
    return value


def _release_upscale_models(*patchers):
    for patcher in patchers:
        comfy.model_management.unload_model_and_clones(patcher, all_devices=True)
        patcher.partially_unload_ram(1e30)
    gc.collect()
    comfy.model_management.soft_empty_cache()


class H3TiledEncodeGH(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3TiledEncodeGH", is_dev_only=True,
            inputs=[
                io.Image.Input("image"), io.Clip.Input("clip"), io.Vae.Input("vae"),
                io.String.Input("prompt"), io.Int.Input("output_long_edge"), io.Int.Input("tile_size"),
                io.String.Input("owner"),
                io.String.Input("vision_size", default="1024", optional=True),
            ],
            outputs=[H3TileConditions.Output()],
        )

    @classmethod
    def execute(cls, image, clip, vae, prompt, output_long_edge, tile_size, owner, vision_size="1024"):
        height, width = image.shape[1:3]
        output_width, output_height, xs, ys, plan = _tile_plan(width, height, output_long_edge, tile_size)
        encoded = []
        progress = comfy.utils.ProgressBar(image.shape[0] * len(xs) * len(ys))
        for batch_index in range(image.shape[0]):
            frame = image[batch_index, ..., :3].detach().to(device="cpu", dtype=torch.float32).numpy()
            reference = cv2.resize(frame, (output_width, output_height), interpolation=cv2.INTER_NEAREST)
            np.clip(reference, 0, 1, out=reference)
            for row, (top, bottom) in enumerate(ys):
                for column, (left, right) in enumerate(xs):
                    comfy.model_management.throw_exception_if_processing_interrupted()
                    tile_number = row * len(xs) + column + 1
                    _report_tile(plan, image, owner, batch_index, tile_number, len(xs) * len(ys), "条件编码中...")
                    positive, negative, shape = _encode_tile(clip, vae, reference[top:bottom, left:right], prompt, vision_size)
                    encoded.append((positive, negative, shape))
                    del positive, negative
                    progress.update(1)
        return io.NodeOutput({
            "encoded": encoded, "output_width": output_width, "output_height": output_height,
            "xs": xs, "ys": ys, "plan": plan,
        })


class H3TiledSampleGH(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3TiledSampleGH", is_dev_only=True,
            inputs=[
                io.Image.Input("image"), io.Model.Input("model"), io.Vae.Input("vae"),
                H3TileConditions.Input("conditions"),
                io.Int.Input("seed"), io.Int.Input("steps"), io.String.Input("sampler_name"),
                io.String.Input("scheduler"), io.String.Input("owner"),
            ],
            outputs=[H3RepairedTiles.Output()],
        )

    @classmethod
    def execute(cls, image, model, vae, conditions, seed, steps, sampler_name, scheduler, owner):
        output_width, output_height = conditions["output_width"], conditions["output_height"]
        xs, ys, plan_text = conditions["xs"], conditions["ys"], conditions["plan"]
        tile_count = len(xs) * len(ys)

        batch_index, tile_number = 0, 0

        def report(phase, completed=0, total=0):
            return _report_tile(
                plan_text, image, owner, batch_index, tile_number, tile_count, phase, completed, total,
            )

        report("条件已就绪，准备采样...")
        sampled_tiles = []
        repaired = []
        progress = comfy.utils.ProgressBar(image.shape[0] * tile_count * 2)
        for batch_index in range(image.shape[0]):
            for row in range(len(ys)):
                for column in range(len(xs)):
                    comfy.model_management.throw_exception_if_processing_interrupted()
                    tile_index = (batch_index * len(ys) + row) * len(xs) + column
                    tile_number = row * len(xs) + column + 1
                    tile_seed = (seed + tile_index) % (1 << 64)
                    sampled_tiles.append(_sample_tile(
                        model, conditions["encoded"][tile_index],
                        tile_seed, steps, sampler_name, scheduler, report,
                    ))
                    progress.update(1)

        for batch_index in range(image.shape[0]):
            frame = image[batch_index, ..., :3].detach().to(device="cpu", dtype=torch.float32).numpy()
            reference = cv2.resize(frame, (output_width, output_height), interpolation=cv2.INTER_NEAREST)
            np.clip(reference, 0, 1, out=reference)
            for row, (top, bottom) in enumerate(ys):
                for column, (left, right) in enumerate(xs):
                    comfy.model_management.throw_exception_if_processing_interrupted()
                    tile_reference = reference[top:bottom, left:right]
                    tile_index = (batch_index * len(ys) + row) * len(xs) + column
                    tile_number = row * len(xs) + column + 1
                    tile = _decode_tile(vae, tile_reference, sampled_tiles[tile_index], report)
                    sampled_tiles[tile_index] = None
                    packed = zlib.compress(tile.tobytes(), level=1)
                    repaired.append((torch.frombuffer(bytearray(packed), dtype=torch.uint8), tile.shape))
                    del tile, packed
                    progress.update(1)
        return io.NodeOutput({
            "repaired": repaired, "output_width": output_width, "output_height": output_height,
            "xs": xs, "ys": ys, "plan": plan_text,
        })


class H3TiledFinishGH(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="H3TiledFinishGH", is_dev_only=True,
            inputs=[
                io.Image.Input("image"), H3RepairedTiles.Input("tiles"),
                io.String.Input("color_match"), io.String.Input("owner"),
                io.Boolean.Input("release_models", default=False),
                io.Model.Input("model"), io.Clip.Input("clip"), io.Vae.Input("vae"),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, tiles, color_match, owner, release_models, model, clip, vae):
        if color_match not in COLOR_METHODS:
            raise ValueError(f"未知颜色匹配方式：{color_match}")
        output_width, output_height = tiles["output_width"], tiles["output_height"]
        xs, ys, plan_text = tiles["xs"], tiles["ys"], tiles["plan"]
        x_blends = [_axis_blend(xs, index) for index in range(len(xs))]
        y_blends = [_axis_blend(ys, index) for index in range(len(ys))]
        tile_count = len(xs) * len(ys)
        batch_index, tile_number = 0, 0

        def report(phase):
            return _report_tile(plan_text, image, owner, batch_index, tile_number, tile_count, phase)

        result = torch.empty((image.shape[0], output_height, output_width, 3), dtype=torch.float32, device="cpu")
        progress = comfy.utils.ProgressBar(image.shape[0] * tile_count)
        for batch_index in range(image.shape[0]):
            frame, reference, tile_reference = None, None, None
            if color_match != "无":
                frame = image[batch_index, ..., :3].detach().to(device="cpu", dtype=torch.float32).numpy()
                reference = cv2.resize(frame, (output_width, output_height), interpolation=cv2.INTER_NEAREST)
                np.clip(reference, 0, 1, out=reference)
            canvas = result[batch_index].numpy()
            canvas.fill(0)
            for row, (top, bottom) in enumerate(ys):
                y0, y1, wy = y_blends[row]
                for column, (left, right) in enumerate(xs):
                    comfy.model_management.throw_exception_if_processing_interrupted()
                    x0, x1, wx = x_blends[column]
                    tile_index = (batch_index * len(ys) + row) * len(xs) + column
                    tile_number = row * len(xs) + column + 1
                    packed, shape = tiles["repaired"][tile_index]
                    tile = np.frombuffer(zlib.decompress(packed.numpy().tobytes()), dtype=np.float32).reshape(shape)
                    report("颜色还原中..." if color_match != "无" else "拼接中...")
                    if color_match != "无":
                        tile_reference = reference[top:bottom, left:right]
                        tile = _match_colors(tile, tile_reference, color_match)
                        report("拼接中...")
                    visible = tile[y0 - top:y1 - top, x0 - left:x1 - left]
                    # Complementary ramps form a partition of unity, including four-tile intersections.
                    weight = wy[:, None] * wx[None, :]
                    canvas[y0:y1, x0:x1] += visible * weight[..., None]
                    del tile, visible, weight
                    progress.update(1)
            np.clip(canvas, 0, 1, out=canvas)
        tile_number = 0
        del frame, reference, tile_reference, canvas
        if release_models:
            _release_upscale_models(model, clip.patcher, vae.patcher)
        status = report("修复完成")
        return io.NodeOutput(result, ui={"gh_h3_upscale": [status]})


NODE_CLASS_MAPPINGS = {
    "Minimax H3 图像高清修复 分块": MinimaxH3图像高清修复分块,
    "H3TiledEncodeGH": H3TiledEncodeGH,
    "H3TiledSampleGH": H3TiledSampleGH,
    "H3TiledFinishGH": H3TiledFinishGH,
}
