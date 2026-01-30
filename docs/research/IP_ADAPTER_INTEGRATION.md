# IP-Adapter Integration Research Report

> **Date:** 2026-01-30
> **Status:** Research Complete
> **Hardware Constraint:** 8GB VRAM (RTX 3070/4070)
> **Related Document:** [ANIMATION_GENERATION_RESEARCH.md](ANIMATION_GENERATION_RESEARCH.md)
> **Purpose:** Maintain character appearance consistency across animation frames

---

## Executive Summary

This report evaluates IP-Adapter as a solution for maintaining character consistency across the 8 frames in Modia's sprite sheet animations. The analysis reveals a **critical compatibility issue**: the current pipeline uses **Flux** models, while IP-Adapter is designed for **Stable Diffusion** architectures.

**Key Finding:** Direct IP-Adapter integration with Flux is NOT currently possible. However, viable alternatives exist within the 8GB VRAM constraint.

### Recommendation Summary

| Approach | Viability | VRAM | Notes |
|----------|-----------|------|-------|
| **IP-Adapter + SD1.5** | Viable | 6-8GB | Requires model switch from Flux |
| **IP-Adapter + SDXL** | Partially Viable | 10-12GB | Exceeds constraint, needs offloading |
| **Flux with Redux (img2img)** | Viable | 8GB | Native Flux approach, different mechanism |
| **ControlNet Only (No IP-Adapter)** | Viable | 6-8GB | Pose control without appearance lock |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [IP-Adapter Variants and Memory Requirements](#2-ip-adapter-variants-and-memory-requirements)
3. [Flux Compatibility Analysis](#3-flux-compatibility-analysis)
4. [8GB VRAM Viability Analysis](#4-8gb-vram-viability-analysis)
5. [Weight and Strength Settings](#5-weight-and-strength-settings)
6. [Reference Image Strategy](#6-reference-image-strategy)
7. [ComfyUI Integration Approach](#7-comfyui-integration-approach)
8. [LoRA Interaction Analysis](#8-lora-interaction-analysis)
9. [Alternative Approaches for Flux](#9-alternative-approaches-for-flux)
10. [Recommendations](#10-recommendations)
11. [Sources](#11-sources)

---

## 1. Architecture Overview

### What is IP-Adapter?

IP-Adapter (Image Prompt Adapter) is a lightweight adapter that enables image prompting capabilities for pre-trained text-to-image diffusion models. It allows using reference images to guide generation while maintaining the model's text-following abilities.

### Core Architecture

```
Reference Image
      |
      v
+------------------+
| CLIP Image       |  (ViT-H/14 or ViT-G/14)
| Encoder          |  (~1.8GB for ViT-H)
+------------------+
      |
      v
+------------------+
| Projection       |  (IP-Adapter weights)
| Layers           |  (~22MB - 1.2GB depending on variant)
+------------------+
      |
      v
+------------------+
| Cross-Attention  |  (Injected into UNet)
| Injection        |  (Decoupled cross-attention)
+------------------+
      |
      v
   Diffusion Model (SD1.5/SDXL)
```

### Key Innovation: Decoupled Cross-Attention

IP-Adapter adds a separate cross-attention layer for image features alongside the existing text cross-attention:

```
Z_new = Softmax(Q * K_text^T) * V_text + lambda * Softmax(Q * K_image^T) * V_image
```

Where `lambda` is the IP-Adapter weight (typically 0.5-1.0).

This allows:
- Text prompts to control style, composition, and details
- Image prompts to control appearance, structure, and identity
- Independent weighting of each influence

---

## 2. IP-Adapter Variants and Memory Requirements

### Official IP-Adapter Models (h94/IP-Adapter)

| Variant | Base Model | Parameters | File Size | VRAM Impact | Use Case |
|---------|------------|------------|-----------|-------------|----------|
| **ip-adapter_sd15** | SD 1.5 | 22M | 44MB | +200MB | General image prompting |
| **ip-adapter_sd15_light** | SD 1.5 | 8M | 16MB | +100MB | Lightweight, subtle influence |
| **ip-adapter-plus_sd15** | SD 1.5 | 98M | 196MB | +300MB | Enhanced detail preservation |
| **ip-adapter-plus-face_sd15** | SD 1.5 | 98M | 196MB | +300MB | Face/identity consistency |
| **ip-adapter-full-face_sd15** | SD 1.5 | 98M | 196MB | +300MB | Full face identity lock |
| **ip-adapter_sdxl** | SDXL | 355M | 710MB | +500MB | SDXL general prompting |
| **ip-adapter-plus_sdxl** | SDXL | 355M | 1.2GB | +800MB | SDXL enhanced detail |
| **ip-adapter-plus-face_sdxl** | SDXL | 355M | 1.2GB | +800MB | SDXL face consistency |

### Required Image Encoders

| Encoder | Size | Required For |
|---------|------|--------------|
| **CLIP ViT-H/14 (laion)** | 1.8GB | All SD1.5 IP-Adapters |
| **CLIP ViT-bigG/14 (laion)** | 2.8GB | All SDXL IP-Adapters |
| **InsightFace (antelopev2)** | 300MB | Face-specific adapters (optional enhancement) |

### Total Storage Requirements

**For SD1.5 (Recommended for 8GB):**
- CLIP ViT-H/14: 1.8GB
- IP-Adapter model: 44MB - 196MB
- SD1.5 base model: 4GB (or 2GB for fp16)
- ControlNet (optional): 700MB - 1.4GB
- **Total disk: ~6-8GB**

**For SDXL:**
- CLIP ViT-bigG/14: 2.8GB
- IP-Adapter model: 710MB - 1.2GB
- SDXL base model: 6.5GB
- **Total disk: ~10-11GB**

---

## 3. Flux Compatibility Analysis

### Critical Finding: No Direct IP-Adapter Support for Flux

IP-Adapter is **NOT compatible with Flux** architectures. The reasons are architectural:

| Aspect | Stable Diffusion | Flux |
|--------|------------------|------|
| **Architecture** | UNet-based | DiT (Diffusion Transformer) |
| **Cross-Attention** | Standard Q-K-V | Different attention mechanism |
| **CLIP Integration** | Via cross-attention | Via T5 + CLIP text encoders |
| **IP-Adapter Method** | Decoupled cross-attention injection | Not applicable |

### Why IP-Adapter Doesn't Work with Flux

1. **No UNet:** Flux uses a transformer architecture (DiT) instead of UNet
2. **Different Attention:** The cross-attention mechanism differs fundamentally
3. **Encoder Integration:** Flux uses T5-XXL + CLIP for text, different from SD's CLIP-only approach
4. **No Official Support:** Tencent's IP-Adapter team has not released Flux-compatible weights

### Current Flux Image Conditioning Options

| Method | Description | Support |
|--------|-------------|---------|
| **Redux (img2img)** | Conditions on input image via latent space | Native Flux |
| **ControlNet Flux** | Structural control (poses, edges) | Limited support |
| **Style Transfer** | Style embedding extraction | Experimental |
| **Reference-Only** | Not available | - |

---

## 4. 8GB VRAM Viability Analysis

### Scenario A: SD1.5 + IP-Adapter (No ControlNet)

| Component | VRAM Usage |
|-----------|------------|
| SD1.5 (fp16) | 2.5GB |
| VAE | 0.3GB |
| CLIP ViT-H/14 (image encoder) | 1.8GB |
| IP-Adapter weights | 0.2GB |
| Generation overhead | 1.5GB |
| **Total** | **~6.3GB** |

**Verdict:** Viable at 512x512, tight at 768x768

### Scenario B: SD1.5 + IP-Adapter + ControlNet OpenPose

| Component | VRAM Usage |
|-----------|------------|
| SD1.5 (fp16) | 2.5GB |
| VAE | 0.3GB |
| CLIP ViT-H/14 | 1.8GB |
| IP-Adapter weights | 0.2GB |
| ControlNet OpenPose | 0.7GB |
| Generation overhead | 1.5GB |
| **Total** | **~7.0GB** |

**Verdict:** Viable at 512x512 with --medvram optimizations

### Scenario C: SD1.5 + IP-Adapter + ControlNet + LoRA

| Component | VRAM Usage |
|-----------|------------|
| SD1.5 (fp16) | 2.5GB |
| VAE | 0.3GB |
| CLIP ViT-H/14 | 1.8GB |
| IP-Adapter weights | 0.2GB |
| ControlNet OpenPose | 0.7GB |
| LoRA weights | 0.1GB |
| Generation overhead | 1.5GB |
| **Total** | **~7.1GB** |

**Verdict:** Viable at 512x512, may need model offloading

### Scenario D: SDXL + IP-Adapter

| Component | VRAM Usage |
|-----------|------------|
| SDXL (fp16) | 6.5GB |
| VAE | 0.4GB |
| CLIP ViT-bigG/14 | 2.0GB |
| IP-Adapter weights | 0.5GB |
| Generation overhead | 2.0GB |
| **Total** | **~11.4GB** |

**Verdict:** NOT viable without aggressive offloading

### VRAM Optimization Techniques

| Technique | VRAM Savings | Trade-off |
|-----------|--------------|-----------|
| **Model CPU Offload** | 2-4GB | 2-5x slower inference |
| **Attention Slicing** | 1-2GB | 10-20% slower |
| **VAE Tiling** | 0.5GB | Artifacts at tile boundaries |
| **fp16 Models** | 50% | Minimal quality loss |
| **Sequential Loading** | Variable | Significant latency |

### Recommended 8GB Configuration

```yaml
Model: SD1.5 (fp16)
Resolution: 512x512 (upscale later)
IP-Adapter: ip-adapter-plus-face_sd15
ControlNet: control_v11p_sd15_openpose
Optimizations:
  - Enable model CPU offload
  - Use attention slicing
  - Batch size: 1
  - Generate frames sequentially
```

---

## 5. Weight and Strength Settings

### IP-Adapter Weight Guidelines

| Weight | Effect | Use Case |
|--------|--------|----------|
| 0.0 | No image influence | Disabled |
| 0.3-0.5 | Subtle influence | Style hints, loose consistency |
| 0.5-0.7 | **Balanced (Recommended)** | Character consistency + variation |
| 0.7-0.9 | Strong influence | Tight identity lock |
| 1.0 | Maximum influence | Near-copy, reduced creativity |

### Sprite-Specific Recommendations

For 64x64 sprite animations requiring consistency while allowing pose variation:

| Setting | Value | Rationale |
|---------|-------|-----------|
| **IP-Adapter Weight** | 0.5-0.6 | Maintains identity without overriding pose |
| **ControlNet Weight** | 0.4-0.5 | Guides pose without rigidity |
| **Start Control Step** | 0.0 | Apply from beginning for structure |
| **End Control Step** | 0.5-0.7 | Allow model creativity in later steps |

### Weight Interaction with ControlNet

When combining IP-Adapter with ControlNet OpenPose:

```
Total Influence = IP-Adapter (appearance) + ControlNet (structure) + Text (details)
```

**Recommended Balance:**
- IP-Adapter: 0.5 (appearance/colors/features)
- ControlNet: 0.4 (pose/structure)
- Text: 1.0 (always full weight for style guidance)

**Warning:** Combined weights > 1.5 can cause artifacts and over-conditioning.

### Frame-to-Frame Variation

For animation frames, slight variation is desirable for natural motion:

| Frame Type | IP-Adapter Weight |
|------------|-------------------|
| Keyframes (0, 4) | 0.6 (stronger lock) |
| In-betweens (1, 2, 3, 5, 6, 7) | 0.5 (allow variation) |

---

## 6. Reference Image Strategy

### Canonical Reference Image Approach

**Strategy:** Generate one high-quality reference image per character class/type, then use it to condition all 8 animation frames.

```
Reference Image (1024x1024)
        |
        +---> Frame 0 (idle 1)
        +---> Frame 1 (idle 2)
        +---> Frame 2 (idle 3)
        +---> ...
        +---> Frame 7 (walk 4)
```

### Reference Image Requirements

| Aspect | Requirement | Rationale |
|--------|-------------|-----------|
| **Resolution** | 512x512 or 1024x1024 | CLIP encoder accepts any size |
| **Pose** | Neutral/front-facing | Provides clearest identity features |
| **Background** | Plain/transparent | Prevents background bleeding |
| **Cropping** | Character only | Focus on relevant features |
| **Quality** | High-detail original | Better feature extraction |

### Generating Reference Images

**Option 1: Use existing originals**
```python
# Use the 1024x1024 original from first successful generation
reference_path = f"assets/characters/originals/{class}_reference.png"
```

**Option 2: Generate dedicated reference**
```python
# Generate a neutral T-pose or front-facing reference
prompt = f"{trigger}, {class} character, neutral pose, front facing, full body visible, plain background"
```

### Image Preprocessing for IP-Adapter

IP-Adapter's CLIP encoder works best with:

1. **Square aspect ratio** (1:1)
2. **Centered subject**
3. **No text/watermarks**
4. **Consistent lighting**

```python
def prepare_reference(image_path):
    img = Image.open(image_path)
    # Ensure square
    if img.width != img.height:
        size = max(img.width, img.height)
        img = ImageOps.pad(img, (size, size), color=(0, 0, 0, 0))
    # Resize to 512x512 for efficiency
    img = img.resize((512, 512), Image.LANCZOS)
    return img
```

### Face vs. Full-Body Reference

| Reference Type | IP-Adapter Variant | Best For |
|----------------|-------------------|----------|
| **Face only** | ip-adapter-plus-face | Portrait consistency |
| **Full body** | ip-adapter-plus | Character sprite consistency |
| **Face + Body** | ip-adapter-plus-face + ip-adapter-plus (dual) | Maximum consistency |

**Recommendation for 64x64 sprites:** Use `ip-adapter-plus` (full body) since facial details are minimal at output resolution.

---

## 7. ComfyUI Integration Approach

### Required Custom Nodes

| Node Pack | Purpose | Repository |
|-----------|---------|------------|
| **ComfyUI_IPAdapter_plus** | IP-Adapter integration | [cubiq/ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) |
| **ComfyUI-GGUF** | GGUF model loading | Already installed |
| **comfyui_controlnet_aux** | ControlNet preprocessors | Optional, for pose extraction |

### Model Downloads Required

```bash
# IP-Adapter models (HuggingFace)
cd ComfyUI/models/ipadapter/
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus-face_sd15.safetensors
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.safetensors

# CLIP image encoder
cd ComfyUI/models/clip_vision/
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors
# Rename to: CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
```

### ComfyUI Workflow Structure

```
[Load Reference Image]
        |
        v
[IPAdapter Loader] -- CLIP Model --> [CLIP Vision Encode]
        |                                    |
        v                                    v
[IPAdapter Apply] <----- image embeds ------+
        |
        v
[KSampler] <-- [Load Checkpoint SD1.5]
        |
        v
[VAE Decode]
        |
        v
[Save Image]
```

### Key Node Parameters

**IPAdapter Loader:**
```json
{
  "ipadapter_file": "ip-adapter-plus-face_sd15.safetensors",
  "model": "SD15 checkpoint",
  "weight": 0.6,
  "noise": 0.0,
  "start_at": 0.0,
  "end_at": 1.0
}
```

**IPAdapter Apply:**
```json
{
  "weight": 0.5,
  "weight_type": "linear",
  "combine_embeds": "concat",
  "start_at": 0.0,
  "end_at": 0.7
}
```

### Workflow with ControlNet

```
[Load Reference Image]           [Load Pose Skeleton]
        |                                |
        v                                v
[CLIP Vision Encode]            [ControlNet Apply]
        |                                |
        v                                v
[IPAdapter Apply] -------> [Model] <--- [ControlNet]
                              |
                              v
                         [KSampler]
                              |
                              v
                         [Output]
```

### Inference Speed Impact

| Configuration | Time per Frame (512x512) | Time per Frame (768x768) |
|---------------|--------------------------|--------------------------|
| SD1.5 only | 2-3s | 4-6s |
| SD1.5 + IP-Adapter | 3-4s | 5-8s |
| SD1.5 + IP-Adapter + ControlNet | 4-6s | 7-10s |

**8-frame animation total time:** 32-80 seconds (depending on configuration)

---

## 8. LoRA Interaction Analysis

### Current LoRA Models

| Model | Trigger | Architecture | IP-Adapter Compatible? |
|-------|---------|--------------|------------------------|
| V1 (GRPZA) | GRPZA | Flux | NO (Flux-based) |
| V2 (wbgmsst) | wbgmsst | Flux | NO (Flux-based) |
| Modern Pixel | umempart | Flux | NO (Flux-based) |
| Retro Pixel | Retro Pixel | Flux | NO (Flux-based) |

### Critical Compatibility Issue

The current LoRA models are trained for **Flux**, not Stable Diffusion. Using IP-Adapter would require:

1. **Switching to SD1.5/SDXL base model**
2. **Finding/training compatible pixel art LoRAs for SD1.5**
3. **Accepting different visual style output**

### SD1.5 Pixel Art LoRA Options

If switching to SD1.5 for IP-Adapter compatibility:

| LoRA | Style | Civitai Link |
|------|-------|--------------|
| Pixel Art XL | General pixel art | civitai.com/models/120096 |
| 16-bit Pixel Art | Retro SNES style | civitai.com/models/28896 |
| Aseprite Pixel Art | Tool-specific style | civitai.com/models/35790 |

### LoRA + IP-Adapter Weight Balance

When using both LoRA and IP-Adapter:

| Component | Recommended Weight | Notes |
|-----------|-------------------|-------|
| LoRA | 0.7-0.9 | Primary style control |
| IP-Adapter | 0.4-0.5 | Lower to prevent overriding LoRA |

**Warning:** High IP-Adapter weights (>0.7) can override LoRA style entirely.

---

## 9. Alternative Approaches for Flux

Since IP-Adapter is not compatible with Flux, here are viable alternatives:

### 9.1 Flux Redux (Image-to-Image)

**How it works:** Uses a reference image to condition generation through latent space encoding.

```python
# Flux Redux workflow
reference_latent = encode_image(reference_image)
noise_latent = add_noise(reference_latent, strength=0.5)
output = denoise(noise_latent, prompt, steps)
```

**Pros:**
- Native Flux support
- Works with current GGUF models
- Maintains consistency through latent space

**Cons:**
- Less precise identity preservation than IP-Adapter
- Requires careful strength tuning
- May alter colors/style

**Settings:**
- Denoise strength: 0.4-0.6 (lower = more similar to reference)
- CFG scale: 3.5 (standard for Flux Schnell)

### 9.2 ControlNet for Flux

**Current state:** Experimental Flux ControlNet models exist but have limited 8GB VRAM support.

**Available models:**
- Flux ControlNet Canny (edge detection)
- Flux ControlNet Depth
- No official OpenPose for Flux yet

**Verdict:** Not recommended until Flux ControlNet matures.

### 9.3 Seed Consistency + Prompt Engineering

**Approach:** Use deterministic seeding with precise prompts.

```python
# Same seed + nearly identical prompt = similar output
base_prompt = "{trigger}, pixel art {class} character, {color_palette}, {distinguishing_features}"
frame_prompts = [
    f"{base_prompt}, idle pose frame 1",
    f"{base_prompt}, idle pose frame 2",
    # ...
]
```

**Enhancement:** Include character-specific descriptors:
- Color palette (e.g., "blue robes, gold trim")
- Distinguishing features (e.g., "pointed ears, long white hair")
- Equipment description (e.g., "wooden staff, leather belt")

### 9.4 Hybrid Pipeline: SD1.5 for Frames, Flux for Reference

**Workflow:**
1. Generate high-quality reference with Flux + V1 LoRA
2. Switch to SD1.5 + IP-Adapter for animation frames
3. Use reference to condition SD1.5 generation
4. Post-process to match Flux style

**Pros:**
- Gets IP-Adapter benefits
- Leverages Flux quality for reference

**Cons:**
- Style mismatch between reference and frames
- More complex pipeline
- May require style transfer post-processing

---

## 10. Recommendations

### Primary Recommendation: Flux Redux + ControlNet (Future)

**Rationale:** Stay within Flux ecosystem, avoid model switching.

**Current Status:** Wait for:
- Mature Flux ControlNet OpenPose
- Better Flux image conditioning methods
- Official Flux IP-Adapter equivalent

**Timeline:** 3-6 months based on community development pace.

### Secondary Recommendation: SD1.5 + IP-Adapter Pipeline

If immediate character consistency is critical:

**Implementation:**
1. Install ComfyUI_IPAdapter_plus
2. Download SD1.5 checkpoint (fp16, 2GB)
3. Download ip-adapter-plus_sd15 (196MB)
4. Download CLIP ViT-H encoder (1.8GB)
5. Find/test SD1.5 pixel art LoRA
6. Create reference images for each character class
7. Build ComfyUI workflow with IP-Adapter + ControlNet

**VRAM Budget:**
```
SD1.5 fp16:     2.5GB
CLIP ViT-H:     1.8GB
IP-Adapter:     0.2GB
ControlNet:     0.7GB
Overhead:       1.5GB
--------------------
Total:          6.7GB (fits in 8GB)
```

**Quality Trade-off:** SD1.5 output quality is lower than Flux. May need upscaling.

### Tertiary Recommendation: Enhanced Prompt Consistency

**If changing models is not acceptable:**

1. **Define character templates:**
```json
{
  "warrior": {
    "colors": "steel gray armor, red cape, brown leather",
    "features": "strong jaw, short brown hair, determined expression",
    "equipment": "broadsword, round shield, iron helmet"
  }
}
```

2. **Include template in every frame prompt:**
```python
prompt = f"{trigger}, pixel art {class} character, {template[class].colors}, {template[class].features}, {template[class].equipment}, {pose_description}"
```

3. **Use consistent seed base:**
```python
frame_seed = base_character_seed + frame_index
```

### Implementation Priority

| Priority | Approach | Effort | Impact |
|----------|----------|--------|--------|
| 1 | Enhanced prompt templates | Low | Medium |
| 2 | Flux Redux (img2img) | Medium | Medium |
| 3 | SD1.5 + IP-Adapter | High | High |
| 4 | Wait for Flux IP-Adapter | None | Unknown |

---

## 11. Sources

### Official Documentation

- [IP-Adapter Paper (arXiv)](https://arxiv.org/abs/2308.06721)
- [IP-Adapter GitHub (Tencent)](https://github.com/tencent-ailab/IP-Adapter)
- [ComfyUI_IPAdapter_plus (cubiq)](https://github.com/cubiq/ComfyUI_IPAdapter_plus)
- [HuggingFace IP-Adapter Models](https://huggingface.co/h94/IP-Adapter)

### VRAM Benchmarks

- [SD1.5 Memory Usage Analysis](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/Optimizations)
- [IP-Adapter VRAM Testing (Reddit)](https://www.reddit.com/r/StableDiffusion/comments/15z9j0a/ipadapter_vram_usage/)
- [ComfyUI Memory Optimization Guide](https://comfyui-wiki.com/en/optimizations)

### Flux Architecture

- [Flux.1 Model Card (Black Forest Labs)](https://huggingface.co/black-forest-labs/FLUX.1-dev)
- [Flux Architecture Overview](https://blog.fal.ai/flux-the-largest-open-sourced-text2img-model-now-available-on-fal/)

### Community Resources

- [IP-Adapter Settings Guide (Civitai)](https://civitai.com/articles/1919/ip-adapter-settings-guide)
- [IP-Adapter + ControlNet Tutorial](https://stable-diffusion-art.com/ip-adapter/)
- [8GB VRAM Optimization Tips](https://github.com/comfyanonymous/ComfyUI/issues/1281)

---

## Appendix A: Model Download Commands

```bash
# Create directories
mkdir -p ComfyUI/models/ipadapter
mkdir -p ComfyUI/models/clip_vision

# IP-Adapter models (SD1.5)
cd ComfyUI/models/ipadapter
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter_sd15.safetensors
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.safetensors
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus-face_sd15.safetensors

# CLIP Vision encoder
cd ComfyUI/models/clip_vision
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors \
  -O CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors

# SD1.5 base model (if switching from Flux)
cd ComfyUI/models/checkpoints
wget https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors

# ControlNet OpenPose
cd ComfyUI/models/controlnet
wget https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth
```

---

## Appendix B: VRAM Monitoring Commands

```bash
# Real-time VRAM monitoring
watch -n 1 nvidia-smi

# Detailed memory breakdown
nvidia-smi --query-gpu=memory.used,memory.free,memory.total --format=csv

# ComfyUI memory stats (in Python)
import torch
print(f"Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")
print(f"Cached: {torch.cuda.memory_reserved() / 1e9:.2f} GB")
```

---

## Appendix C: ComfyUI Workflow JSON Skeleton

```json
{
  "nodes": [
    {
      "id": 1,
      "type": "CheckpointLoaderSimple",
      "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" }
    },
    {
      "id": 2,
      "type": "IPAdapterModelLoader",
      "inputs": { "ipadapter_file": "ip-adapter-plus_sd15.safetensors" }
    },
    {
      "id": 3,
      "type": "CLIPVisionLoader",
      "inputs": { "clip_name": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" }
    },
    {
      "id": 4,
      "type": "LoadImage",
      "inputs": { "image": "reference_character.png" }
    },
    {
      "id": 5,
      "type": "IPAdapterApply",
      "inputs": {
        "model": ["1", 0],
        "ipadapter": ["2", 0],
        "clip_vision": ["3", 0],
        "image": ["4", 0],
        "weight": 0.5,
        "start_at": 0.0,
        "end_at": 0.7
      }
    },
    {
      "id": 6,
      "type": "KSampler",
      "inputs": {
        "model": ["5", 0],
        "seed": 12345,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler",
        "scheduler": "normal"
      }
    }
  ]
}
```

---

*Report generated: 2026-01-30*
*Next review: After Flux ControlNet maturity or if immediate consistency required*
