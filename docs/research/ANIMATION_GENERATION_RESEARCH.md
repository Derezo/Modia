# Animation Generation Research Report

> **Date:** 2026-01-30
> **Status:** Research Phase
> **Hardware Constraint:** 8GB VRAM (RTX 3070/4070)
> **Current Issues:** Frame inconsistency, unnatural motion, pose accuracy

## Executive Summary

This report analyzes approaches for improving AI-generated character sprite animations. Our current pipeline generates individual 64x64 frames using Flux + V1 LoRA and concatenates them into vertical sprite sheets. The main issues are:

1. **Frame inconsistency** - Character appearance varies between frames
2. **Unnatural motion** - Animations look jerky, don't flow smoothly
3. **Pose accuracy** - Generated poses don't match intended frame descriptions

Given our 8GB VRAM constraint, this report identifies viable approaches ranging from prompt improvements to specialized model integration.

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Research Findings: Specialized Animation Models](#2-research-findings-specialized-animation-models)
3. [Research Findings: ControlNet + Pose Guidance](#3-research-findings-controlnet--pose-guidance)
4. [Research Findings: Temporal Consistency Approaches](#4-research-findings-temporal-consistency-approaches)
5. [Research Findings: Skeletal Animation Systems](#5-research-findings-skeletal-animation-systems)
6. [Research Findings: Frame Interpolation](#6-research-findings-frame-interpolation)
7. [Research Findings: Cloud/API Solutions](#7-research-findings-cloudapi-solutions)
8. [Approach Comparison Matrix](#8-approach-comparison-matrix)
9. [Recommended Research Tasks](#9-recommended-research-tasks)
10. [Implementation Recommendations](#10-implementation-recommendations)
11. [Sources](#11-sources)

---

## 1. Current Architecture Analysis

### Current Pipeline Flow

```
Prompt Template → Flux Generation (1024x1024) → Background Removal →
Crop/Resize (64x64) → Frame Assembly (8 frames → 64x512 strip)
```

### Key Files

| File | Purpose |
|------|---------|
| `image-generator/modia-generators/generate_character_frame.py` | Single frame generation |
| `image-generator/modia-generators/lib/prompt_templates.py` | Animation frame descriptions |
| `image-generator/modia-generators/lib/image_processing.py` | Post-processing pipeline |
| `Modia/scripts/ai-images/generate-characters.js` | Orchestration and assembly |

### Current Frame Description System

Each animation has 8 predefined frame descriptions:

| Animation | Frame 0 | Frame 1 | Frame 2 | Frame 3 | Frame 4 | Frame 5 | Frame 6 | Frame 7 |
|-----------|---------|---------|---------|---------|---------|---------|---------|---------|
| **idle** | standing neutral | weight left | breathing | weight right | neutral | right arm | breathing | left arm |
| **walk** | left foot forward | passing | contact | push off | right foot | passing | contact | push off |
| **attack** | windup | raised high | swing begin | swing mid | impact | follow through | recovery | return ready |

### Root Causes of Current Issues

1. **No Temporal Awareness**: Each frame generated independently with no knowledge of adjacent frames
2. **Semantic Gap**: Text descriptions don't translate reliably to consistent visual poses
3. **No Pose Conditioning**: Model receives no structural guidance (skeleton, keypoints)
4. **Style Variance**: Despite same seed, Flux produces stylistic variations frame-to-frame

---

## 2. Research Findings: Specialized Animation Models

### 2.1 Sprite Sheet Diffusion

**Paper:** [arXiv:2412.03685](https://arxiv.org/abs/2412.03685)

**Architecture:**
- **ReferenceNet**: Encodes reference image appearance using SD UNet with spatial attention
- **Pose Guider**: 4 convolutional layers encoding pose skeleton to latent resolution
- **Motion Module**: Temporal consistency layer embedded after attention layers

**Training Process:**
- Stage 1 (Pose-to-Image): Train ReferenceNet + denoising UNet + Pose Guider
- Stage 2 (Pose-to-Sprite): Train Motion Module with frozen Stage 1 weights

**Hardware Requirements:**
| Stage | GPU | VRAM | Duration |
|-------|-----|------|----------|
| Stage 1 | NVIDIA L40S | **42GB** | 10 hours |
| Stage 2 | NVIDIA 4090 | **24GB** | 2 hours |
| Inference | NVIDIA 4090 | **24GB** | - |

**Verdict:** ❌ **NOT VIABLE** - Exceeds 8GB VRAM constraint

**Potential Future Use:** Could run on cloud infrastructure (Lambda Labs, RunPod) for batch generation.

---

### 2.2 Animate Anyone

**Paper:** [arXiv:2311.17117](https://arxiv.org/abs/2311.17117) (CVPR 2024)

**Architecture:**
- **ReferenceNet**: Symmetrical UNet extracting spatial details via spatial-attention
- **Pose Guider**: Encodes motion control signals for controllable movements
- **Temporal Layer**: Ensures motion continuity across frames
- **CLIP Encoder**: Semantic features for cross-attention

**Key Innovation:** Two-stage training focusing first on single-frame quality, then temporal coherence.

**Hardware Requirements:**
| Task | GPU | Time |
|------|-----|------|
| 32-frame 832x640 | NVIDIA A10 | 1.75-2.45s |
| 32-frame 832x640 | RTX 6000 | 2.25-2.8s |
| Inference minimum | - | **24GB VRAM** |

**Code Available:** [GitHub - HumanAIGC/AnimateAnyone](https://github.com/HumanAIGC/AnimateAnyone)

**Verdict:** ❌ **NOT VIABLE** for local inference - Requires 24GB VRAM

---

### 2.3 Animator2D (Loacky)

**Repository:** [HuggingFace Collection](https://huggingface.co/collections/Loacky/animator2d)

**Architecture:**
- v3-alpha: T5 text encoder + Residual Blocks + Self-Attention generator
- Frame Interpolator for multi-frame animations
- Outputs 64x64-128x128 pixel sprites

**Current Status:** Experimental/Alpha
- Developer notes: "Sprites don't match prompts; animations are chaotic"
- Dataset lacks variety for complex animations
- No production-ready inference

**Hardware:** Flexible (GPU/CPU), but output quality insufficient

**Verdict:** ⚠️ **NOT RECOMMENDED** - Experimental, poor quality output

---

## 3. Research Findings: ControlNet + Pose Guidance

### 3.1 OpenPose ControlNet Workflow

**Concept:** Use skeleton poses as structural guidance for consistent frame generation.

**How It Works:**
1. Create/define skeleton poses for each animation frame
2. Use OpenPose ControlNet to guide Stable Diffusion generation
3. IP-Adapter maintains character appearance consistency

**8GB VRAM Viability:**
| Configuration | Resolution | VRAM |
|---------------|------------|------|
| SD1.5 + ControlNet | 512x512 | ~6GB |
| SD1.5 + ControlNet + IP-Adapter | 512x512 | ~8GB |
| 2-pass upscale | 768x768 | ~8GB with --medvram |

**ComfyUI Workflow Components:**
- OpenPose preprocessor (extracts skeleton from reference)
- ControlNet OpenPose model
- IP-Adapter for face/character consistency
- Optional: LineArt ControlNet for shape preservation

**Key Settings:**
- Starting Control Step: 0.5
- ControlNet weight: 0.4-0.6 (not 1.0)
- Run ControlNet for first 20% only for better quality

**Verdict:** ✅ **VIABLE** - Primary recommendation for 8GB VRAM

### 3.2 Creating Custom Pose Templates

**Approach:** Pre-define skeleton poses for each animation frame as reference images.

**Tools:**
- OpenPose Editor (creates/edits skeletons manually)
- Blender character bones (exports OpenPose-compatible skeletons)
- Custom pose collection libraries on Civitai

**Workflow:**
1. Create 8 skeleton poses per animation type (idle, walk, attack, etc.)
2. Store as reference PNG images
3. Use as ControlNet input during generation

**Benefits:**
- Precise pose control
- Reusable across character classes
- Eliminates semantic interpretation issues

---

## 4. Research Findings: Temporal Consistency Approaches

### 4.1 AnimateDiff

**Repository:** [ComfyUI-AnimateDiff-Evolved](https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved)

**Concept:** Motion modules trained alongside SD to create coherent animated sequences.

**Key Features:**
- Context overlap: Frames 1-16 overlap with 12-28 for smooth transitions
- Motion LoRAs: Camera/movement styles (v2 compatible)
- Uniform Context Length: Controls transition smoothness (default: 16)
- FreeNoise: Better noise type for general results

**8GB VRAM Optimization:**
- Resolution: 512x512 (AnimateDiff trained on this)
- Context length: Minimum viable for motion quality
- Model offload: Enabled
- Batch size: 1
- Generate low-res first, then upscale

**Verdict:** ✅ **VIABLE** with optimizations - Good for temporal consistency

### 4.2 IP-Adapter V2 + AnimateDiff

**Combined Workflow:**
- IP-Adapter V2: Reduces memory usage, maintains character consistency
- AnimateDiff: Temporal coherence
- ControlNet OpenPose: Pose accuracy

**VRAM Usage:** ~16GB for full pipeline with ControlNet
- Can reduce by moving motion module to CPU
- ComfyUI more efficient than A1111

**Verdict:** ⚠️ **PARTIALLY VIABLE** - May need CPU offloading or reduced features

---

## 5. Research Findings: Skeletal Animation Systems

### 5.1 AI Auto-Rigging Approaches

**HumanRig Framework:**
- Large-scale dataset (11,434 T-posed meshes)
- Prior-Guided Skeleton Estimator (PGSE)
- Mesh-Skeleton Mutual Attention Network (MSMAN)

**RigNet:**
- End-to-end automated rigging from input models
- Predicts skeleton joints and skin weights

**2D Sketch Rigging (GitHub):**
- Finetuned human pose estimation for sketches
- Requires T-pose input character

**Challenge:** Most rigging tools designed for 3D or realistic humans, not stylized 2D game sprites.

### 5.2 Pose Estimation for Sprites

**DWPose:**
- Wholebody pose estimation (body + face + hands)
- Used in Sprite Sheet Diffusion for annotation
- Struggles with "exaggerated proportions, occluding costumes, non-standard poses"

**Bizarre Pose Estimator:**
- Transfer learning for illustrated characters
- Better for anime/manga style
- [GitHub Repository](https://github.com/ShuhongChen/bizarre-pose-estimator)

**MMPose:**
- Supports animal pose estimation
- 133 keypoint whole-body detection
- Could be adapted for fantasy characters

---

## 6. Research Findings: Frame Interpolation

> **Detailed Analysis:** See [FRAME_INTERPOLATION_ANALYSIS.md](./FRAME_INTERPOLATION_ANALYSIS.md) for comprehensive evaluation of RIFE, DAIN, and FILM for sprite animations.

### 6.1 Summary (from detailed analysis)

Frame interpolation tools are **NOT recommended** for pixel art sprite sheets:

| Tool | VRAM | Speed | Pixel Art Quality |
|------|------|-------|-------------------|
| **RIFE** | ~2GB | 15ms | 5.5/10 (blur on edges) |
| **FILM** | ~4GB | 180ms | 6.2/10 (better motion) |
| **DAIN** | ~6GB | 850ms | 5.8/10 (depth n/a for 2D) |

**Key Issues:**
- Interpolation causes blur artifacts that destroy pixel art crispness
- Algorithms assume sub-pixel motion (pixel art has discrete positions)
- Off-palette colors introduced through color blending
- Edge softening compromises sprite outlines

### 6.2 Limited Use Cases

Interpolation MAY be acceptable for:
- Marketing video export (30fps preview)
- Development iteration (placeholder quality)
- Non-pixel-art styles (watercolor, painterly)

**Verdict:** ⚠️ **NOT RECOMMENDED** for pixel art sprites. Use ControlNet + pose templates instead.

---

## 7. Research Findings: Cloud/API Solutions

### 7.1 PixelLab

**Website:** [pixellab.ai](https://www.pixellab.ai/)

**Features:**
- Skeleton-based animation controls
- Text prompt animation
- Automatic character creator
- Walking, running, attacking, custom animations

**Skeleton Animation Tool:**
- Manual skeleton creation and saving
- Reusable skeletons across characters
- "Fixed head" option for face consistency
- Animation templates

**API:** [api.pixellab.ai/v1/docs](https://api.pixellab.ai/v1/docs)
- Procedural generation support
- MCP server integration available

**Pricing:** $9-$50/month, free tier with limits

**Verdict:** ✅ **VIABLE** - No local GPU needed, production-quality output

### 7.2 Ludo.ai Sprite Generator

**Features:**
- Text commands: "run cycle," "idle," "sword attack"
- Customizable frame counts and layouts
- Unity, Unreal, Godot integration

**Verdict:** ✅ **VIABLE** - Alternative cloud option

### 7.3 God Mode AI

**Features:**
- Open-sourced animation research (173+ GitHub stars)
- 8-directional animations
- Isometric RPG support

**Verdict:** ⚠️ **EXPERIMENTAL** - Open-source, community-driven

---

## 8. Approach Comparison Matrix

| Approach | VRAM Req | Quality Potential | Integration Effort | Frame Consistency | Pose Accuracy |
|----------|----------|-------------------|-------------------|-------------------|---------------|
| **ControlNet + OpenPose + IP-Adapter** | 6-8GB | High | Medium | Good | Excellent |
| **AnimateDiff** | 8GB+ | Medium-High | Medium | Excellent | Medium |
| **Improved Prompting + Pose Templates** | Current | Medium | Low | Poor | Medium |
| **Sprite Sheet Diffusion** | 24-42GB | Excellent | High | Excellent | Excellent |
| **PixelLab API** | None | High | Low | Good | Good |
| **Frame Interpolation** | 4-8GB | Medium | Medium | Excellent | N/A |
| **Hybrid: Reference + ControlNet** | 6-8GB | High | Medium | Good | Excellent |

### Recommendation Ranking (for 8GB VRAM)

1. **ControlNet OpenPose + IP-Adapter + Custom Pose Templates** - Best balance
2. **PixelLab API** - Cloud fallback, proven quality
3. **AnimateDiff with optimizations** - Good temporal consistency
4. **Hybrid reference frame approach** - Generate one frame, derive poses
5. **Improved prompting** - Low effort, moderate improvement

---

## 9. Recommended Research Tasks

### Task 1: ControlNet Pose Template System
**Priority:** HIGH
**Description:** Create reusable OpenPose skeleton templates for each animation type.

**Subtasks:**
1. Research OpenPose skeleton format and keypoint structure
2. Create skeleton templates for idle (8 frames)
3. Create skeleton templates for walk cycle (8 frames)
4. Create skeleton templates for attack (8 frames)
5. Create skeleton templates for hurt/death/cast
6. Build ComfyUI workflow integrating templates
7. Test with current character classes

**Deliverable:** 48 skeleton template images + ComfyUI workflow

---

### Task 2: IP-Adapter Character Consistency Integration
**Priority:** HIGH
**Description:** Integrate IP-Adapter to maintain character appearance across frames.

**Subtasks:**
1. Download ip-adapter-plus-face_sd15.safetensors
2. Set up ComfyUI IP-Adapter nodes
3. Create reference character images per class
4. Test weight settings (start with 0.5)
5. Combine with ControlNet OpenPose
6. Benchmark VRAM usage

**Deliverable:** Updated ComfyUI workflow with IP-Adapter integration

---

### Task 3: AnimateDiff Temporal Consistency Exploration
**Priority:** MEDIUM
**Description:** Evaluate AnimateDiff for generating temporally coherent sprite sequences.

**Subtasks:**
1. Install ComfyUI-AnimateDiff-Evolved
2. Download motion modules (mm_sd_v15_v2)
3. Test 8-frame generation at 512x512
4. Optimize for 8GB VRAM (context length, offloading)
5. Evaluate output quality for sprite-style assets
6. Compare with frame-by-frame approach

**Deliverable:** AnimateDiff workflow + quality comparison report

---

### Task 4: PixelLab API Integration Feasibility
**Priority:** MEDIUM
**Description:** Evaluate PixelLab as cloud-based fallback solution.

**Subtasks:**
1. Sign up for PixelLab free trial
2. Test skeleton animation tool manually
3. Evaluate API capabilities and rate limits
4. Estimate cost for full character generation
5. Build Python wrapper for API integration
6. Compare quality with local generation

**Deliverable:** API wrapper + cost analysis + quality comparison

---

### Task 5: Custom Pose Estimation for Fantasy Characters
**Priority:** LOW
**Description:** Investigate adapting pose estimation models for non-human/stylized characters.

**Subtasks:**
1. Test MMPose on current character outputs
2. Evaluate Bizarre Pose Estimator on fantasy characters
3. Research fine-tuning requirements
4. Assess annotation effort for custom training

**Deliverable:** Feasibility report on custom pose estimation

---

### Task 6: Frame Interpolation Post-Processing
**Priority:** LOW
**Status:** COMPLETE - See [FRAME_INTERPOLATION_ANALYSIS.md](./FRAME_INTERPOLATION_ANALYSIS.md)
**Description:** Evaluate neural frame interpolation for smoother animations.

**Findings:**
- RIFE, DAIN, FILM all fit within 8GB VRAM
- All produce unacceptable blur artifacts for pixel art
- Keyframe-only strategy NOT recommended
- Interpolation only viable for marketing video export

**Conclusion:** Frame interpolation is not suitable for pixel art sprites. Continue with ControlNet + pose templates approach.

---

### Task 7: Sprite Sheet Diffusion Cloud Deployment
**Priority:** LOW (Future)
**Description:** Evaluate running Sprite Sheet Diffusion on cloud GPU for highest quality.

**Subtasks:**
1. Research cloud GPU pricing (Lambda Labs, RunPod)
2. Estimate per-character generation cost
3. Build deployment scripts
4. Test Moore-Animate Anyone implementation
5. Compare quality with local approaches

**Deliverable:** Cloud deployment guide + cost analysis

---

## 10. Implementation Recommendations

### Phase 1: Quick Wins (1-2 weeks)
1. **Create pose skeleton templates** for all animations
2. **Set up ControlNet OpenPose** in existing ComfyUI workflow
3. **Improve prompt templates** with more specific pose descriptions
4. Test baseline improvements

### Phase 2: Character Consistency (2-3 weeks)
1. **Integrate IP-Adapter** for reference image conditioning
2. Create canonical reference images per character class
3. Tune weights for optimal consistency vs. variation
4. Update generation pipeline

### Phase 3: Temporal Refinement (3-4 weeks)
1. **Evaluate AnimateDiff** for temporal coherence
2. If viable, integrate into pipeline
3. Alternatively, implement **PixelLab API** fallback
4. A/B test approaches

### Phase 4: Advanced Optimization (Future)
1. Consider cloud deployment for highest quality models
2. Explore custom pose estimation training
3. Investigate frame interpolation enhancements

### Integration Points

**ComfyUI Workflow Updates:**
```
Current: Flux + V1 LoRA → Post-process → Assemble

Proposed: Flux + V1 LoRA + ControlNet OpenPose + IP-Adapter → Post-process → Assemble
          OR
          AnimateDiff + IP-Adapter → Post-process → Assemble
```

**Required Model Downloads:**
- `control_v11p_sd15_openpose` (~700MB)
- `ip-adapter-plus-face_sd15.safetensors` (~100MB)
- `mm_sd_v15_v2.ckpt` (motion module, ~1.5GB)

---

## 11. Sources

### Papers
- [Sprite Sheet Diffusion (arXiv:2412.03685)](https://arxiv.org/abs/2412.03685)
- [Animate Anyone (arXiv:2311.17117)](https://arxiv.org/abs/2311.17117)
- [RigNet: Neural Rigging for Articulated Characters](https://zhan-xu.github.io/rig-net/)
- [HumanRig: Learning Automatic Rigging](https://arxiv.org/html/2412.02317v1)

### Tools & Repositories
- [ComfyUI-AnimateDiff-Evolved](https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved)
- [Animator2D Collection](https://huggingface.co/collections/Loacky/animator2d)
- [SD_PixelArt_SpriteSheet_Generator](https://huggingface.co/Onodofthenorth/SD_PixelArt_SpriteSheet_Generator)
- [Bizarre Pose Estimator](https://github.com/ShuhongChen/bizarre-pose-estimator)
- [MMPose](https://github.com/open-mmlab/mmpose)

### Commercial Platforms
- [PixelLab](https://www.pixellab.ai/)
- [Ludo.ai Sprite Generator](https://ludo.ai/features/sprite-generator)
- [God Mode AI](https://www.godmodeai.co/)

### Tutorials & Guides
- [8-Gig VRAM Animation Creator Workflow](https://comfyworkflows.com/workflows/587aac58-9656-465b-b686-7c84e814adfa)
- [ComfyUI AnimateDiff Guide (Civitai)](https://civitai.com/articles/2379/guide-comfyui-animatediff-guideworkflows-including-prompt-scheduling-an-inner-reflections-guide)
- [OpenPose ControlNet Tutorial](https://www.nextdiffusion.ai/tutorials/how-to-use-open-pose-controlnet-in-stable-diffusion)
- [IP-Adapter Guide](https://stable-diffusion-art.com/ip-adapter/)

---

## Appendix A: OpenPose Skeleton Structure

OpenPose detects 18 body keypoints:
```
0: Nose
1: Neck
2: Right Shoulder
3: Right Elbow
4: Right Wrist
5: Left Shoulder
6: Left Elbow
7: Left Wrist
8: Right Hip
9: Right Knee
10: Right Ankle
11: Left Hip
12: Left Knee
13: Left Ankle
14: Right Eye
15: Left Eye
16: Right Ear
17: Left Ear
```

For hand-drawn skeleton templates, connect keypoints with colored lines:
- Body: White/Light Gray
- Arms: Blue tones
- Legs: Green tones

---

## Appendix B: Animation Frame Guidelines

### Idle Animation (8 frames, loop)
| Frame | Description | Key Poses |
|-------|-------------|-----------|
| 0 | Neutral stance | Weight centered, arms relaxed |
| 1 | Slight weight shift | Hips shift left slightly |
| 2 | Breathing in | Chest rises slightly |
| 3 | Weight return | Hips return to center |
| 4 | Neutral | Same as frame 0 |
| 5 | Arm movement | Slight hand/finger adjustment |
| 6 | Breathing out | Chest lowers slightly |
| 7 | Settle | Return to neutral |

### Walk Cycle (8 frames, loop)
| Frame | Description | Key Poses |
|-------|-------------|-----------|
| 0 | Contact (left) | Left heel touches, right toe pushes |
| 1 | Down (left) | Weight transfers to left |
| 2 | Passing (left) | Right foot passes left |
| 3 | High point | Right foot forward in air |
| 4 | Contact (right) | Right heel touches |
| 5 | Down (right) | Weight transfers to right |
| 6 | Passing (right) | Left foot passes right |
| 7 | High point | Left foot forward in air |

### Attack Animation (8 frames, single)
| Frame | Description | Key Poses |
|-------|-------------|-----------|
| 0 | Ready stance | Weapon at rest, alert posture |
| 1 | Wind-up | Pull back weapon/arm |
| 2 | Peak | Maximum extension back |
| 3 | Swing start | Begin forward motion |
| 4 | Impact | Point of contact |
| 5 | Follow-through | Continue past impact |
| 6 | Recovery | Begin returning |
| 7 | Return to ready | Back to frame 0 pose |

---

*Report generated: 2026-01-30*
*Next review: After Phase 1 implementation*
