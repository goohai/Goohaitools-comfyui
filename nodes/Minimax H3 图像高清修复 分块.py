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
        needed = math.ceil((length + OVERLAP * (count - 1)) / count)
        for size in sorted({needed, max(needed, lower)}):
            if size < min(512, length) or size > upper or size >= length:
                continue
            starts = [round(index * (length - size) / (count - 1)) for index in range(count)]
            if any(b - a > size - OVERLAP for a, b in zip(starts, starts[1:])):
                continue
            plans.append([(start, start + size) for start in starts])
    return plans


def _plan_tiles(width, height, tile_size):
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
        raise ValueError("无法按当前输出尺寸和分块尺寸规划分块，请调整分块尺寸。")
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
    return next((name for name in options if name.replace("\\", "/").rsplit("/", 1)[-1] == filename),
                options[0] if options else None)


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


def _encode_tile(clip, vae, reference, prompt):
    height, width = reference.shape[:2]
    scale = 1024 / min(width, height)
    ref_width, ref_height = (max(32, round(side * scale / 32) * 32) for side in (width, height))
    prepared = cv2.resize(reference, (ref_width, ref_height), interpolation=cv2.INTER_CUBIC)
    prepared = torch.from_numpy(np.clip(prepared, 0, 1)).unsqueeze(0)
    sample_width, sample_height = (math.ceil(side / 32) * 32 for side in (width, height))
    conditioning = MiniMaxH3ImageConditioning.execute(
        clip=clip, prompt=prompt, width=sample_width, height=sample_height,
        vae=vae, images={"image_0": prepared},
    )
    positive, latent = conditioning.args
    negative, = nodes.ConditioningZeroOut().zero_out(positive)
    return positive, negative, tuple(latent["samples"].shape)


def _sample_tile(model, vae, reference, encoded, seed, steps, sampler_name, scheduler, report):
    height, width = reference.shape[:2]
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
    sampled = {**latent, "samples": samples}
    report("VAE解码中...")
    decoded, = nodes.VAEDecode().decode(vae, sampled)
    decoded = decoded.detach().to(device="cpu", dtype=torch.float32)
    if decoded.shape[1:3] != (height, width):
        restored = cv2.resize(decoded[0].numpy(), (width, height), interpolation=cv2.INTER_CUBIC)
        decoded = torch.from_numpy(np.clip(restored, 0, 1)).unsqueeze(0)
    report("像素对齐中...")
    aligned = _align_image(reference, decoded[0].numpy())
    return np.clip(aligned, 0, 1)


