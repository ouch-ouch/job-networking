#!/usr/bin/env python3
"""Render an honest, narrated 110-second walkthrough from captured UI PNGs.

Requires Python with Pillow, FFmpeg, and macOS speech synthesis (say).
No browser control, remote requests, credentials, outreach, or Calendar writes.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
FONTS = Path("/System/Library/Fonts/Supplemental")


def run(args: list[str]) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def duration(path: Path) -> float:
    return float(run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)]))


def font(size: int, bold: bool = False):
    return ImageFont.truetype(str(FONTS / ("Arial Bold.ttf" if bold else "Arial.ttf")), size)


def wrap(draw, value: str, face, width: int) -> list[str]:
    lines, current = [], ""
    for word in value.split():
        candidate = f"{current} {word}".strip()
        if current and draw.textlength(candidate, font=face) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    return lines + ([current] if current else [])


def frame(source: Path, target: Path, scene: dict, index: int, total: int, width: int, height: int):
    # Letterbox the entire screenshot above the lower third: no UI content cropped or covered.
    bar_height = 120
    area_height = height - bar_height
    canvas = Image.new("RGB", (width, height), "#edf2f1")
    with Image.open(source) as screenshot:
        screenshot = screenshot.convert("RGB")
        screenshot.thumbnail((width, area_height), Image.Resampling.LANCZOS)
        canvas.paste(screenshot, ((width - screenshot.width) // 2, (area_height - screenshot.height) // 2))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, area_height, width, height), fill="#122f2a")
    draw.text((28, area_height + 11), scene["label"], font=font(15), fill="#9fd8bd")
    draw.text((28, area_height + 35), scene["title"], font=font(25, True), fill="white")
    caption_font = font(17)
    for line_index, line in enumerate(wrap(draw, scene["caption"], caption_font, width - 56)[:2]):
        draw.text((28, area_height + 74 + line_index * 20), line, font=caption_font, fill="#e2ece8")
    badge = f"{index:02d} / {total:02d}"
    draw.text((width - 105, area_height + 12), badge, font=font(14), fill="#b6ccc3")
    canvas.save(target)


def timestamp(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    whole, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole:02d},{millis:03d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=Path, default=ROOT / "docs/demo/scenes.json")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/demo/coffee-chat-copilot-walkthrough.mp4")
    parser.add_argument("--voice", default=None, help="Optional installed macOS say voice")
    parser.add_argument("--check", action="store_true", help="Validate inputs and report missing screenshots without rendering")
    args = parser.parse_args()
    config = json.loads(args.scenes.read_text())
    scenes = config["scenes"]
    base = args.scenes.parent
    words = sum(len(scene["narration"].split()) for scene in scenes)
    missing = [str(base / scene["image"]) for scene in scenes if not (base / scene["image"]).is_file()]
    print(f"Scenes: {len(scenes)}; narration: {words} words; target: {config['durationSeconds']} seconds", flush=True)
    if missing:
        print("Missing screenshots:\n" + "\n".join(missing), flush=True)
        raise SystemExit(1)
    if args.check:
        print("All screenshot inputs are ready.")
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fps = int(config["fps"])
    width, height = int(config["width"]), int(config["height"])
    planned_frames = [round(scene["duration"] * fps) for scene in scenes]
    target_frames = round(config["durationSeconds"] * fps)
    assert sum(planned_frames) == target_frames, "Scene holds must total the target duration."

    with tempfile.TemporaryDirectory(prefix="coffee-chat-demo-") as temporary:
        work = Path(temporary)
        audio_paths, audio_lengths, image_paths = [], [], []
        for index, scene in enumerate(scenes, 1):
            speech = work / f"{index:02d}.txt"
            speech.write_text(scene["narration"])
            audio = work / f"{index:02d}.aiff"
            say = ["/usr/bin/say", "-r", "180", "-f", str(speech), "-o", str(audio)]
            if args.voice:
                say.extend(["-v", args.voice])
            run(say)
            audio_paths.append(audio)
            audio_lengths.append(duration(audio))
            image = work / f"{index:02d}.png"
            image_paths.append(image)
            print(f"Prepared scene {index:02d}: narration {audio_lengths[-1]:.1f}s", flush=True)

        # Keep every spoken line intact; borrow only silent hold time from other scenes.
        minima = [math.ceil((length + 0.35) * fps) for length in audio_lengths]
        if sum(minima) > target_frames:
            raise RuntimeError("Narration exceeds the 110-second schedule; shorten the script before rendering.")
        frames = [max(planned, minimum) for planned, minimum in zip(planned_frames, minima)]
        excess = sum(frames) - target_frames
        for index in sorted(range(len(frames)), key=lambda i: frames[i] - minima[i], reverse=True):
            reduction = min(excess, frames[index] - minima[index])
            frames[index] -= reduction
            excess -= reduction
        assert excess == 0

        clips, timing, captions, narration = [], [], [], []
        elapsed = 0.0
        for index, (scene, image, audio, scene_frames) in enumerate(zip(scenes, image_paths, audio_paths, frames), 1):
            hold = scene_frames / fps
            clip = work / f"scene-{index:02d}.mp4"
            frame(base / scene["image"], image, scene, index, len(scenes), width, height)
            run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", str(fps), "-i", str(image), "-i", str(audio),
                 "-t", f"{hold:.6f}", "-vf", "format=yuv420p", "-af", f"apad,atrim=duration={hold:.6f}",
                 "-c:v", "libx264", "-preset", "fast", "-tune", "stillimage", "-crf", "23", "-maxrate", "1400k", "-bufsize", "2800k",
                 "-r", str(fps), "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(clip)])
            clips.append(clip)
            timing.append({**scene, "start": round(elapsed, 3), "duration": round(hold, 3), "narrationSeconds": round(audio_lengths[index - 1], 3)})
            captions.append(f"{index}\n{timestamp(elapsed)} --> {timestamp(elapsed + hold)}\n{scene['narration']}\n")
            narration.append(f"{index:02d}. {scene['title']}\n{scene['label']}\n{scene['narration']}\n")
            elapsed += hold
            print(f"Rendered scene {index:02d}/{len(scenes)}", flush=True)
        concat = work / "concat.txt"
        concat.write_text("\n".join(f"file '{clip.as_posix()}'" for clip in clips))
        run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(args.output)])
        args.output.with_suffix(".srt").write_text("\n".join(captions))
        args.output.with_suffix(".narration.txt").write_text("\n".join(narration))
        args.output.with_suffix(".scenes.json").write_text(json.dumps({**config, "scenes": timing}, indent=2, ensure_ascii=False) + "\n")
    result_duration = duration(args.output)
    megabytes = args.output.stat().st_size / 1_000_000
    if not 109.5 <= result_duration <= 111:
        raise RuntimeError(f"Unexpected rendered duration: {result_duration:.3f}s")
    if megabytes > 25:
        raise RuntimeError(f"Video exceeds 25 MB: {megabytes:.1f} MB")
    print(f"READY: {args.output}\nDuration: {result_duration:.2f}s; size: {megabytes:.2f} MB", flush=True)


if __name__ == "__main__":
    main()
