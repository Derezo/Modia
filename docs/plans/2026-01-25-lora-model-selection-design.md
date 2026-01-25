# LoRA Model Selection for Admin Asset Detail Panel

**Date:** 2026-01-25
**Status:** Approved for Implementation

## Overview

Add the ability to select and change LoRA models per-asset in the admin dashboard detail panel. When regenerating an asset, it will use the selected model's trigger word to generate a different visual style.

## Available Models

| Model ID | Name | Trigger Word | Best For |
|----------|------|--------------|----------|
| `v1` | Flat 2D Pixel Art | `GRPZA` | Icons, portraits |
| `v2` | Isometric/Textured | `wbgmsst` | Terrain tiles |
| `modern-pixel` | Modern Pixel Art | `umempart` | Smooth gradients |
| `retro-pixel` | Retro 8-bit | `Retro Pixel` | Classic aesthetic |

## Data Model

### Metadata Storage
- `loraModel` field added to individual assets in JSON metadata files
- Optional field - absent means use category default from `manifest.json`
- Valid values: `"v1"`, `"v2"`, `"modern-pixel"`, `"retro-pixel"`

### Category Defaults (from manifest.json)
```json
{
  "categoryDefaults": {
    "tiles": "v2",
    "portraits": "v1",
    "items": "v1",
    "icons": "v1",
    "nodes": "v1",
    "overlays": "v1"
  }
}
```

## API Changes

**File:** `api/src/routes/admin.js`

1. Add `loraModel` to `allowedFields` array for asset updates
2. Add validation for valid model values
3. Load model definitions from manifest for `/api/admin/config` endpoint

```javascript
const validLoraModels = ['v1', 'v2', 'modern-pixel', 'retro-pixel'];
if (updates.loraModel && !validLoraModels.includes(updates.loraModel)) {
  throw new AppError(`Invalid loraModel: ${updates.loraModel}`, 400);
}
```

## UI Changes

**File:** `admin/src/components/AssetDetail.jsx`

Add "Style Model" dropdown below the Prompt field:

```
┌─────────────────────────────────────┐
│ Style Model                         │
│ ┌─────────────────────────────────┐ │
│ │ Flat 2D Pixel Art (v1)      ▼  │ │
│ └─────────────────────────────────┘ │
│ Category default: v1                │
└─────────────────────────────────────┘
```

### Behavior
- Shows current asset's `loraModel` if set
- Shows category default with "(default)" label if not set
- Changing dropdown saves `loraModel` to asset metadata
- Regenerate button uses saved `loraModel`

### Form State Addition
```javascript
const [formData, setFormData] = useState({
  // ... existing fields
  loraModel: '',  // NEW - empty string means use category default
});
```

## Generation Integration

### Regeneration Flow
1. API reads asset's `loraModel` field (or category default)
2. Passes `--lora <model>` flag to generation script
3. Script uses correct trigger word for prompt
4. Post-processing outputs to canonical paths

### Path Canonicalization
All generation scripts must output directly to canonical paths defined in `shared/assetPaths.js`:

| Category | Original | Size Variants |
|----------|----------|---------------|
| portraits | `/portraits/originals/{id}.png` | `/portraits/{64,128,256}/{id}.png` |
| items | `/items/originals/{subcat}/{id}.png` | `/items/{32,64,128}/{subcat}/{id}.png` |
| nodes | `/nodes/originals/{id}.png` | `/nodes/{48,96}/{id}.png` |

Scripts must use `generateCanonicalSizeVariants()` from `resizeUtils.js`.

## Implementation Checklist

### API (`api/src/routes/admin.js`)
- [x] Add `loraModel` to `allowedFields` array
- [x] Add validation for valid loraModel values
- [x] Add `/api/admin/config` endpoint returning loraModels from manifest

### UI (`admin/src/components/AssetDetail.jsx`)
- [x] Add `loraModel` to formData state
- [x] Add Style Model dropdown component
- [x] Show category default hint
- [x] Include loraModel in save payload

### Generation Scripts
- [x] Verify `generate-items.js` uses canonical paths (already correct)
- [x] Verify `generate-nodes.js` uses canonical paths (already correct)
- [x] Fix any scripts not using `generateCanonicalSizeVariants()` (none needed)
- [x] Add one-time header comment to `migrate-asset-paths.js`

## Error Handling

| Scenario | Handling |
|----------|----------|
| Asset has no `loraModel` | Use category default |
| Invalid `loraModel` in metadata | Generation falls back to category default |
| Unknown model in API request | Return 400 error |

## Files Modified

| File | Changes |
|------|---------|
| `api/src/routes/admin.js` | Add loraModel to allowed fields, validation, config endpoint |
| `admin/src/components/AssetDetail.jsx` | Add Style Model dropdown |
| `scripts/ai-images/generate-items.js` | Verify/fix canonical path output |
| `scripts/ai-images/generate-nodes.js` | Verify/fix canonical path output |
| `scripts/ai-images/migrate-asset-paths.js` | Add one-time migration header |
