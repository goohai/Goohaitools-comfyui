# -*- coding: utf-8 -*-
"""Combine an IMAGE sequence and AUDIO input into an H.264 MP4 video - optimized version."""

import os
import uuid
import subprocess
import shutil
from collections.abc import Mapping
from fractions import Fraction

import folder_paths
import torch
import numpy as np
from comfy_api.latest import InputImpl, Types


def _find_ffmpeg():
    """Find an already installed executable without importing any third-party module."""
    candidates = [
        shutil.which("ffmpeg"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg.exe"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ffmpeg.exe"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "ffmpeg.exe"),
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


ffmpeg_path = _find_ffmpeg()


# 编码质量预设 - 中文选项映射到ffmpeg参数
# preset越慢压缩率越高/质量越好；crf越小质量越高
ENCODE_PRESETS = {
    "最快":    {"preset": "ultrafast", "crf": "23"},
    "非常快":  {"preset": "superfast", "crf": "21"},
    "快速":    {"preset": "veryfast",  "crf": "19"},
    "标准":    {"preset": "medium",    "crf": "19"},
    "高质量":  {"preset": "slow",      "crf": "17"},
    "最高质量": {"preset": "veryslow", "crf": "15"},
}


# VHS-optimized tensor conversion: numpy multiply + round for speed
def tensor_to_bytes(tensor):
    """Match VHS tensor conversion for maximum speed"""
    return (tensor.cpu().numpy() * 255 + 0.5).clip(0, 255).astype(np.uint8).tobytes()


class AudioVideoMerger:
    """将上游图像序列和音频合并为 H.264 MP4 视频 - 速度优化版"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "音频": ("AUDIO",),
                "帧率": (
                    "FLOAT",
                    {
                        "default": 24,
                        "min": 1.0,
                        "max": 120.0,
                        "step": 1.0,
                    },
                ),
                "编码质量": (
                    list(ENCODE_PRESETS.keys()),
                    {"default": "标准"},
                ),
                "保存视频": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("视频",)
    FUNCTION = "merge"
    OUTPUT_NODE = True
    CATEGORY = "GoohaiTools/视频"
    DESCRIPTION = "将图像序列与音频合并为 H.264 MP4 视频（优化速度版）。"

    @staticmethod
    def _output_path():
        output_dir = folder_paths.get_output_directory()
        os.makedirs(output_dir, exist_ok=True)
        return os.path.join(output_dir, f"audio_video_merge_{uuid.uuid4().hex}.mp4")

    @staticmethod
    def _temp_path():
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        return os.path.join(temp_dir, f"audio_video_merge_{uuid.uuid4().hex}.mp4")

    @staticmethod
    def _temp_audio_path():
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        return os.path.join(temp_dir, f"audio_video_merge_audio_{uuid.uuid4().hex}.wav")

    @staticmethod
    def _saved_reference(path):
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        full_path = os.path.abspath(path)
        try:
            relative = os.path.relpath(full_path, output_dir)
        except ValueError:
            return None
        if relative == os.pardir or relative.startswith(os.pardir + os.sep):
            return None
        relative = relative.replace(os.sep, "/")
        subfolder, filename = os.path.split(relative)
        return filename, subfolder

    @staticmethod
    def _video_reference(path, folder_type):
        """Return a frontend /view reference without invoking PreviewVideo."""
        base_dir = os.path.abspath(
            folder_paths.get_output_directory()
            if folder_type == "output"
            else folder_paths.get_temp_directory()
        )
        full_path = os.path.abspath(path)
        relative = os.path.relpath(full_path, base_dir).replace(os.sep, "/")
        subfolder, filename = os.path.split(relative)
        return {
            "filename": filename,
            "subfolder": subfolder,
            "type": folder_type,
        }

    @staticmethod
    def _normalize_audio(audio):
        """Convert common ComfyUI/VHS audio variants to waveform + sample_rate."""
        if isinstance(audio, Mapping):
            waveform = audio.get("waveform")
            sample_rate = audio.get(
                "sample_rate",
                audio.get("samplerate", audio.get("sampler_rate")),
            )
            if waveform is None:
                audio_path = audio.get("audio_path", audio.get("path", audio.get("file")))
                if audio_path:
                    raise TypeError("音视频合并：音频路径输入不受支持，请连接 ComfyUI AUDIO 波形。")
        elif isinstance(audio, (tuple, list)) and len(audio) == 2:
            waveform, sample_rate = audio
        else:
            waveform = getattr(audio, "waveform", None)
            sample_rate = getattr(
                audio,
                "sample_rate",
                getattr(audio, "samplerate", getattr(audio, "sampler_rate", None)),
            )

        if waveform is None or sample_rate is None:
            raise TypeError("音视频合并：音频输入格式无效。")
        try:
            sample_rate = int(sample_rate)
        except (TypeError, ValueError) as exc:
            raise TypeError("音视频合并：音频采样率无效。") from exc
        if sample_rate <= 0:
            raise TypeError("音视频合并：音频采样率必须为正数。")

        try:
            waveform = torch.as_tensor(waveform)
        except Exception as exc:
            raise TypeError("音视频合并：音频波形数据无效。") from exc
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0).unsqueeze(0)
        elif waveform.ndim == 2:
            waveform = waveform.unsqueeze(0)
        elif waveform.ndim != 3:
            raise TypeError("音视频合并：音频波形维度无效。")
        if waveform.shape[-1] == 0 or waveform.shape[1] == 0:
            raise ValueError("音视频合并：音频不能为空。")
        return {"waveform": waveform, "sample_rate": sample_rate}

    def _save_audio_to_wav(self, waveform, sample_rate, path):
        """Write ComfyUI AUDIO data as PCM WAV using Python's standard library."""
        import wave

        samples = waveform[0].float().detach().cpu().clamp(-1.0, 1.0)
        channels = int(samples.shape[0])
        pcm = samples.mul(32767.0).round().short().transpose(0, 1).contiguous().numpy()
        with wave.open(path, "wb") as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(int(sample_rate))
            wav_file.writeframes(pcm.tobytes())

    def merge(self, 图像, 音频, 帧率=24, 编码质量="快速", 保存视频=False):
        if 图像 is None or getattr(图像, "ndim", 0) != 4 or 图像.shape[0] == 0:
            raise ValueError("音视频合并：图像输入不能为空，且必须包含至少一帧。")
        音频 = self._normalize_audio(音频)

        try:
            fps = int(帧率)
        except (TypeError, ValueError) as exc:
            raise ValueError("音视频合并：帧率必须是正整数。") from exc
        if fps <= 0:
            raise ValueError("音视频合并：帧率必须是正整数。")

        # 获取编码参数
        preset_config = ENCODE_PRESETS.get(编码质量, ENCODE_PRESETS["快速"])
        ffmpeg_preset = preset_config["preset"]
        ffmpeg_crf = preset_config["crf"]

        # Video dimensions - shape (N, H, W, C)
        num_frames = 图像.shape[0]
        height = 图像.shape[1]
        width = 图像.shape[2]
        
        # Pad to even dimensions (h264 yuv420p requirement)
        pad_right = width % 2
        pad_bottom = height % 2
        if pad_right or pad_bottom:
            pad_func = torch.nn.ReplicationPad2d((0, pad_right, 0, pad_bottom))
            图像 = pad_func(图像.permute(0, 3, 1, 2)).permute(0, 2, 3, 1)
            width = 图像.shape[2]
            height = 图像.shape[1]

        target_path = self._output_path() if bool(保存视频) else self._temp_path()

        # If no external ffmpeg executable is available, use ComfyUI's official
        # Video API. This keeps the node independently runnable without adding
        # a Python package dependency; it is slower than the pipe path.
        if ffmpeg_path is None:
            video = InputImpl.VideoFromComponents(
                Types.VideoComponents(
                    images=图像,
                    audio=音频,
                    frame_rate=Fraction(fps),
                )
            )
            video.save_to(
                target_path,
                format=Types.VideoContainer.MP4,
                codec=Types.VideoCodec.H264,
            )
            output_video = InputImpl.VideoFromFile(target_path)
            folder_type = "output" if bool(保存视频) else "temp"
            return {
                # The frontend owns the preview widget. Keep this metadata
                # custom so ComfyUI does not create its native video controls.
                "ui": {"gh_audio_video": [self._video_reference(target_path, folder_type)]},
                "result": (output_video,),
            }

        audio_path = self._temp_audio_path()
        
        self._save_audio_to_wav(音频["waveform"], 音频["sample_rate"], audio_path)
        
        # VHS-optimized ffmpeg command
        args = [
            ffmpeg_path, "-v", "error", "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "-",
            "-i", audio_path,
            "-c:v", "libx264",
            "-preset", ffmpeg_preset,
            "-crf", ffmpeg_crf,
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            "-color_range", "tv",
            "-colorspace", "bt709",
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
            target_path
        ]
        
        env = os.environ.copy()
        
        try:
            process = subprocess.Popen(
                args,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                env=env
            )
            
            try:
                for i in range(num_frames):
                    process.stdin.write(tensor_to_bytes(图像[i]))
            except BrokenPipeError:
                pass
            
            process.stdin.close()
            process.wait()
            
            if process.returncode != 0:
                stderr = process.stderr.read().decode('utf-8', errors='ignore')
                raise RuntimeError(f"ffmpeg编码失败 (code {process.returncode}): {stderr}")
                
        finally:
            try:
                if os.path.exists(audio_path):
                    os.unlink(audio_path)
            except Exception:
                pass
        
        output_video = InputImpl.VideoFromFile(target_path)

        folder_type = "output" if bool(保存视频) else "temp"
        return {
            # Keep only lightweight media metadata; the custom JS widget
            # renders the video and ComfyUI must not create native controls.
            "ui": {"gh_audio_video": [self._video_reference(target_path, folder_type)]},
            "result": (output_video,),
        }


NODE_CLASS_MAPPINGS = {
    "GH_AudioVideoMerger": AudioVideoMerger,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GH_AudioVideoMerger": "保存视频",
}

