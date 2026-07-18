#!/usr/bin/env python3
"""Generate one portrait-conditioned Modia sprite strip.

This repository-owned adapter keeps Modia's identity-rich prompt intact while
reusing the SD1.5, ControlNet, IP-Adapter, pose, and ComfyUI implementation from
the companion image-generator project. The companion CLI historically rebuilt
animation prompts from only the character id, which discarded race, gender,
equipment, palette, and art-direction details supplied by Modia.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import deque
from pathlib import Path

from PIL import Image


FRAME_SIZE = 64
FRAME_COUNT = 8


def configure_generator_imports() -> Path:
    """Expose the companion generator and its legacy ``lib`` package."""
    configured = os.environ.get("IMAGE_GENERATOR_ROOT")
    generator_root = Path(configured).expanduser() if configured else None
    if generator_root is None or not generator_root.is_dir():
        raise RuntimeError(
            "IMAGE_GENERATOR_ROOT must point to the companion image-generator project"
        )

    module_root = generator_root.resolve()
    legacy_root = module_root / "modia-generators"
    if not (module_root / "sd15_animation").is_dir() or not legacy_root.is_dir():
        raise RuntimeError(
            f"Invalid image-generator project at {module_root}: required SD1.5 modules are missing"
        )

    sys.path.insert(0, str(legacy_root))
    sys.path.insert(0, str(module_root))
    return module_root


def parse_frame_descriptions(value: str | None) -> list[str] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise argparse.ArgumentTypeError(
            f"--frame-descriptions must be valid JSON: {error}"
        ) from error
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise argparse.ArgumentTypeError(
            "--frame-descriptions must be a JSON array of strings"
        )
    return parsed


def is_white_matte_pixel(pixel: tuple[int, int, int, int]) -> bool:
    """Identify neutral, light backdrop pixels without erasing white armor."""
    red, green, blue, alpha = pixel
    if alpha == 0:
        return True
    brightness = min(red, green, blue)
    chroma = max(red, green, blue) - min(red, green, blue)
    return brightness >= 218 and chroma <= 42


def remove_border_connected_matte(
    image: Image.Image,
    target_size: int = FRAME_SIZE,
) -> Image.Image:
    """Remove only white matte connected to a frame edge.

    A global white threshold punches holes through pale costumes and weapons.
    Flooding from the border removes the generated stage while preserving
    enclosed highlights that belong to the character.
    """
    resized = image.convert("RGBA").resize(
        (target_size, target_size),
        Image.Resampling.NEAREST,
    )
    pixel_data = (
        resized.get_flattened_data()
        if hasattr(resized, "get_flattened_data")
        else resized.getdata()
    )
    pixels = list(pixel_data)
    visited = bytearray(target_size * target_size)
    queue: deque[int] = deque()

    def enqueue_if_matte(x: int, y: int) -> None:
        index = y * target_size + x
        if not visited[index] and is_white_matte_pixel(pixels[index]):
            visited[index] = 1
            queue.append(index)

    for x in range(target_size):
        enqueue_if_matte(x, 0)
        enqueue_if_matte(x, target_size - 1)
    for y in range(1, target_size - 1):
        enqueue_if_matte(0, y)
        enqueue_if_matte(target_size - 1, y)

    while queue:
        index = queue.popleft()
        x = index % target_size
        y = index // target_size
        if x > 0:
            enqueue_if_matte(x - 1, y)
        if x + 1 < target_size:
            enqueue_if_matte(x + 1, y)
        if y > 0:
            enqueue_if_matte(x, y - 1)
        if y + 1 < target_size:
            enqueue_if_matte(x, y + 1)

    cleaned = []
    for index, (red, green, blue, alpha) in enumerate(pixels):
        cleaned.append((red, green, blue, 0 if visited[index] else alpha))

    result = Image.new("RGBA", (target_size, target_size))
    result.putdata(cleaned)
    return result


def normalize_identity_reference(
    image: Image.Image,
    canvas_size: int = 512,
    margin: int = 32,
) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        return image
    subject = image.crop(bbox)
    target_extent = canvas_size - (2 * margin)
    scale = min(1.0, target_extent / subject.width, target_extent / subject.height)
    if scale < 1.0:
        subject = subject.resize(
            (
                max(1, round(subject.width * scale)),
                max(1, round(subject.height * scale)),
            ),
            Image.Resampling.NEAREST,
        )
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x = (canvas_size - subject.width) // 2
    y = canvas_size - margin - subject.height
    canvas.alpha_composite(subject, (x, y))
    return canvas


def normalize_sequence_margins(
    frames: list[Image.Image],
    target_extent: int = 56,
    bottom_margin: int = 4,
) -> list[Image.Image]:
    """Apply one scale factor to the whole sequence and keep every pose in-cell.

    A staff, raised arm, or casting robe can occasionally touch the 64px cell
    even when the model produced a clean white background. Scaling every frame
    by the same factor preserves temporal size consistency while guaranteeing
    transparent padding around the largest pose.
    """
    bboxes = [frame.getchannel("A").getbbox() for frame in frames]
    nonempty = [bbox for bbox in bboxes if bbox is not None]
    if not nonempty:
        return frames

    max_width = max(right - left for left, top, right, bottom in nonempty)
    max_height = max(bottom - top for left, top, right, bottom in nonempty)
    scale = min(1.0, target_extent / max_width, target_extent / max_height)

    normalized: list[Image.Image] = []
    for frame, bbox in zip(frames, bboxes):
        if bbox is None:
            normalized.append(frame)
            continue
        subject = frame.crop(bbox)
        if scale < 1.0:
            subject = subject.resize(
                (
                    max(1, round(subject.width * scale)),
                    max(1, round(subject.height * scale)),
                ),
                Image.Resampling.NEAREST,
            )
        canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
        x = (FRAME_SIZE - subject.width) // 2
        y = max(0, FRAME_SIZE - bottom_margin - subject.height)
        canvas.alpha_composite(subject, (x, y))
        normalized.append(canvas)
    return normalized


def assemble_vertical_strip(frames: list[Image.Image]) -> Image.Image:
    if len(frames) != FRAME_COUNT:
        raise RuntimeError(
            f"Expected {FRAME_COUNT} generated frames, received {len(frames)}"
        )
    strip = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE * FRAME_COUNT), (0, 0, 0, 0))
    for frame_index, frame in enumerate(frames):
        if frame.size != (FRAME_SIZE, FRAME_SIZE):
            raise RuntimeError(
                f"Frame {frame_index} has invalid size {frame.size}; expected {FRAME_SIZE}x{FRAME_SIZE}"
            )
        strip.alpha_composite(frame, (0, frame_index * FRAME_SIZE))
    return strip


def save_strip_atomically(strip: Image.Image, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(
        f".{output_path.stem}.{os.getpid()}.tmp{output_path.suffix}"
    )
    save_options: dict[str, object] = {}
    if output_path.suffix.lower() == ".webp":
        save_options = {"format": "WEBP", "lossless": True, "method": 6}
    strip.save(temporary_path, **save_options)
    temporary_path.replace(output_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate one identity-preserving Modia character animation strip"
    )
    parser.add_argument("--character", required=True)
    parser.add_argument("--animation")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--controlnet-weight", type=float, default=0.7)
    parser.add_argument("--ipadapter-weight", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--seed-policy",
        choices=("fixed", "increment"),
        default="fixed",
        help="Use one latent seed across poses for identity stability (default: fixed)",
    )
    parser.add_argument("--lora", default="pixel-art-xl")
    parser.add_argument("--output-path", type=Path, required=True)
    parser.add_argument("--originals-dir", type=Path)
    parser.add_argument("--frame-descriptions")
    parser.add_argument(
        "--negative-prompt",
        help="Additional negative-prompt constraints appended to the companion defaults",
    )
    parser.add_argument("--quality-preset", choices=("fast", "balanced", "quality"))
    parser.add_argument("--steps", type=int)
    parser.add_argument("--cfg-scale", type=float)
    parser.add_argument("--sampler")
    parser.add_argument("--scheduler")
    parser.add_argument("--auto-reference", action="store_true")
    parser.add_argument(
        "--identity-reference-only",
        action="store_true",
        help="Generate one canonical 512px full-body reference instead of an animation strip",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not args.identity_reference_only and not args.animation:
        parser.error("--animation is required unless --identity-reference-only is used")
    try:
        frame_descriptions = parse_frame_descriptions(args.frame_descriptions)
    except argparse.ArgumentTypeError as error:
        parser.error(str(error))

    if not 0.0 <= args.controlnet_weight <= 1.0:
        parser.error("--controlnet-weight must be between 0 and 1")
    if not 0.0 <= args.ipadapter_weight <= 1.0:
        parser.error("--ipadapter-weight must be between 0 and 1")

    reference_path = Path(args.reference).expanduser().resolve()
    if not args.dry_run and not reference_path.is_file():
        parser.error(f"reference image does not exist: {reference_path}")

    if args.dry_run:
        print(f"[DRY RUN] character={args.character} animation={args.animation}")
        print(f"[DRY RUN] reference={reference_path}")
        print(f"[DRY RUN] output={args.output_path}")
        print(f"[DRY RUN] prompt={args.prompt}")
        return 0

    configure_generator_imports()
    from sd15_animation import SD15AnimationGenerator
    from sd15_animation import workflows as animation_workflows

    if args.negative_prompt:
        animation_workflows.ENHANCED_NEGATIVE_PROMPT = (
            f"{animation_workflows.ENHANCED_NEGATIVE_PROMPT}, {args.negative_prompt}"
        )

    if args.verbose:
        print(f"Identity prompt: {args.prompt}")
        print(f"Reference: {reference_path}")

    generator = SD15AnimationGenerator()
    try:
        generator.load_lora(args.lora)
        # A zero weight must remove the IP-Adapter branch entirely. Keeping the
        # node in the graph at weight 0 still leaked legacy portrait identity in
        # practice (for example, a bearded male portrait into a canonical female
        # dwarf), so contradictory sources can now be genuinely disabled.
        if args.ipadapter_weight > 0:
            generator.set_reference_image(reference_path, args.ipadapter_weight)
        animation_type = args.animation or "idle"
        pose_templates = generator.pose_manager.load_animation_templates(animation_type)
        requested_frame_count = 1 if args.identity_reference_only else FRAME_COUNT
        if len(pose_templates) < requested_frame_count:
            raise RuntimeError(
                f"Animation {animation_type} provides {len(pose_templates)} poses; "
                f"{requested_frame_count} are required"
            )
        if requested_frame_count == 1:
            pose_templates = [pose_templates[0]]
        elif len(pose_templates) > FRAME_COUNT:
            step = (len(pose_templates) - 1) / (FRAME_COUNT - 1)
            pose_templates = [pose_templates[round(index * step)] for index in range(FRAME_COUNT)]

        frames = []
        for index, pose_template in enumerate(pose_templates):
            frame_prompt = args.prompt
            if frame_descriptions and index < len(frame_descriptions) and frame_descriptions[index]:
                frame_prompt = f"{frame_prompt}, {frame_descriptions[index]}"
            frame_seed = args.seed if args.seed_policy == "fixed" else args.seed + index
            if args.verbose:
                print(f"Frame {index + 1}/{requested_frame_count}: seed={frame_seed}")
            frames.append(generator.generate_frame(
                prompt=frame_prompt,
                pose_template=pose_template,
                seed=frame_seed,
                controlnet_weight=args.controlnet_weight,
                ip_adapter_weight=args.ipadapter_weight,
                quality_preset=args.quality_preset,
                steps=args.steps,
                cfg_scale=args.cfg_scale,
                sampler=args.sampler,
                scheduler=args.scheduler,
            ))

        if args.originals_dir:
            args.originals_dir.mkdir(parents=True, exist_ok=True)
            for index, frame in enumerate(frames):
                frame.convert("RGB").save(args.originals_dir / f"frame_{index:02d}.png")

        if args.identity_reference_only:
            # Canonical 512px references need semantic matting because diffusion
            # occasionally emits a colored circle or character-sheet stage even
            # when prompted for white. The companion environment declares rembg;
            # its post-processor falls back safely when that optional model is
            # unavailable, and the Node validator still rejects residue.
            identity_source = generator.post_process(
                frames[0],
                target_size=512,
                remove_background=True,
                use_ml_background_removal=True,
            )
            reference = normalize_identity_reference(
                remove_border_connected_matte(identity_source, target_size=512)
            )
            save_strip_atomically(reference, args.output_path)
            print(f"Saved identity reference: {args.output_path}")
            return 0

        processed_frames = normalize_sequence_margins(
            [remove_border_connected_matte(frame) for frame in frames]
        )
        strip = assemble_vertical_strip(processed_frames)
        save_strip_atomically(strip, args.output_path)

        if args.verbose:
            coverages = []
            for frame in processed_frames:
                alpha = frame.getchannel("A")
                alpha_data = (
                    alpha.get_flattened_data()
                    if hasattr(alpha, "get_flattened_data")
                    else alpha.getdata()
                )
                foreground = sum(1 for value in alpha_data if value > 0)
                coverages.append(round(foreground / (FRAME_SIZE * FRAME_SIZE), 4))
            print(f"Foreground coverage: {coverages}")
        print(f"Saved sprite strip: {args.output_path}")
        return 0
    finally:
        generator.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
