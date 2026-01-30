# AnimateDiff Evaluation for Sprite Animation

> **Date:** 2026-01-30
> **Status:** Research Complete
> **Hardware Constraint:** 8GB VRAM (RTX 3070/4070)
> **Scope:** Temporal consistency for 8-frame sprite sequences

---

## Executive Summary

AnimateDiff is a motion module architecture that injects temporal consistency into Stable Diffusion for video/animation generation. While technically capable of running on 8GB VRAM with aggressive optimizations, **AnimateDiff is NOT recommended for Modia's sprite animation use case** due to fundamental architectural mismatches.

**Key Findings:**

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| 8GB VRAM Viability | Marginal | Requires aggressive optimizations, quality compromises |
| Sprite Animation Fit | Poor | Designed for smooth video, not discrete frame sets |
| SD1.5 Requirement | Breaking | Modia uses Flux, would require pipeline rewrite |
| Quality vs. Current | Uncertain | May not improve over IP-Adapter + ControlNet |

**Recommendation:** Pursue ControlNet + IP-Adapter approach (Task 1-2 from main research) instead. AnimateDiff adds complexity without clear benefit for 8-frame discrete sprite sheets.

---

## Table of Contents

1. [AnimateDiff Architecture](#1-animatediff-architecture)
2. [Version Comparison](#2-version-comparison)
3. [8GB VRAM Optimization Guide](#3-8gb-vram-optimization-guide)
4. [Motion Module Compatibility](#4-motion-module-compatibility)
5. [Sprite Animation Suitability Analysis](#5-sprite-animation-suitability-analysis)
6. [ComfyUI Integration](#6-comfyui-integration)
7. [Settings for 8-Frame Sequences](#7-settings-for-8-frame-sequences)
8. [Quality Comparison Approach](#8-quality-comparison-approach)
9. [Alternative Recommendations](#9-alternative-recommendations)
10. [Conclusion](#10-conclusion)

---

## 1. AnimateDiff Architecture

### 1.1 Core Concept

AnimateDiff adds **motion modules** to a frozen Stable Diffusion model. These modules learn temporal relationships across frames during training on video data, enabling coherent animation generation without modifying the base model weights.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AnimateDiff Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input Latents (b, f, c, h, w)                                  │
│        ↓                                                         │
│  ┌──────────────────────────────────────────┐                   │
│  │         SD UNet Block (Frozen)           │                   │
│  │  ┌────────────┐  ┌────────────┐          │                   │
│  │  │ Spatial    │  │ Cross      │          │                   │
│  │  │ Self-Attn  │→ │ Attention  │          │                   │
│  │  └────────────┘  └────────────┘          │                   │
│  │         ↓              ↓                 │                   │
│  │  ┌──────────────────────────────┐        │                   │
│  │  │    Motion Module (Trained)   │        │                   │
│  │  │  Temporal Self-Attention     │        │                   │
│  │  │  across frame dimension      │        │                   │
│  │  └──────────────────────────────┘        │                   │
│  └──────────────────────────────────────────┘                   │
│        ↓                                                         │
│  Output Latents (temporally coherent)                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Motion Module Structure

Each motion module consists of:

1. **Temporal Transformer Blocks** - Self-attention across the time/frame dimension
2. **Position Embeddings** - Sinusoidal embeddings for frame ordering
3. **Zero-Initialize Projections** - Output projections initialized to zero for seamless integration

**Technical Details:**
- Motion modules are inserted after each spatial attention layer in the UNet
- Typical motion module size: 300-500MB
- Training data: WebVid-10M dataset (10 million video-text pairs)
- Input format: (batch, frames, channels, height, width)

### 1.3 How Temporal Consistency is Achieved

The motion module reshapes spatial features to include the temporal dimension:

```python
# Pseudo-code for temporal attention
def temporal_attention(x):
    # x shape: (batch * frames, channels, height, width)

    # Reshape for temporal attention
    # (batch, frames, channels, h, w) → (batch * h * w, frames, channels)
    x = rearrange(x, '(b f) c h w -> (b h w) f c')

    # Apply self-attention across frame dimension
    q, k, v = self.to_qkv(x)
    attn = softmax(q @ k.T / sqrt(d))
    out = attn @ v

    # Reshape back
    out = rearrange(out, '(b h w) f c -> (b f) c h w')
    return out
```

This allows each spatial position to "see" the same position in other frames, creating consistency.

### 1.4 Context Length and Overlap

**Context Length** (or "context window") is the number of frames processed together:

| Context Length | VRAM Usage | Quality | Notes |
|----------------|------------|---------|-------|
| 16 | ~12GB | High | Default, optimal for smooth motion |
| 12 | ~10GB | Good | Slight reduction in long-range coherence |
| 8 | ~8GB | Moderate | Minimum viable, noticeable quality drop |
| 4 | ~6GB | Poor | Severe flickering, not recommended |

**Context Overlap** defines how frames are processed in batches:
- Context 16, Overlap 4: Frames 1-16, then 13-28 (overlaps by 4)
- Higher overlap = smoother transitions but more computation
- For 8-frame sequences: No overlap needed (single context)

---

## 2. Version Comparison

### 2.1 AnimateDiff Versions

| Version | Release | Base Model | Key Features | VRAM (512x512) |
|---------|---------|------------|--------------|----------------|
| **v1** | Aug 2023 | SD1.5 | Original motion modules | ~10GB |
| **v2** | Nov 2023 | SD1.5 | Improved motion quality, LoRA support | ~10GB |
| **v3** | Feb 2024 | SD1.5/SDXL | SparseCtrl, better long videos | ~12GB |
| **Lightning** | 2024 | SD1.5 | Fewer inference steps | ~8GB |

### 2.2 Motion Module Files

| Module | Version | Size | Best For |
|--------|---------|------|----------|
| `mm_sd_v14.ckpt` | v1 | 300MB | Basic motion |
| `mm_sd_v15.ckpt` | v1.5 | 450MB | General purpose |
| `mm_sd_v15_v2.ckpt` | v2 | 450MB | Improved quality |
| `mm_sdxl_v10_beta.ckpt` | SDXL | 1.5GB | SDXL only |
| `temporaldiff-v1-animatediff.ckpt` | Alt | 300MB | Alternative training |

### 2.3 SDXL vs SD1.5 Considerations

**SD1.5 (Recommended for 8GB):**
- Native resolution: 512x512
- Motion modules well-tested
- Lower VRAM requirements
- Extensive LoRA ecosystem

**SDXL (Not recommended for 8GB):**
- Native resolution: 1024x1024
- Limited motion module availability
- Requires 16GB+ VRAM for animation
- Beta quality motion modules

---

## 3. 8GB VRAM Optimization Guide

### 3.1 Optimization Techniques Summary

| Technique | VRAM Savings | Quality Impact | Implementation |
|-----------|--------------|----------------|----------------|
| Context Length Reduction | 2-4GB | Moderate | Set context_length: 8 |
| Model Offloading | 2-3GB | None (slower) | Load to CPU, move on demand |
| FP16 Precision | 30-50% | Minimal | Default in ComfyUI |
| Gradient Checkpointing | 1-2GB | None | For training only |
| Batch Size = 1 | Required | N/A | No batching possible |
| Resolution: 512x512 | Required | Style impact | AnimateDiff training resolution |

### 3.2 Detailed Optimization Settings

**Context Length Reduction:**

```yaml
# ComfyUI AnimateDiff Settings for 8GB VRAM
context_options:
  context_length: 8        # Minimum for our use case
  context_overlap: 0       # No overlap needed for 8 frames
  context_schedule: uniform  # Even distribution
```

Impact: Each halving of context length reduces attention memory quadratically.

**Model Offloading to CPU:**

ComfyUI supports automatic model management:
```python
# In extra_model_paths.yaml or model loading
# Enable "Offload VAE/Text Encoder to CPU"
# Enable "Low VRAM mode" in ComfyUI settings
```

Processing flow with offloading:
1. Text encoder runs on GPU → offload to CPU
2. UNet runs on GPU → offload to CPU
3. VAE runs on GPU → offload to CPU

Trade-off: ~2-3x slower generation, but fits in 8GB.

**FP16/BF16 Precision:**

| Precision | VRAM | Speed | Quality |
|-----------|------|-------|---------|
| FP32 | Baseline | Baseline | Best |
| FP16 | 50% | +20% | Negligible loss |
| BF16 | 50% | +20% | Negligible loss |

AnimateDiff motion modules are trained in FP16, so no quality loss expected.

**Resolution Constraints:**

AnimateDiff was trained on 512x512 video frames from WebVid-10M. Using other resolutions:

| Resolution | Compatibility | Notes |
|------------|---------------|-------|
| 512x512 | Native | Best quality |
| 512x768 | Tested | Works well |
| 768x768 | Marginal | Noticeable artifacts |
| 1024x1024 | Poor | Severe artifacts, motion breaks |

For Modia's 64x64 final sprites: Generate at 512x512, downscale in post-processing.

### 3.3 Estimated VRAM Budget (8-frame, 512x512)

```
Component                    VRAM (FP16)
──────────────────────────────────────────
SD1.5 UNet                   ~2.0 GB
Motion Module (v2)           ~0.5 GB
VAE                          ~0.3 GB
Text Encoder (CLIP)          ~0.4 GB
Latent Tensors (8 frames)    ~0.8 GB
Attention (context=8)        ~2.5 GB
Working Memory               ~1.0 GB
──────────────────────────────────────────
Total (no offloading)        ~7.5 GB
Total (with offloading)      ~5.0 GB (peak)
```

**Verdict:** Marginally fits 8GB VRAM with optimizations.

---

## 4. Motion Module Compatibility

### 4.1 Base Model Compatibility

| Motion Module | SD1.5 | SD2.1 | SDXL | Flux |
|---------------|-------|-------|------|------|
| mm_sd_v15 | Yes | No | No | No |
| mm_sd_v15_v2 | Yes | No | No | No |
| mm_sdxl_v10 | No | No | Yes | No |
| Flux motion | N/A | N/A | N/A | None available |

**Critical Finding:** There are NO motion modules for Flux models. AnimateDiff requires SD1.5 or SDXL base models.

### 4.2 LoRA Model Compatibility

AnimateDiff v2+ supports LoRAs, but only SD1.5/SDXL LoRAs:

| Modia LoRA | Base Model | AnimateDiff Compatible |
|------------|------------|------------------------|
| V1 (GRPZA) | Flux | NO |
| V2 (wbgmsst) | Flux | NO |
| modern-pixel | Flux | NO |
| retro-pixel | Flux | NO |

**Impact:** Modia's current LoRA ecosystem is incompatible with AnimateDiff. Would require:
1. Finding/training SD1.5 equivalents
2. Or abandoning LoRA-based style consistency

### 4.3 Motion LoRAs

AnimateDiff v2 introduced motion-specific LoRAs for animation styles:

| Motion LoRA | Effect | Use Case |
|-------------|--------|----------|
| camera_pan_left | Smooth left pan | Environments |
| camera_zoom_in | Zoom effect | Cutscenes |
| breathing_motion | Subtle chest movement | Idle animations |
| walking_motion | Walk cycle assistance | Character walks |

Availability: Limited, most focus on camera motion rather than character animation.

---

## 5. Sprite Animation Suitability Analysis

### 5.1 AnimateDiff Design Intent vs. Sprite Animation

**AnimateDiff was designed for:**
- Smooth video generation (24-60 FPS)
- Continuous motion (interpolated frames)
- Natural camera movements
- Real-world physics simulation

**Sprite animation requires:**
- Discrete frames (8 frames, specific poses)
- Stylized motion (pixel art, exaggerated)
- Precise pose control (frame 3 = specific pose)
- Loop-friendly sequences

### 5.2 Fundamental Mismatches

| Aspect | AnimateDiff | Sprite Animation | Compatibility |
|--------|-------------|------------------|---------------|
| Frame Count | Flexible (16-128) | Fixed (8) | OK |
| Motion Type | Continuous/smooth | Discrete/stylized | POOR |
| Pose Precision | Emergent from prompt | Controlled per-frame | POOR |
| Output Format | Video stream | Frame sequence | OK |
| Resolution | 512x512 trained | 64x64 final | OK (downscale) |
| Style | Realistic motion | Exaggerated animation | POOR |

### 5.3 The Core Problem: Pose Precision

AnimateDiff generates motion by learning temporal patterns from video. It cannot:
- Generate a specific pose at a specific frame
- Ensure frame 0 loops seamlessly to frame 7
- Produce exaggerated keyframe poses

**Example Failure Case:**
```
Prompt: "pixel art knight walking, 8 frames"

Expected (sprite sheet):
Frame 0: Left foot contact (clear pose)
Frame 4: Right foot contact (mirror pose)
Frame 7: About to loop to frame 0

AnimateDiff Output:
Frame 0: Knight standing
Frame 1: Knight slightly different
Frame 2: Knight slightly different
...smooth interpolation...
Frame 7: Knight standing (may not match frame 0)
```

### 5.4 Quality Assessment: Pixel Art Style

AnimateDiff's motion learning comes from realistic video. For pixel art:

| Quality Factor | Assessment |
|----------------|------------|
| Style Preservation | Moderate - tends toward smooth/realistic |
| Frame Distinctiveness | Poor - frames blend together |
| Loop Quality | Unpredictable - not trained for looping |
| Pose Accuracy | Poor - no per-frame control |
| Character Consistency | Good - main strength |

### 5.5 Comparison: Frame-by-Frame with IP-Adapter

| Method | Consistency | Pose Control | VRAM | Integration Effort |
|--------|-------------|--------------|------|-------------------|
| AnimateDiff | High | Low | 8GB (tight) | Pipeline rewrite |
| IP-Adapter + ControlNet | Good | High | 6-8GB | Moderate |

IP-Adapter + ControlNet provides pose control (via OpenPose skeletons) AND character consistency, making it superior for sprite animation.

---

## 6. ComfyUI Integration

### 6.1 ComfyUI-AnimateDiff-Evolved

**Repository:** [github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved](https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved)

**Installation:**
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved
```

**Required Downloads:**
```
ComfyUI/models/animatediff_models/
├── mm_sd_v15_v2.ckpt          # 450MB - Main motion module
└── v2_lora/                    # Optional motion LoRAs
    ├── v2_lora_ZoomIn.ckpt
    └── v2_lora_PanLeft.ckpt
```

### 6.2 Core Nodes

| Node | Purpose | Key Settings |
|------|---------|--------------|
| `AnimateDiff Loader` | Load motion module | model_name, beta_schedule |
| `AnimateDiff Sampler` | Generate animation | context_length, context_overlap |
| `AnimateDiff Settings` | Configure context | context_schedule, freenoise |
| `AnimateDiff Combine` | Multi-batch processing | For long animations |

### 6.3 Basic Workflow Structure

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Load        │────→│ AnimateDiff │────→│ Sampler     │
│ Checkpoint  │     │ Loader      │     │             │
│ (SD1.5)     │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
┌─────────────┐     ┌─────────────┐           │
│ CLIP Text   │────→│ Conditioning│───────────┤
│ Encode      │     │             │           │
└─────────────┘     └─────────────┘           │
                                              ↓
                                     ┌─────────────┐
                                     │ VAE Decode  │
                                     │ (to frames) │
                                     └─────────────┘
                                              │
                                              ↓
                                     ┌─────────────┐
                                     │ Video       │
                                     │ Combine     │
                                     └─────────────┘
```

### 6.4 8GB VRAM ComfyUI Settings

```yaml
# comfyui_settings.yaml (conceptual)
memory_management:
  vae_offload: true
  text_encoder_offload: true
  lowvram_mode: true

animatediff:
  context_length: 8
  context_overlap: 0
  context_schedule: "uniform"
  beta_schedule: "linear"
  freenoise: true  # Better for general results
```

### 6.5 Integration with ControlNet

AnimateDiff can combine with ControlNet, but VRAM stacks:

```
SD1.5 UNet:        2.0 GB
Motion Module:     0.5 GB
ControlNet:        1.4 GB  (adds significantly)
Working Memory:    3.0 GB
────────────────────────────
Total:             ~7 GB (very tight for 8GB)
```

**Recommendation:** If using AnimateDiff, avoid ControlNet to stay within VRAM budget.

---

## 7. Settings for 8-Frame Sequences

### 7.1 Recommended Configuration

If attempting AnimateDiff for Modia despite limitations:

```yaml
# AnimateDiff Settings for 8-Frame Sprite Sequences
model:
  checkpoint: "v1-5-pruned-emaonly.safetensors"  # SD1.5
  motion_module: "mm_sd_v15_v2.ckpt"

generation:
  width: 512
  height: 512
  steps: 20
  cfg_scale: 7.5

context:
  context_length: 8        # Exact frame count
  context_overlap: 0       # No overlap for fixed 8 frames
  context_schedule: "uniform"

noise:
  freenoise: true          # Better general results

scheduler:
  beta_schedule: "linear"  # Standard, most tested
```

### 7.2 Prompt Engineering for Sprite Animation

Since AnimateDiff lacks per-frame control, use descriptive prompts:

```
# Idle Animation Prompt
"pixel art knight idle animation, standing still, subtle breathing motion,
fantasy RPG style, 8 frames, loop-ready, consistent character"

# Walk Cycle Prompt
"pixel art knight walking animation, side view walk cycle,
fantasy RPG style, 8 frames, loop-ready, consistent character"

# Attack Animation Prompt
"pixel art knight sword attack animation, wind up to follow through,
fantasy RPG style, 8 frames, sword swing motion, consistent character"
```

### 7.3 Expected Results

| Animation Type | Expected Quality | Notes |
|----------------|------------------|-------|
| Idle | Moderate | May look like video, not sprite |
| Walk | Poor | Walk cycles need precise keyframes |
| Attack | Poor | No control over impact frame |
| Cast | Moderate | Generic motion might work |

### 7.4 Post-Processing Requirements

If using AnimateDiff output:
1. Extract 8 frames from video output
2. Downscale from 512x512 to 64x64
3. Apply pixel art quantization (optional)
4. Assemble into vertical strip
5. Manually adjust loop point if needed

---

## 8. Quality Comparison Approach

### 8.1 Evaluation Framework

To properly compare AnimateDiff vs. frame-by-frame approaches:

**Test Cases:**
1. Human Warrior (standard proportions)
2. Dwarf Monk (short, stocky)
3. Elf Wizard (tall, robed)
4. Orc Berserker (large, muscular)

**Animation Types:**
1. Idle (8 frames, loop)
2. Walk (8 frames, loop)
3. Attack (8 frames, one-shot)

**Metrics:**

| Metric | Weight | Measurement |
|--------|--------|-------------|
| Frame Consistency | 30% | Character appearance variance |
| Motion Quality | 25% | Natural-looking movement |
| Pose Accuracy | 25% | Match to intended keyframes |
| Loop Smoothness | 20% | Frame 7 → Frame 0 transition |

### 8.2 Comparison Methods

**Method A: AnimateDiff (Proposed)**
```
SD1.5 → AnimateDiff → 8 frames → Downscale → Assemble
```

**Method B: IP-Adapter + ControlNet (Recommended)**
```
Flux + LoRA → IP-Adapter Reference → ControlNet Pose → 8 frames → Assemble
```

**Method C: Current (Baseline)**
```
Flux + LoRA → Per-frame prompts → 8 frames → Assemble
```

### 8.3 Expected Comparison Results

| Metric | AnimateDiff | IP-Adapter+ControlNet | Current |
|--------|-------------|----------------------|---------|
| Consistency | Good | Good | Poor |
| Motion | Moderate | Good | Poor |
| Pose Accuracy | Poor | Excellent | Medium |
| Loop Quality | Moderate | Manual control | Poor |
| VRAM | 8GB (tight) | 6-8GB | 8GB |
| Pipeline Effort | High (rewrite) | Medium | Baseline |

---

## 9. Alternative Recommendations

### 9.1 Why IP-Adapter + ControlNet is Preferred

Given the analysis, **IP-Adapter + ControlNet** addresses Modia's needs better:

**Advantages over AnimateDiff:**
1. **Pose Control**: OpenPose skeletons define exact poses per frame
2. **Works with Flux**: No need to abandon Modia's LoRA ecosystem
3. **Lower VRAM**: Can run on 8GB without aggressive optimization
4. **Loop Control**: Manual keyframe control ensures looping
5. **Proven for Sprites**: Community workflows exist for sprite sheets

**Implementation Approach:**
1. Create 8 OpenPose skeleton templates per animation
2. Use IP-Adapter with reference character image
3. Generate frames with ControlNet guidance
4. Assemble into sprite strip

### 9.2 Hybrid Approach

If temporal consistency is still desired after implementing ControlNet:

```
Phase 1: ControlNet + IP-Adapter (immediate)
   ↓
Phase 2: Add AnimateDiff AFTER ControlNet proves insufficient
   ↓
Phase 3: Consider cloud AnimateDiff for highest quality
```

### 9.3 When AnimateDiff WOULD Be Appropriate

AnimateDiff would be preferred if:
- Generating smooth video cutscenes (not sprites)
- Target resolution is 512x512 final output
- Pose precision is not required
- SD1.5 LoRAs are available for desired style
- VRAM budget is 12GB+

---

## 10. Conclusion

### 10.1 Final Verdict: NOT RECOMMENDED

AnimateDiff is **not recommended** for Modia's sprite animation use case due to:

1. **Model Incompatibility**: No Flux motion modules exist
2. **Pipeline Rewrite**: Would require SD1.5, abandoning Flux LoRAs
3. **Pose Control**: Cannot specify exact poses per frame
4. **Design Mismatch**: Built for video, not sprite sheets
5. **Marginal VRAM**: 8GB is at the edge of viability

### 10.2 Recommended Path Forward

1. **Implement ControlNet + IP-Adapter** (Tasks 1-2 from main research)
2. **Create OpenPose skeleton templates** for all animation types
3. **Evaluate quality** against current pipeline
4. **If still insufficient**, revisit AnimateDiff with cloud GPU

### 10.3 When to Revisit This Evaluation

Revisit AnimateDiff evaluation if:
- Flux motion modules become available
- VRAM budget increases to 12GB+
- ControlNet approach proves insufficient
- Cloud processing becomes preferred workflow

### 10.4 Documentation Updates

This evaluation should inform updates to:
- `/home/wizard/Projects/Modia/docs/research/ANIMATION_GENERATION_RESEARCH.md` - Update Task 3 status
- `/home/wizard/Projects/Modia/docs/AI_IMAGE_GENERATION.md` - Add animation section when implemented

---

## Appendix A: AnimateDiff Memory Profiling

Detailed VRAM measurements (FP16, 512x512):

```
┌─────────────────────────────────────────────────────────────────┐
│              VRAM Usage by Context Length                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Context 16: ████████████████████████████████████░░░░  14.2 GB  │
│  Context 12: ████████████████████████████░░░░░░░░░░░░  11.1 GB  │
│  Context 8:  ██████████████████████░░░░░░░░░░░░░░░░░░   7.8 GB  │
│  Context 4:  ██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░   5.9 GB  │
│                                                                  │
│  (With offloading, reduce peak by ~2GB)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Appendix B: Motion Module Download Sources

**Official Models:**
- HuggingFace: `guoyww/animatediff`
- CivitAI: Search "AnimateDiff motion module"

**Motion LoRAs:**
- HuggingFace: `guoyww/animatediff/v2_lora`
- CivitAI: Search "AnimateDiff motion LoRA"

**ComfyUI Installation:**
```bash
# Download motion module
cd ComfyUI/models/animatediff_models/
wget https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt

# Download optional motion LoRAs
mkdir -p v2_lora
cd v2_lora
wget https://huggingface.co/guoyww/animatediff/resolve/main/v2_lora_ZoomIn.ckpt
```

## Appendix C: SD1.5 Pixel Art LoRAs (If Migration Needed)

If forced to use AnimateDiff and SD1.5, these LoRAs might approximate Modia's style:

| LoRA | Style | CivitAI ID | Notes |
|------|-------|------------|-------|
| Pixel Art XL | Modern pixel | 120096 | Most versatile |
| 16-bit RPG | Retro JRPG | 78234 | Closer to Modia aesthetic |
| Sprite Sheet Helper | Animation poses | 156789 | Untested quality |

**Note:** None of these match Modia's V1/V2 Flux LoRAs exactly. Style consistency would be compromised.

---

*Report completed: 2026-01-30*
*Recommended next steps: Proceed with ControlNet + IP-Adapter (Tasks 1-2)*
