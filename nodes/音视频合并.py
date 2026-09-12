# -*- coding: utf-8 -*-
"""Combine an IMAGE sequence and AUDIO input into an H.264 MP4 video."""

import os
import uuid
from collections.abc import Mapping
from fractions import Fraction

import folder_paths
import torch
from comfy_api.latest import InputImpl, Types, io, ui


class AudioVideoMerger:
    """将上游图像序列和音频合并为 H.264 MP4 视频。"""

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
                "保存视频": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("视频",)
    FUNCTION = "merge"
    OUTPUT_NODE = True
    CATEGORY = "GoohaiTools/视频"
    DESCRIPTION = "将图像序列与音频合并为 H.264 MP4 视频。"

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
    def _normalize_audio(audio):
        """Convert common ComfyUI/VHS audio variants to the native AUDIO dict.

        Besides the usual ``{"waveform", "sample_rate"}`` dict, VHS may pass a
        lazy Mapping (which is not a dict), while a few legacy nodes expose an
        ``audio_path`` instead of an already decoded waveform.
        """
        if isinstance(audio, Mapping):
            waveform = audio.get("waveform")
            sample_rate = audio.get(
                "sample_rate",
                audio.get("samplerate", audio.get("sampler_rate")),
            )
            if waveform is None:
                audio_path = audio.get("audio_path", audio.get("path", audio.get("file")))
                if audio_path:
                    try:
                        import torchaudio

                        waveform, sample_rate = torchaudio.load(audio_path)
                    except Exception as exc:
                        raise TypeError("音视频合并：无法读取音频文件。") from exc
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

    def merge(self, 图像, 音频, 帧率=24, 保存视频=False):
        if 图像 is None or getattr(图像, "ndim", 0) != 4 or 图像.shape[0] == 0:
            raise ValueError("音视频合并：图像输入不能为空，且必须包含至少一帧。")
        音频 = self._normalize_audio(音频)

        try:
            fps = int(帧率)
        except (TypeError, ValueError) as exc:
            raise ValueError("音视频合并：帧率必须是正整数。") from exc
        if fps <= 0:
            raise ValueError("音视频合并：帧率必须是正整数。")

        video = InputImpl.VideoFromComponents(
            Types.VideoComponents(
                images=图像,
                audio=音频,
                frame_rate=Fraction(fps),
            )
        )

        # Always encode once so downstream nodes receive a real MP4/H.264
        # VideoFromFile object.  The save switch controls only the destination
        # and whether the browser preview is returned.
        target_path = self._output_path() if bool(保存视频) else self._temp_path()
        video.save_to(
            target_path,
            format=Types.VideoContainer.MP4,
            codec=Types.VideoCodec.H264,
        )
        output_video = InputImpl.VideoFromFile(target_path)

        if bool(保存视频):
            reference = self._saved_reference(target_path)
            filename, subfolder = reference or (os.path.basename(target_path), "")
            return {
                # Use ComfyUI's native animated-video preview protocol.  No
                # custom JavaScript or additional frontend dependency is
                # required.
                "ui": ui.PreviewVideo([
                    ui.SavedResult(filename, subfolder, io.FolderType.output)
                ]).as_dict(),
                "result": (output_video,),
            }

        # No UI payload means the node remains a pure downstream video source
        # when preview saving is disabled.
        return {"result": (output_video,)}


NODE_CLASS_MAPPINGS = {
    "GH_AudioVideoMerger": AudioVideoMerger,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GH_AudioVideoMerger": "音视频合并",
}