class H3TiledUpscaleGH(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        models = folder_paths.get_filename_list("diffusion_models")
        clips = folder_paths.get_filename_list("text_encoders")
        vaes = folder_paths.get_filename_list("vae")
        loras = ["无", *folder_paths.get_filename_list("loras")]
        return io.Schema(
            node_id="H3TiledUpscaleGH",
            display_name="Minimax H3 图像高清修复 分块",
            category="孤海工具箱/图像",
            description="MiniMax H3 Image 分块高清修复。参考VAE短边1024，至少128像素重叠，中心64像素羽化；逐块对齐并还原颜色。",
            inputs=[
                io.Image.Input("image", display_name="图像", raw_link=True),
                io.Combo.Input("model_name", options=models, display_name="模型", socketless=True,
                               default=_model_default(models, "minimax_h3_image_pruned_int8_convrot.safetensors")),
                io.Combo.Input("clip_name", options=clips, display_name="CLIP", socketless=True,
                               default=_model_default(clips, "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors")),
                io.Combo.Input("vae_name", options=vaes, display_name="VAE", socketless=True,
                               default=_model_default(vaes, "minimax_h3_image_vae_fp16.safetensors")),
                io.Combo.Input("lora_name", options=loras, default="无", display_name="LoRA", socketless=True),
                io.Float.Input("lora_strength", default=1.0, min=-100.0, max=100.0, step=0.01,
                               display_name="LoRA强度", socketless=True),
                io.String.Input("prompt", multiline=True, raw_link=True, default="保持构图与颜色不变，将图像高清还原为惊人的8K画质",
                                display_name="提示词", tooltip="可直接输入，或将文本框转换为输入后连接外部提示词。"),
                io.Int.Input("output_long_edge", default=4096, min=2048, max=12800, step=256,
                             display_name="输出长边", display_mode=io.NumberDisplay.slider, socketless=True),
                io.Int.Input("tile_size", default=2048, min=1536, max=4096, step=256,
                             display_name="分块尺寸", display_mode=io.NumberDisplay.slider, socketless=True,
                             tooltip="参考值。分块长边在1536～4096且偏差不超过512；整图较小时直接处理整图。部分尺寸组合会有较大重叠。"),
                io.Int.Input("seed", default=833914818116436, min=0, max=0xffffffffffffffff,
                             control_after_generate=True, display_name="种子值", socketless=True),
                io.Int.Input("steps", default=6, min=1, max=10000, display_name="步数", socketless=True),
                io.Combo.Input("sampler_name", options=comfy.samplers.KSampler.SAMPLERS, default="euler",
                               display_name="采样器", socketless=True),
                io.Combo.Input("scheduler", options=comfy.samplers.KSampler.SCHEDULERS, default="simple",
                               display_name="调度器", socketless=True),
                io.Combo.Input("color_match", options=COLOR_METHODS, default="wavelet", display_name="颜色匹配", socketless=True),
                io.Boolean.Input("release_models", default=False, display_name="释放模型", socketless=True,
                                 tooltip="完成后卸载本节点模型并释放空闲显存，保留条件及分块缓存；下次采样需重新加载模型到显卡。"),
            ],
            outputs=[io.Image.Output(display_name="图像")],
            hidden=[io.Hidden.unique_id],
            enable_expand=True,
        )

    @classmethod
    def execute(cls, image, model_name, clip_name, vae_name, lora_name, lora_strength, prompt,
                output_long_edge, tile_size, color_match, seed, steps, sampler_name, scheduler, release_models=False):
        graph = GraphBuilder()
        owner = cls.hidden.unique_id
        clip = graph.node("CLIPLoader", id="clip", clip_name=clip_name, type="minimax", device="default")
        vae = graph.node("VAELoader", id="vae", vae_name=vae_name)
        conditions = graph.node(
            "H3TiledEncodeGH", id="conditions", image=image, clip=clip.out(0), vae=vae.out(0),
            prompt=prompt, output_long_edge=output_long_edge, tile_size=tile_size, owner=owner,
        )
        model = graph.node("UNETLoader", id="model", unet_name=model_name, weight_dtype="default")
        if lora_name != "无" and lora_strength != 0:
            model = graph.node(
                "LoraLoaderModelOnly", id="lora", model=model.out(0),
                lora_name=lora_name, strength_model=lora_strength,
            )
        sampling = graph.node(
            "H3TiledSampleGH", id="sampling", image=image, model=model.out(0), vae=vae.out(0),
            conditions=conditions.out(0),
            seed=seed, steps=steps, sampler_name=sampler_name, scheduler=scheduler, owner=owner,
        )
        finish = graph.node(
            "H3TiledFinishGH", id="finish", image=image, tiles=sampling.out(0),
            color_match=color_match, owner=owner, release_models=release_models,
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
            ],
            outputs=[H3TileConditions.Output()],
        )

    @classmethod
    def execute(cls, image, clip, vae, prompt, output_long_edge, tile_size, owner):
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
                    positive, negative, shape = _encode_tile(clip, vae, reference[top:bottom, left:right], prompt)
                    encoded.append((_conditioning_to_cpu(positive), _conditioning_to_cpu(negative), shape))
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
        repaired = []
        progress = comfy.utils.ProgressBar(image.shape[0] * len(xs) * len(ys))
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
                    tile_seed = (seed + tile_index) % (1 << 64)
                    tile = _sample_tile(
                        model, vae, tile_reference, conditions["encoded"][tile_index],
                        tile_seed, steps, sampler_name, scheduler, report,
                    )
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
                    tile_reference = reference[top:bottom, left:right]
                    tile_index = (batch_index * len(ys) + row) * len(xs) + column
                    tile_number = row * len(xs) + column + 1
                    packed, shape = tiles["repaired"][tile_index]
                    tile = np.frombuffer(zlib.decompress(packed.numpy().tobytes()), dtype=np.float32).reshape(shape)
                    report("颜色还原中..." if color_match != "无" else "拼接中...")
                    tile = _match_colors(tile, tile_reference, color_match)
                    if color_match != "无":
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
    "H3TiledUpscaleGH": H3TiledUpscaleGH,
    "H3TiledEncodeGH": H3TiledEncodeGH,
    "H3TiledSampleGH": H3TiledSampleGH,
    "H3TiledFinishGH": H3TiledFinishGH,
}
