# ControlNet Pose Template System Research

> **Date:** 2026-01-30
> **Status:** Research Complete
> **Hardware Constraint:** 8GB VRAM (RTX 3070/4070)
> **Related:** [ANIMATION_GENERATION_RESEARCH.md](./ANIMATION_GENERATION_RESEARCH.md)

## Executive Summary

This document provides detailed research on implementing pose-guided character animation generation using ControlNet OpenPose. The research covers the OpenPose skeleton format, tools for creating skeleton templates, design specifications for 48 animation poses, and ComfyUI integration approaches compatible with 8GB VRAM constraints.

**Key Findings:**

1. OpenPose uses an 18-keypoint body model with standardized color conventions
2. Skeleton templates should be created at 512x512 or 768x768 resolution
3. ControlNet weight of 0.4-0.6 provides optimal balance between pose accuracy and creative freedom
4. Estimated VRAM for SD1.5 + ControlNet OpenPose: 5-6GB (viable for 8GB constraint)
5. Adding IP-Adapter for character consistency increases to 7-8GB (still viable)

---

## Table of Contents

1. [OpenPose Skeleton Format Specification](#1-openpose-skeleton-format-specification)
2. [Skeleton Creation Tools](#2-skeleton-creation-tools)
3. [48 Skeleton Template Designs](#3-48-skeleton-template-designs)
4. [ComfyUI Integration Approach](#4-comfyui-integration-approach)
5. [VRAM Estimates and Optimization](#5-vram-estimates-and-optimization)
6. [Recommended Settings and Workflow](#6-recommended-settings-and-workflow)
7. [Implementation Checklist](#7-implementation-checklist)

---

## 1. OpenPose Skeleton Format Specification

### 1.1 Keypoint Structure

OpenPose defines an 18-point body model (BODY_25 variant uses 25 points, but 18 is most common for ControlNet):

| Index | Keypoint | Parent Connection |
|-------|----------|-------------------|
| 0 | Nose | 1 (Neck) |
| 1 | Neck | - (root for upper body) |
| 2 | Right Shoulder | 1 (Neck) |
| 3 | Right Elbow | 2 (R Shoulder) |
| 4 | Right Wrist | 3 (R Elbow) |
| 5 | Left Shoulder | 1 (Neck) |
| 6 | Left Elbow | 5 (L Shoulder) |
| 7 | Left Wrist | 6 (L Elbow) |
| 8 | Right Hip | 1 (Neck) or 11 (L Hip) |
| 9 | Right Knee | 8 (R Hip) |
| 10 | Right Ankle | 9 (R Knee) |
| 11 | Left Hip | 1 (Neck) or 8 (R Hip) |
| 12 | Left Knee | 11 (L Hip) |
| 13 | Left Ankle | 12 (L Knee) |
| 14 | Right Eye | 0 (Nose) |
| 15 | Left Eye | 0 (Nose) |
| 16 | Right Ear | 14 (R Eye) |
| 17 | Left Ear | 15 (L Eye) |

### 1.2 Skeleton Connection Graph

```
                    [Nose 0]
                       |
              [R Eye 14]   [L Eye 15]
                 |             |
              [R Ear 16]   [L Ear 17]
                       |
                   [Neck 1]
                  /   |   \
       [R Shoulder 2] | [L Shoulder 5]
            |         |         |
       [R Elbow 3]    |    [L Elbow 6]
            |         |         |
       [R Wrist 4]    |    [L Wrist 7]
                      |
              [R Hip 8]---[L Hip 11]
                 |             |
              [R Knee 9]  [L Knee 12]
                 |             |
             [R Ankle 10] [L Ankle 13]
```

### 1.3 Color Conventions

OpenPose uses specific colors for different body parts to aid ControlNet interpretation:

| Body Region | Limb Connections | RGB Color | Hex Code |
|-------------|------------------|-----------|----------|
| **Face/Head** | Nose-Eyes, Eyes-Ears | Yellow | `#FFFF00` |
| **Neck** | Neck-Nose | White | `#FFFFFF` |
| **Right Arm** | Shoulder-Elbow-Wrist | Blue gradient | `#0000FF` to `#00BFFF` |
| **Left Arm** | Shoulder-Elbow-Wrist | Green gradient | `#00FF00` to `#7FFF00` |
| **Torso** | Neck-Hips, Hip-Hip | Red/Orange | `#FF0000` to `#FF7F00` |
| **Right Leg** | Hip-Knee-Ankle | Purple/Magenta | `#FF00FF` to `#BF00FF` |
| **Left Leg** | Hip-Knee-Ankle | Cyan/Teal | `#00FFFF` to `#00BFBF` |

**Standard OpenPose Color Palette:**

```python
# OpenPose standard limb colors (RGB)
OPENPOSE_COLORS = {
    # Right arm (warm colors)
    'neck_rshoulder': (255, 0, 0),      # Red
    'rshoulder_relbow': (255, 85, 0),   # Orange-Red
    'relbow_rwrist': (255, 170, 0),     # Orange

    # Left arm (cool blue)
    'neck_lshoulder': (0, 255, 0),      # Green
    'lshoulder_lelbow': (85, 255, 0),   # Yellow-Green
    'lelbow_lwrist': (170, 255, 0),     # Lime

    # Torso
    'neck_rhip': (255, 0, 0),           # Red
    'neck_lhip': (0, 255, 0),           # Green
    'rhip_lhip': (255, 255, 0),         # Yellow

    # Right leg (warm colors)
    'rhip_rknee': (255, 0, 85),         # Pink-Red
    'rknee_rankle': (255, 0, 170),      # Magenta

    # Left leg (cool colors)
    'lhip_lknee': (0, 255, 85),         # Cyan-Green
    'lknee_lankle': (0, 255, 170),      # Teal

    # Face
    'nose_neck': (255, 255, 255),       # White
    'nose_reye': (255, 255, 0),         # Yellow
    'nose_leye': (255, 255, 0),         # Yellow
    'reye_rear': (255, 170, 255),       # Light Pink
    'leye_lear': (170, 255, 255),       # Light Cyan
}
```

### 1.4 Image Format Requirements

| Property | Specification |
|----------|---------------|
| **File Format** | PNG (transparency optional, black background standard) |
| **Resolution** | 512x512 (SD1.5 optimal) or 768x768 (higher quality) |
| **Background** | Solid black (`#000000`) |
| **Line Width** | 4-8 pixels at 512x512 resolution |
| **Keypoint Circles** | 8-12 pixel diameter |
| **Color Depth** | RGB (24-bit) |
| **Aspect Ratio** | 1:1 (square) for sprites |

### 1.5 Coordinate System

- **Origin:** Top-left corner (0, 0)
- **X-axis:** Left to right (0 to width)
- **Y-axis:** Top to bottom (0 to height)
- **Normalized Coordinates:** Sometimes expressed as 0.0-1.0 (multiply by image dimension)

**Example Keypoint JSON Format:**
```json
{
  "version": 1.0,
  "people": [{
    "pose_keypoints_2d": [
      256, 100, 0.95,   // Nose: x, y, confidence
      256, 150, 0.98,   // Neck: x, y, confidence
      200, 180, 0.92,   // R Shoulder
      160, 250, 0.88,   // R Elbow
      140, 320, 0.85,   // R Wrist
      // ... 18 keypoints total (54 values)
    ]
  }]
}
```

### 1.6 ControlNet Interpretation

ControlNet OpenPose interprets skeleton images through:

1. **Edge Detection:** Identifies colored lines as limb connections
2. **Color Mapping:** Uses color to determine which body part each line represents
3. **Spatial Relationship:** Infers 3D pose from 2D skeleton projection
4. **Confidence Weighting:** Clearer, thicker lines = higher confidence

**Critical for Sprite Animation:**
- Skeletons should face forward (frontal view) or 3/4 view
- Proportions should match target character proportions
- Consistent skeleton scale across all frames

---

## 2. Skeleton Creation Tools

### 2.1 OpenPose Editor (Web-Based)

**URL:** [github.com/huchenlei/sd-webui-openpose-editor](https://github.com/huchenlei/sd-webui-openpose-editor)

**Features:**
- Visual drag-and-drop skeleton editing
- Real-time preview
- Export to PNG
- Multiple skeleton support (for multi-character scenes)
- Undo/redo functionality

**Usage Workflow:**
1. Open editor in browser
2. Position keypoints by dragging
3. Adjust limb lengths proportionally
4. Export as 512x512 PNG
5. Import into ComfyUI ControlNet

**Pros:**
- No installation required
- Intuitive interface
- Precise keypoint control

**Cons:**
- Manual positioning for each frame
- No animation preview
- No interpolation between poses

### 2.2 ControlNet Preprocessor in ComfyUI

**Node:** `ControlNetPreprocessor` (from ComfyUI-Advanced-ControlNet)

**Features:**
- Extract OpenPose from reference images
- Multiple detector options (OpenPose, DWPose, Animal Pose)
- Resolution control

**Usage for Template Creation:**
1. Find reference images of desired poses (photos, illustrations)
2. Run OpenPose preprocessor
3. Save extracted skeleton
4. Use as ControlNet input for generation

**Pros:**
- Automatic extraction from references
- Consistent with ControlNet expectations

**Cons:**
- Requires good reference images
- May need manual cleanup

### 2.3 Blender for OpenPose-Compatible Skeletons

**Approach:** Use Blender's armature system to create pose sequences, then export compatible skeleton images.

**Workflow:**
1. Create simple humanoid armature in Blender
2. Map Blender bones to OpenPose keypoints:

| Blender Bone | OpenPose Keypoint |
|--------------|-------------------|
| `head` | Nose (0) |
| `neck` | Neck (1) |
| `shoulder.R` | Right Shoulder (2) |
| `upper_arm.R` | (connection 2-3) |
| `forearm.R` | Right Elbow (3) |
| `hand.R` | Right Wrist (4) |
| ... | ... |

3. Create 8-frame animation for each sequence
4. Render orthographic front view with skeleton overlay
5. Export PNG sequence

**Python Script for Blender Export:**
```python
import bpy
import json

# OpenPose bone mapping
BONE_TO_KEYPOINT = {
    'head': 0,
    'neck': 1,
    'shoulder.R': 2,
    'elbow.R': 3,
    'wrist.R': 4,
    'shoulder.L': 5,
    'elbow.L': 6,
    'wrist.L': 7,
    'hip.R': 8,
    'knee.R': 9,
    'ankle.R': 10,
    'hip.L': 11,
    'knee.L': 12,
    'ankle.L': 13,
}

def export_skeleton_frame(armature, frame, output_path):
    """Export armature pose as OpenPose skeleton image."""
    bpy.context.scene.frame_set(frame)
    keypoints = []

    for bone_name, kp_index in BONE_TO_KEYPOINT.items():
        bone = armature.pose.bones.get(bone_name)
        if bone:
            # Get world position and project to 2D
            world_pos = armature.matrix_world @ bone.head
            # Normalize to 0-512 range
            x = int((world_pos.x + 1) * 256)
            y = int((1 - world_pos.z) * 512)  # Flip Y for image coords
            keypoints.append((x, y, 1.0))

    # Draw skeleton to image
    draw_skeleton_image(keypoints, output_path)
```

**Pros:**
- Full animation control
- Reusable across projects
- Professional toolset

**Cons:**
- Requires Blender knowledge
- Setup time investment
- Export pipeline complexity

### 2.4 Manual Drawing in Image Editor

**Recommended Tools:**
- GIMP (free, layer support)
- Krita (free, animation support)
- Photoshop (paid)
- Aseprite (pixel art focused)

**Template Setup:**
1. Create 512x512 canvas with black background
2. Add keypoint guide layer (circles at each position)
3. Add limb connection layer (colored lines)
4. Save as PNG

**Color Palette for Manual Drawing:**
```
Right Arm: #FF0000 (Red) -> #FF5500 (Orange)
Left Arm:  #00FF00 (Green) -> #88FF00 (Lime)
Torso:     #FFFF00 (Yellow)
Right Leg: #FF00FF (Magenta) -> #FF0088 (Pink)
Left Leg:  #00FFFF (Cyan) -> #00FF88 (Teal)
Head:      #FFFFFF (White)
```

### 2.5 Existing Pose Collections

**Civitai Resources:**
- [OpenPose Pose Collection](https://civitai.com/models/125058) - Common poses
- [Action Pose Pack](https://civitai.com/models/98127) - Combat poses
- [Animation Reference Poses](https://civitai.com/models/145623) - Walk/run cycles

**HuggingFace:**
- [pose-estimation-datasets](https://huggingface.co/datasets/ntkhoi/pose-estimation) - Large pose dataset
- [openpose-editor](https://huggingface.co/spaces/huchenlei/openpose-editor) - Interactive editor

**GitHub:**
- [controlnet-openpose](https://github.com/lllyasviel/ControlNet/tree/main/training) - Training data
- [pose-templates](https://github.com/madebyollin/pose-templates) - Pre-made templates

### 2.6 Tool Comparison Matrix

| Tool | Ease of Use | Precision | Animation Support | Export Quality | Learning Curve |
|------|-------------|-----------|-------------------|----------------|----------------|
| **OpenPose Editor** | High | High | None | Excellent | Low |
| **Blender** | Low | Excellent | Full | Excellent | High |
| **GIMP/Krita** | Medium | Medium | Limited | Good | Medium |
| **Reference + Preprocessor** | High | Variable | None | Good | Low |
| **Pre-made Packs** | Highest | N/A | Limited | Variable | None |

**Recommendation:** Use OpenPose Editor for initial template creation, with Blender for complex animations if higher precision is needed.

---

## 3. 48 Skeleton Template Designs

### 3.1 Design Principles for 64x64 Sprites

Since our target output is 64x64 pixel sprites:

1. **Exaggerated Proportions:** Larger head-to-body ratio for readability
2. **Clear Silhouettes:** Limbs should not overlap extensively
3. **Limited Detail:** Focus on major joints, skip fingers/toes
4. **Frontal/3/4 View:** Avoid profile views (limbs occlude)

**Standard Sprite Proportions:**
- Head: ~20% of height
- Torso: ~30% of height
- Legs: ~50% of height
- Arms: Extended to hip level at rest

**Skeleton Canvas Layout (512x512 target):**
```
+----------------------------------+
|                                  |
|         [Head Region]            |  Y: 50-120
|              0                   |
|                                  |
|         [Neck/Shoulders]         |  Y: 120-170
|        5   1   2                 |
|                                  |
|         [Torso Region]           |  Y: 170-280
|                                  |
|         [Hip Region]             |  Y: 280-320
|        11     8                  |
|                                  |
|         [Legs Region]            |  Y: 320-480
|        12     9                  |
|        13     10                 |
|                                  |
+----------------------------------+
```

### 3.2 Idle Animation (8 Frames)

Subtle breathing and weight shifts - minimal movement for looping.

**Frame 0: Neutral Standing**
```
Keypoints (normalized 0-1):
  Nose:      (0.50, 0.15)
  Neck:      (0.50, 0.25)
  R_Shoulder: (0.35, 0.28)
  R_Elbow:   (0.30, 0.42)
  R_Wrist:   (0.32, 0.55)
  L_Shoulder: (0.65, 0.28)
  L_Elbow:   (0.70, 0.42)
  L_Wrist:   (0.68, 0.55)
  R_Hip:     (0.42, 0.52)
  R_Knee:    (0.42, 0.72)
  R_Ankle:   (0.42, 0.92)
  L_Hip:     (0.58, 0.52)
  L_Knee:    (0.58, 0.72)
  L_Ankle:   (0.58, 0.92)

Description: Weight centered, arms relaxed at sides, neutral stance
```

**Frame 1: Weight Shift Left**
```
Keypoints delta from Frame 0:
  Nose:      (-0.01, 0)
  Neck:      (-0.01, 0)
  R_Hip:     (-0.01, 0)
  L_Hip:     (-0.01, 0)
  R_Ankle:   (0, 0)      # Planted
  L_Ankle:   (-0.02, 0)  # Slight lift

Description: Subtle weight shift to left foot, head tilts slightly
```

**Frame 2: Breath In (Chest Rise)**
```
Keypoints delta from Frame 0:
  Neck:      (0, -0.01)
  R_Shoulder: (0, -0.01)
  L_Shoulder: (0, -0.01)
  R_Elbow:   (0, -0.01)
  L_Elbow:   (0, -0.01)

Description: Chest rises slightly with breath intake
```

**Frame 3: Weight Shift Right**
```
Keypoints delta from Frame 0:
  Nose:      (+0.01, 0)
  Neck:      (+0.01, 0)
  R_Hip:     (+0.01, 0)
  L_Hip:     (+0.01, 0)
  L_Ankle:   (0, 0)      # Planted
  R_Ankle:   (+0.02, 0)  # Slight lift

Description: Subtle weight shift to right foot
```

**Frame 4: Return to Neutral**
```
Keypoints: Same as Frame 0

Description: Return to centered neutral pose
```

**Frame 5: Right Arm Adjust**
```
Keypoints delta from Frame 0:
  R_Elbow:   (+0.02, 0)
  R_Wrist:   (+0.03, +0.02)

Description: Slight right arm movement, natural fidget
```

**Frame 6: Breath Out (Chest Lower)**
```
Keypoints delta from Frame 0:
  Neck:      (0, +0.01)
  R_Shoulder: (0, +0.01)
  L_Shoulder: (0, +0.01)

Description: Chest lowers with exhale
```

**Frame 7: Left Arm Adjust**
```
Keypoints delta from Frame 0:
  L_Elbow:   (-0.02, 0)
  L_Wrist:   (-0.03, +0.02)

Description: Slight left arm movement, return to idle
```

### 3.3 Walk Animation (8 Frames)

Standard walk cycle with contact, passing, and push-off phases.

**Frame 0: Contact (Left Foot Forward)**
```
Keypoints:
  Nose:      (0.50, 0.15)
  Neck:      (0.50, 0.25)
  R_Shoulder: (0.38, 0.28)   # Rotated back
  R_Elbow:   (0.42, 0.40)
  R_Wrist:   (0.48, 0.50)    # Arm forward
  L_Shoulder: (0.62, 0.28)   # Rotated forward
  L_Elbow:   (0.58, 0.40)
  L_Wrist:   (0.52, 0.50)    # Arm back
  R_Hip:     (0.44, 0.52)
  R_Knee:    (0.50, 0.70)    # Back leg bent
  R_Ankle:   (0.55, 0.90)    # Toe on ground
  L_Hip:     (0.56, 0.52)
  L_Knee:    (0.48, 0.72)    # Front leg extended
  L_Ankle:   (0.40, 0.92)    # Heel touching

Description: Left heel makes contact, right leg pushing off behind
```

**Frame 1: Down (Left)**
```
Keypoints delta from Frame 0:
  Body shifts forward
  L_Knee:    (0, +0.02)     # Absorbs weight
  R_Ankle:   (+0.02, 0)     # Lifts off

Description: Weight transfers to left foot, body dips slightly
```

**Frame 2: Passing (Right)**
```
Keypoints:
  R_Knee:    (0.46, 0.68)   # Passing position
  R_Ankle:   (0.46, 0.82)   # Lifted
  L_Knee:    (0.50, 0.70)   # Supporting

Description: Right foot passes left, body centered
```

**Frame 3: High Point (Right Forward)**
```
Keypoints:
  R_Knee:    (0.38, 0.68)   # Extended forward
  R_Ankle:   (0.32, 0.78)   # High in air
  L_Knee:    (0.52, 0.72)   # Straight supporting
  Arms swap positions from Frame 0

Description: Right leg at peak forward extension
```

**Frame 4: Contact (Right Foot Forward)**
```
Mirror of Frame 0 with left/right swapped

Description: Right heel makes contact, left leg pushing off
```

**Frame 5: Down (Right)**
```
Mirror of Frame 1 with left/right swapped

Description: Weight transfers to right foot
```

**Frame 6: Passing (Left)**
```
Mirror of Frame 2 with left/right swapped

Description: Left foot passes right
```

**Frame 7: High Point (Left Forward)**
```
Mirror of Frame 3 with left/right swapped

Description: Left leg at peak forward extension
```

### 3.4 Attack Animation (8 Frames)

Sword/melee attack with wind-up and follow-through.

**Frame 0: Ready Stance**
```
Keypoints:
  Slightly wider stance than idle
  R_Wrist:   (0.25, 0.50)   # Weapon hand at hip
  L_Wrist:   (0.70, 0.45)   # Off-hand forward

Description: Alert stance, weapon at ready position
```

**Frame 1: Wind-Up**
```
Keypoints:
  Body rotates right
  R_Shoulder: (0.30, 0.28)  # Pulled back
  R_Elbow:   (0.18, 0.35)   # Raised
  R_Wrist:   (0.15, 0.25)   # Weapon raised high
  R_Hip:     (0.40, 0.52)   # Hip rotation

Description: Weapon pulled back, body coiled for strike
```

**Frame 2: Peak Wind-Up**
```
Keypoints:
  R_Elbow:   (0.12, 0.28)   # Maximum raise
  R_Wrist:   (0.10, 0.18)   # Weapon at apex
  Body leaned back slightly

Description: Maximum extension, ready to swing
```

**Frame 3: Swing Begin**
```
Keypoints:
  R_Elbow:   (0.22, 0.32)   # Accelerating down
  R_Wrist:   (0.28, 0.35)   # Weapon descending
  Body rotating forward

Description: Swing initiated, power transfer begins
```

**Frame 4: Impact**
```
Keypoints:
  R_Elbow:   (0.50, 0.42)   # Extended
  R_Wrist:   (0.65, 0.48)   # Weapon at impact point
  Body fully rotated forward
  Weight shifted to front foot

Description: Point of impact, maximum extension forward
```

**Frame 5: Follow-Through**
```
Keypoints:
  R_Elbow:   (0.65, 0.50)   # Continued motion
  R_Wrist:   (0.78, 0.58)   # Past impact
  Body momentum continues

Description: Weapon continues past impact point
```

**Frame 6: Recovery**
```
Keypoints:
  Body slowing rotation
  R_Wrist returning toward center
  Weight rebalancing

Description: Decelerating, beginning return to ready
```

**Frame 7: Return to Ready**
```
Keypoints: Same as Frame 0

Description: Back to ready stance, cycle complete
```

### 3.5 Hurt Animation (8 Frames)

Reaction to taking damage with recoil and recovery.

**Frame 0: Initial Impact**
```
Keypoints:
  Nose:      (0.48, 0.16)   # Head jerks
  Neck:      (0.48, 0.26)   # Neck bends
  Body compresses slightly

Description: Moment of impact, sudden jerk
```

**Frame 1: Recoil**
```
Keypoints:
  Nose:      (0.45, 0.18)   # Head thrown back
  Neck:      (0.46, 0.28)
  R_Shoulder: (0.38, 0.32)  # Shoulders up
  L_Shoulder: (0.68, 0.32)
  Knees bend

Description: Body recoils from impact
```

**Frame 2: Pain Expression**
```
Keypoints:
  Body hunched forward
  Arms draw in protectively
  R_Wrist, L_Wrist near torso

Description: Defensive posture, hands to body
```

**Frame 3: Stumble**
```
Keypoints:
  L_Ankle:   (0.62, 0.92)   # Step back
  Body weight shifting back
  Arms out for balance

Description: Stumbling step backward
```

**Frame 4: Recovering Balance**
```
Keypoints:
  Weight centering
  Arms adjusting for balance

Description: Catching balance, stabilizing
```

**Frame 5: Hand to Wound**
```
Keypoints:
  R_Wrist:   (0.45, 0.45)   # Hand on chest/stomach
  L_Wrist remains for balance

Description: Acknowledging damage, hand to hurt area
```

**Frame 6: Straightening**
```
Keypoints:
  Body returning to upright
  Arms lowering

Description: Beginning to stand straight again
```

**Frame 7: Ready Return**
```
Keypoints: Approaching idle stance

Description: Return to combat ready stance
```

### 3.6 Death Animation (8 Frames)

Collapse sequence from fatal hit to lying still.

**Frame 0: Fatal Hit**
```
Keypoints:
  Nose:      (0.50, 0.14)   # Head snaps
  Arms fly out

Description: Moment of fatal impact, violent reaction
```

**Frame 1: Losing Balance**
```
Keypoints:
  Body tilting backward
  Knees buckling
  Arms flailing

Description: Balance lost, beginning to fall
```

**Frame 2: Falling Backward**
```
Keypoints:
  Nose:      (0.52, 0.25)   # Lower
  Body at ~30 degree angle back
  Feet leaving ground

Description: Free fall begins
```

**Frame 3: Mid Fall**
```
Keypoints:
  Nose:      (0.55, 0.40)
  Body at ~60 degree angle
  Arms trailing

Description: Falling, midway to ground
```

**Frame 4: Hitting Ground**
```
Keypoints:
  Nose:      (0.58, 0.55)
  Back making contact with ground
  R_Hip near bottom of frame

Description: Initial ground impact
```

**Frame 5: Final Collapse**
```
Keypoints:
  Body nearly horizontal
  Arms spread
  Legs extended

Description: Body settles on ground
```

**Frame 6: Lying Still**
```
Keypoints:
  Full horizontal pose
  All limbs at rest
  Head turned slightly

Description: Final resting position
```

**Frame 7: Fade Pose**
```
Keypoints: Same as Frame 6

Description: Held pose for fade-out effect
```

### 3.7 Cast Animation (8 Frames)

Spellcasting with energy gathering and release.

**Frame 0: Preparing to Cast**
```
Keypoints:
  Feet shoulder-width apart
  Arms at sides
  Slight crouch

Description: Beginning spell preparation
```

**Frame 1: Gathering Energy (Hands)**
```
Keypoints:
  R_Wrist:   (0.40, 0.40)   # Hands rising
  L_Wrist:   (0.60, 0.40)
  Fingers spread (implied)

Description: Hands raise, gathering magical energy
```

**Frame 2: Magic Buildup**
```
Keypoints:
  R_Wrist:   (0.42, 0.32)   # Hands higher
  L_Wrist:   (0.58, 0.32)
  R_Elbow, L_Elbow raised

Description: Energy intensifying between hands
```

**Frame 3: Channeling Power**
```
Keypoints:
  R_Wrist:   (0.45, 0.28)   # Hands close together
  L_Wrist:   (0.55, 0.28)
  Body slightly back

Description: Focusing gathered energy
```

**Frame 4: Spell Release**
```
Keypoints:
  R_Wrist:   (0.30, 0.35)   # Hands thrust forward
  L_Wrist:   (0.70, 0.35)
  Arms extended

Description: Releasing spell forward
```

**Frame 5: Magic Burst**
```
Keypoints:
  Arms fully extended
  Body leaned forward
  Weight on front foot

Description: Peak of spell release
```

**Frame 6: Energy Dispersal**
```
Keypoints:
  Arms lowering
  Body recentering
  Slight exhaustion pose

Description: Spell cast complete, energy dissipating
```

**Frame 7: Return to Ready**
```
Keypoints: Approaching idle stance

Description: Returning to ready stance
```

### 3.8 Skeleton Template File Naming Convention

```
poses/
  idle/
    idle_frame_0.png
    idle_frame_1.png
    ...
    idle_frame_7.png
  walk/
    walk_frame_0.png
    walk_frame_1.png
    ...
    walk_frame_7.png
  attack/
    attack_frame_0.png
    ...
  hurt/
    hurt_frame_0.png
    ...
  death/
    death_frame_0.png
    ...
  cast/
    cast_frame_0.png
    ...
```

---

## 4. ComfyUI Integration Approach

### 4.1 Required Nodes and Models

**ControlNet Model:**
```
Model: control_v11p_sd15_openpose
Path: ComfyUI/models/controlnet/control_v11p_sd15_openpose.pth
Size: ~700MB
Source: lllyasviel/ControlNet-v1-1
```

**Required Custom Nodes:**
```
1. ComfyUI-Advanced-ControlNet
   - Source: https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet
   - Provides: ControlNetApplyAdvanced, OpenPose Preprocessor

2. ComfyUI_Comfyroll_CustomNodes (optional)
   - Source: https://github.com/Suzie1/ComfyUI_Comfyroll_CustomNodes
   - Provides: Batch processing utilities

3. ComfyUI-AnimateDiff-Evolved (optional, for temporal)
   - Source: https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved
```

**Base Model:**
```
SD 1.5 base for ControlNet compatibility
Path: ComfyUI/models/checkpoints/v1-5-pruned.ckpt
Size: ~4GB

Alternative: Any SD1.5-based model
- Deliberate
- Realistic Vision
- DreamShaper
```

### 4.2 Node Graph Structure

```
[Load Image: Pose Template] ──────────────┐
                                          │
[Load Checkpoint: SD1.5] ─────────────────┤
                                          │
[CLIP Text Encode: Prompt] ───────────────┤
                                          ▼
[Load ControlNet Model] ──► [Apply ControlNet] ──► [KSampler] ──► [VAE Decode] ──► [Save Image]
                                          ▲
[Empty Latent Image: 512x512] ────────────┘
```

**Full Workflow JSON Structure:**
```json
{
  "1": {
    "class_type": "LoadImage",
    "inputs": { "image": "idle_frame_0.png" }
  },
  "2": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "v1-5-pruned.ckpt" }
  },
  "3": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "pixel art game character, warrior, standing pose, fantasy RPG, ink and wash style",
      "clip": ["2", 1]
    }
  },
  "4": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "blurry, deformed, bad anatomy, extra limbs",
      "clip": ["2", 1]
    }
  },
  "5": {
    "class_type": "ControlNetLoader",
    "inputs": { "control_net_name": "control_v11p_sd15_openpose.pth" }
  },
  "6": {
    "class_type": "ControlNetApply",
    "inputs": {
      "conditioning": ["3", 0],
      "control_net": ["5", 0],
      "image": ["1", 0],
      "strength": 0.5
    }
  },
  "7": {
    "class_type": "EmptyLatentImage",
    "inputs": { "width": 512, "height": 512, "batch_size": 1 }
  },
  "8": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["2", 0],
      "positive": ["6", 0],
      "negative": ["4", 0],
      "latent_image": ["7", 0],
      "seed": 12345,
      "steps": 20,
      "cfg": 7.5,
      "sampler_name": "euler_ancestral",
      "scheduler": "normal",
      "denoise": 1.0
    }
  },
  "9": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["8", 0], "vae": ["2", 2] }
  },
  "10": {
    "class_type": "SaveImage",
    "inputs": { "images": ["9", 0], "filename_prefix": "character_frame" }
  }
}
```

### 4.3 Integration with Existing Pipeline

**Current Modia Pipeline:**
```
Prompt → Flux + LoRA → 1024x1024 → Post-process → 64x64 frame → Assemble strip
```

**Proposed ControlNet Pipeline:**
```
Pose Template + Prompt → SD1.5 + ControlNet + IP-Adapter → 512x512 → Post-process → 64x64 frame → Assemble strip
```

**Key Changes:**

1. **Model Switch:** Flux GGUF (8GB VRAM tight) → SD1.5 + ControlNet (5-6GB VRAM)
2. **Resolution:** 1024x1024 → 512x512 (ControlNet optimal)
3. **Conditioning:** Text-only → Text + Pose Image + Reference Image

### 4.4 Batch Processing Workflow

For generating all 8 frames of an animation:

```python
# Pseudo-code for batch frame generation
def generate_animation_frames(
    animation_type: str,
    character_prompt: str,
    reference_image: str,
    output_dir: str
):
    for frame_idx in range(8):
        pose_template = f"poses/{animation_type}/{animation_type}_frame_{frame_idx}.png"

        workflow = build_controlnet_workflow(
            pose_image=pose_template,
            prompt=character_prompt,
            reference_image=reference_image,  # IP-Adapter
            controlnet_strength=0.5,
            seed=base_seed + frame_idx,
        )

        result = comfyui_client.execute(workflow)
        save_frame(result, f"{output_dir}/{animation_type}_frame_{frame_idx}.png")
```

### 4.5 IP-Adapter Integration for Character Consistency

**Model:**
```
Model: ip-adapter-plus-face_sd15.safetensors
Path: ComfyUI/models/ipadapter/ip-adapter-plus-face_sd15.safetensors
Size: ~100MB
```

**Workflow Addition:**
```json
{
  "11": {
    "class_type": "IPAdapterModelLoader",
    "inputs": { "ipadapter_file": "ip-adapter-plus-face_sd15.safetensors" }
  },
  "12": {
    "class_type": "IPAdapterApply",
    "inputs": {
      "model": ["2", 0],
      "ipadapter": ["11", 0],
      "image": ["reference_character_image", 0],
      "weight": 0.5,
      "noise": 0.0,
      "start_at": 0.0,
      "end_at": 1.0
    }
  }
}
```

**Reference Image Requirements:**
- Clear frontal view of character
- Same art style as target output
- 512x512 or larger
- Single character, no background

---

## 5. VRAM Estimates and Optimization

### 5.1 Component VRAM Usage

| Component | VRAM (Estimated) | Notes |
|-----------|------------------|-------|
| **SD1.5 Base** | ~3.5GB | fp16 precision |
| **ControlNet OpenPose** | ~1.2GB | Single ControlNet |
| **IP-Adapter** | ~0.5GB | Face variant |
| **VAE** | ~0.3GB | Decoding |
| **Latent Space** | ~0.5GB | 512x512 batch=1 |
| **TOTAL** | ~6.0GB | Base config |

### 5.2 8GB VRAM Configurations

**Configuration A: Minimal (5-6GB)**
```
SD1.5 + ControlNet OpenPose only
Resolution: 512x512
Batch size: 1
Estimated VRAM: 5.2GB
```

**Configuration B: Full (7-8GB)**
```
SD1.5 + ControlNet OpenPose + IP-Adapter
Resolution: 512x512
Batch size: 1
Estimated VRAM: 7.5GB
```

**Configuration C: Optimized (6-7GB)**
```
SD1.5 + ControlNet OpenPose + IP-Adapter
Resolution: 512x512
Batch size: 1
+ Model offloading enabled
+ fp16 attention
Estimated VRAM: 6.5GB
```

### 5.3 VRAM Optimization Techniques

**1. Model Offloading:**
```
--lowvram flag in ComfyUI
Moves unused model parts to CPU during generation
Adds ~20% time overhead
```

**2. Attention Slicing:**
```
--use-split-cross-attention
Processes attention in chunks
Reduces peak VRAM by ~1GB
```

**3. fp16 Precision:**
```
Default in ComfyUI for most models
Half-precision reduces memory by ~50%
```

**4. Batch Processing:**
```
Generate frames sequentially rather than batched
Batch size 1 minimizes VRAM
```

### 5.4 Comparison: Flux GGUF vs SD1.5 + ControlNet

| Metric | Flux GGUF (Current) | SD1.5 + ControlNet |
|--------|---------------------|-------------------|
| **VRAM** | 7-8GB (tight) | 5-7GB (comfortable) |
| **Resolution** | 1024x1024 | 512x512 |
| **Pose Control** | None | Excellent |
| **Style Quality** | Excellent | Good |
| **Speed** | ~8s/image | ~5s/image |
| **Character Consistency** | Poor | Good (with IP-Adapter) |

**Recommendation:** SD1.5 + ControlNet provides better pose accuracy and character consistency at lower VRAM cost, though style quality may require additional LoRA training or careful prompt engineering.

---

## 6. Recommended Settings and Workflow

### 6.1 ControlNet Settings

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| **Control Weight** | 0.4 - 0.6 | Higher = stricter pose adherence |
| **Starting Step** | 0.0 | Begin control from start |
| **Ending Step** | 0.8 | Release control near end for details |
| **Preprocessor** | None (pre-made templates) | Skip if using custom skeletons |

**Weight Tuning Guide:**

| Weight | Effect |
|--------|--------|
| 0.3 | Loose guidance, creative freedom |
| 0.5 | Balanced pose adherence and quality |
| 0.7 | Strict pose, may reduce quality |
| 1.0 | Exact pose, often degraded output |

### 6.2 IP-Adapter Settings

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| **Weight** | 0.4 - 0.6 | Higher = closer to reference |
| **Noise** | 0.0 | No added noise |
| **Start At** | 0.0 | Begin from start |
| **End At** | 0.8 | Release before final steps |

### 6.3 Sampler Settings

| Parameter | Recommended Value |
|-----------|-------------------|
| **Sampler** | euler_ancestral or dpm++ 2m |
| **Scheduler** | normal or karras |
| **Steps** | 20-30 |
| **CFG Scale** | 7.0 - 8.5 |
| **Denoise** | 1.0 (full generation) |

### 6.4 Prompt Engineering for ControlNet

**Structure:**
```
[Character Description], [Pose Context], [Art Style], [Quality Tags]
```

**Example (Warrior):**
```
fantasy warrior, male human, determined expression, heavy armor with sword,
standing pose, game character sprite,
pixel art style, ink and wash, bold outlines, watercolor fills,
high quality, detailed, clean edges
```

**Negative Prompt:**
```
blurry, low quality, deformed, bad anatomy, extra limbs,
missing limbs, floating limbs, disconnected limbs,
disfigured, mutation, ugly, watermark, signature,
3d render, photorealistic
```

### 6.5 Complete Generation Parameters

```json
{
  "model": {
    "checkpoint": "v1-5-pruned.ckpt",
    "controlnet": "control_v11p_sd15_openpose.pth",
    "ipadapter": "ip-adapter-plus-face_sd15.safetensors"
  },
  "generation": {
    "width": 512,
    "height": 512,
    "batch_size": 1,
    "steps": 25,
    "cfg_scale": 7.5,
    "sampler": "euler_ancestral",
    "scheduler": "normal"
  },
  "controlnet": {
    "strength": 0.5,
    "start_percent": 0.0,
    "end_percent": 0.8
  },
  "ipadapter": {
    "weight": 0.5,
    "noise": 0.0,
    "start_at": 0.0,
    "end_at": 0.8
  }
}
```

---

## 7. Implementation Checklist

### Phase 1: Setup (Week 1)

- [ ] Download ControlNet OpenPose model
  ```bash
  wget -P ComfyUI/models/controlnet/ \
    https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth
  ```

- [ ] Install ComfyUI-Advanced-ControlNet
  ```bash
  cd ComfyUI/custom_nodes
  git clone https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet
  ```

- [ ] Download SD1.5 checkpoint (if not present)
  ```bash
  wget -P ComfyUI/models/checkpoints/ \
    https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned.ckpt
  ```

- [ ] Download IP-Adapter model
  ```bash
  wget -P ComfyUI/models/ipadapter/ \
    https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus-face_sd15.safetensors
  ```

### Phase 2: Skeleton Templates (Weeks 1-2)

- [ ] Set up template directory structure
  ```bash
  mkdir -p poses/{idle,walk,attack,hurt,death,cast}
  ```

- [ ] Create idle animation skeletons (8 frames)
- [ ] Create walk animation skeletons (8 frames)
- [ ] Create attack animation skeletons (8 frames)
- [ ] Create hurt animation skeletons (8 frames)
- [ ] Create death animation skeletons (8 frames)
- [ ] Create cast animation skeletons (8 frames)

### Phase 3: Workflow Development (Week 2)

- [ ] Build basic ControlNet workflow
- [ ] Test pose accuracy with single frames
- [ ] Add IP-Adapter integration
- [ ] Test character consistency across frames
- [ ] Optimize VRAM usage
- [ ] Benchmark generation speed

### Phase 4: Pipeline Integration (Week 3)

- [ ] Create Python wrapper for ComfyUI execution
- [ ] Update `generate_character_frame.py`
- [ ] Modify `generate-characters.js` for new pipeline
- [ ] Test full animation generation
- [ ] Quality comparison with current pipeline
- [ ] Performance benchmarking

### Phase 5: Validation (Week 4)

- [ ] Generate sample animations for all character classes
- [ ] Evaluate frame consistency
- [ ] Evaluate pose accuracy
- [ ] Evaluate style quality
- [ ] Gather feedback
- [ ] Document results

---

## Appendix A: OpenPose Keypoint Coordinates Reference

**Standard 512x512 Neutral Standing Pose:**

| Keypoint | Index | X | Y | Description |
|----------|-------|---|---|-------------|
| Nose | 0 | 256 | 80 | Center top |
| Neck | 1 | 256 | 130 | Below nose |
| R Shoulder | 2 | 180 | 145 | Right of neck |
| R Elbow | 3 | 155 | 215 | Below R shoulder |
| R Wrist | 4 | 160 | 285 | Below R elbow |
| L Shoulder | 5 | 332 | 145 | Left of neck |
| L Elbow | 6 | 357 | 215 | Below L shoulder |
| L Wrist | 7 | 352 | 285 | Below L elbow |
| R Hip | 8 | 215 | 265 | Right lower torso |
| R Knee | 9 | 215 | 365 | Below R hip |
| R Ankle | 10 | 215 | 465 | Below R knee |
| L Hip | 11 | 297 | 265 | Left lower torso |
| L Knee | 12 | 297 | 365 | Below L hip |
| L Ankle | 13 | 297 | 465 | Below L knee |
| R Eye | 14 | 235 | 65 | Right of nose |
| L Eye | 15 | 277 | 65 | Left of nose |
| R Ear | 16 | 200 | 75 | Right of R eye |
| L Ear | 17 | 312 | 75 | Left of L eye |

---

## Appendix B: Skeleton Drawing Python Script

```python
"""
Generate OpenPose skeleton images from keypoint coordinates.
Usage: python draw_skeleton.py --output poses/idle/idle_frame_0.png
"""

import json
import numpy as np
from PIL import Image, ImageDraw

# OpenPose limb connections (pairs of keypoint indices)
LIMB_CONNECTIONS = [
    (0, 1),   # Nose -> Neck
    (1, 2),   # Neck -> R Shoulder
    (2, 3),   # R Shoulder -> R Elbow
    (3, 4),   # R Elbow -> R Wrist
    (1, 5),   # Neck -> L Shoulder
    (5, 6),   # L Shoulder -> L Elbow
    (6, 7),   # L Elbow -> L Wrist
    (1, 8),   # Neck -> R Hip
    (8, 9),   # R Hip -> R Knee
    (9, 10),  # R Knee -> R Ankle
    (1, 11),  # Neck -> L Hip
    (11, 12), # L Hip -> L Knee
    (12, 13), # L Knee -> L Ankle
    (0, 14),  # Nose -> R Eye
    (14, 16), # R Eye -> R Ear
    (0, 15),  # Nose -> L Eye
    (15, 17), # L Eye -> L Ear
    (8, 11),  # R Hip -> L Hip
]

# Colors for each limb (RGB)
LIMB_COLORS = [
    (255, 255, 255),  # Nose-Neck (white)
    (255, 0, 0),      # Neck-RShoulder (red)
    (255, 85, 0),     # RShoulder-RElbow (orange-red)
    (255, 170, 0),    # RElbow-RWrist (orange)
    (0, 255, 0),      # Neck-LShoulder (green)
    (85, 255, 0),     # LShoulder-LElbow (lime)
    (170, 255, 0),    # LElbow-LWrist (yellow-green)
    (255, 0, 0),      # Neck-RHip (red)
    (255, 0, 85),     # RHip-RKnee (pink-red)
    (255, 0, 170),    # RKnee-RAnkle (magenta)
    (0, 255, 0),      # Neck-LHip (green)
    (0, 255, 85),     # LHip-LKnee (cyan-green)
    (0, 255, 170),    # LKnee-LAnkle (teal)
    (255, 255, 0),    # Nose-REye (yellow)
    (255, 170, 255),  # REye-REar (light pink)
    (255, 255, 0),    # Nose-LEye (yellow)
    (170, 255, 255),  # LEye-LEar (light cyan)
    (255, 255, 0),    # RHip-LHip (yellow)
]

def draw_skeleton(keypoints: list, output_path: str, size: int = 512):
    """
    Draw OpenPose skeleton from keypoints.

    Args:
        keypoints: List of (x, y) tuples for 18 keypoints
        output_path: Output PNG path
        size: Image size (square)
    """
    # Create black background
    img = Image.new('RGB', (size, size), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    line_width = 6
    point_radius = 8

    # Draw limbs
    for idx, (start, end) in enumerate(LIMB_CONNECTIONS):
        if keypoints[start] and keypoints[end]:
            x1, y1 = keypoints[start]
            x2, y2 = keypoints[end]
            color = LIMB_COLORS[idx]
            draw.line([(x1, y1), (x2, y2)], fill=color, width=line_width)

    # Draw keypoints
    for i, kp in enumerate(keypoints):
        if kp:
            x, y = kp
            draw.ellipse(
                [x - point_radius, y - point_radius,
                 x + point_radius, y + point_radius],
                fill=LIMB_COLORS[min(i, len(LIMB_COLORS)-1)]
            )

    img.save(output_path)
    print(f"Saved: {output_path}")

# Example: Neutral standing pose
NEUTRAL_POSE = [
    (256, 80),   # 0: Nose
    (256, 130),  # 1: Neck
    (180, 145),  # 2: R Shoulder
    (155, 215),  # 3: R Elbow
    (160, 285),  # 4: R Wrist
    (332, 145),  # 5: L Shoulder
    (357, 215),  # 6: L Elbow
    (352, 285),  # 7: L Wrist
    (215, 265),  # 8: R Hip
    (215, 365),  # 9: R Knee
    (215, 465),  # 10: R Ankle
    (297, 265),  # 11: L Hip
    (297, 365),  # 12: L Knee
    (297, 465),  # 13: L Ankle
    (235, 65),   # 14: R Eye
    (277, 65),   # 15: L Eye
    (200, 75),   # 16: R Ear
    (312, 75),   # 17: L Ear
]

if __name__ == "__main__":
    draw_skeleton(NEUTRAL_POSE, "neutral_pose.png")
```

---

## Appendix C: Resolution Considerations for 64x64 Sprites

**Question: What resolution should skeleton template images be?**

**Answer:** 512x512 is optimal for SD1.5 + ControlNet OpenPose.

**Reasoning:**

1. **ControlNet Training:** The control_v11p_sd15_openpose model was trained on 512x512 images
2. **Proportional Scaling:** 512x512 → 64x64 = 8x downscale, preserving proportions
3. **VRAM Efficiency:** 512x512 uses ~4x less VRAM than 1024x1024
4. **Generation Speed:** ~5s at 512x512 vs ~15s at 1024x1024
5. **Quality Preservation:** Sufficient detail for 64x64 target after post-processing

**Alternative: 768x768**

- Slightly higher detail
- ~50% more VRAM
- Better for characters with fine details
- Still compatible with SD1.5

**Workflow:**
```
Pose Template (512x512) → SD1.5 Generation (512x512) →
Background Removal → Crop to Content → Resize to 64x64
```

---

## Appendix D: Pre-made Pose Packs Evaluation

**Question: Can we use pre-made pose packs, or do we need custom ones for 64x64 sprites?**

**Answer:** Pre-made packs can be starting points but require customization.

**Evaluation:**

| Source | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Civitai Pose Packs** | Ready to use, varied poses | Generic proportions, may not match sprite style | Good for reference |
| **OpenPose Editor** | Interactive, precise | Manual work per frame | Best for custom |
| **Reference Extraction** | Quick, realistic poses | Requires good references | Supplementary |

**Recommendations:**

1. **Use pre-made for reference:** Study existing walk cycles, attacks, etc.
2. **Customize proportions:** Adjust for sprite-style exaggerated proportions
3. **Create sprite-specific library:** Build 48 custom templates for Modia
4. **Store as project assets:** `image-generator/pose-templates/modia/`

**Custom vs Pre-made for Sprites:**

| Aspect | Pre-made | Custom for Sprites |
|--------|----------|-------------------|
| Head size | Realistic (12-15%) | Exaggerated (18-22%) |
| Limb length | Realistic | Simplified |
| Detail level | High | Low (clear silhouettes) |
| Animation focus | Varied | Game-specific cycles |

**Verdict:** Create custom pose templates optimized for Modia's 64x64 sprite style, using pre-made packs as motion references.

---

*Research complete: 2026-01-30*
*Implementation tracking: See [ANIMATION_GENERATION_RESEARCH.md](./ANIMATION_GENERATION_RESEARCH.md) Task 1*
