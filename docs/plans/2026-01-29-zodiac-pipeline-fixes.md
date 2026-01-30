# Zodiac Icon Pipeline Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix zodiac icon 404 errors, add 256px support for icons, and document the category addition process.

**Architecture:** The fix addresses three layers: (1) admin dashboard path normalization, (2) size preset configuration across shared/scripts, (3) documentation for future category additions. The centralized approach normalizes icon IDs in `getAssetUrls()` so all consumers get correct paths.

**Tech Stack:** React (admin), Node.js scripts, shared ESM modules

---

## Summary of Issues

| Issue | Root Cause | Fix Location |
|-------|-----------|--------------|
| Zodiac 404 errors | `getAssetImageUrls()` doesn't normalize icon IDs | `admin/src/lib/assetPathHelper.js` |
| Missing 256px size | Hardcoded size arrays in 3 files | `shared/assetPaths.js`, `resizeUtils.js`, `generate-icons.js` |
| Missing zodiac output dir | Hardcoded category list in generation script | `generate-icons.js:268` |
| Undocumented process | No "Adding New Categories" guide | `docs/AI_IMAGE_GENERATION.md` |

---

## Task 1: Fix Icon ID Normalization in AssetDetail

**Files:**
- Modify: `admin/src/lib/assetPathHelper.js:68-79`

**Problem:** `getAssetUrls()` passes raw icon IDs to `getAssetPath()`, but icon files are saved with stripped prefixes (e.g., `zodiac_aries` → `aries.png`).

**Step 1: Update `getAssetUrls()` to normalize icon IDs**

In `admin/src/lib/assetPathHelper.js`, modify the `getAssetUrls` function:

```javascript
/**
 * Get canonical asset URLs
 * Returns array with the canonical path for the asset
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} options - Options (subcategory, size, etc.)
 * @returns {string[]} Array of URLs (canonical path)
 */
export function getAssetUrls(category, id, options = {}) {
  const urls = [];
  const size = options.size || DEFAULT_SIZES[category];

  // Normalize icon IDs to match file naming convention
  // Icon metadata uses full IDs (menu_fishing) but files use stripped names (fishing.png)
  const normalizedId = category === 'icons' && options.subcategory
    ? normalizeIconId(id, options.subcategory)
    : id;

  try {
    urls.push(getAssetPath(category, normalizedId, { ...options, size }));
  } catch (e) {
    // Category not supported
  }

  return urls;
}
```

**Step 2: Verify the fix in browser**

1. Run `npm run dev:admin`
2. Navigate to Icons page
3. Filter by zodiac subcategory
4. Click on `zodiac_aries` icon
5. Verify the detail panel loads the image at `/assets/icons/png/64/zodiac/aries.png`

**Step 3: Commit**

```bash
git add admin/src/lib/assetPathHelper.js
git commit -m "fix(admin): Normalize icon IDs in getAssetUrls for AssetDetail panel

The getAssetUrls function was passing raw icon IDs (e.g., zodiac_aries)
to getAssetPath, but icon files are saved with stripped prefixes (aries.png).
This caused 404 errors in the AssetDetail panel for zodiac and other icons.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add 256px Size Support for Icons

**Files:**
- Modify: `shared/assetPaths.js:33`
- Modify: `scripts/ai-images/lib/resizeUtils.js:34`
- Modify: `scripts/ai-images/generate-icons.js:330`

**Step 1: Update shared/assetPaths.js (source of truth)**

Change line 33 from:
```javascript
icons: [16, 24, 32, 48, 64, 128],
```

To:
```javascript
icons: [16, 24, 32, 48, 64, 128, 256],
```

**Step 2: Update resizeUtils.js (fallback definition)**

Change line 34 from:
```javascript
icons: [16, 24, 32, 48, 64, 128],   // 128x128 AI -> 16, 24, 32, 48, 64, 128 variants
```

To:
```javascript
icons: [16, 24, 32, 48, 64, 128, 256],   // 1024x1024 AI -> 16, 24, 32, 48, 64, 128, 256 variants
```

**Step 3: Update generate-icons.js (hardcoded generation call)**

Change line 330 from:
```javascript
sizes: [16, 24, 32, 48, 64, 128],
```

To:
```javascript
sizes: [16, 24, 32, 48, 64, 128, 256],
```

**Step 4: Verify the changes**

```bash
# Check that the files are updated correctly
grep -n "icons:" shared/assetPaths.js scripts/ai-images/lib/resizeUtils.js
grep -n "sizes:" scripts/ai-images/generate-icons.js | head -5
```

Expected output should show 256 in all icon size arrays.

**Step 5: Commit**

```bash
git add shared/assetPaths.js scripts/ai-images/lib/resizeUtils.js scripts/ai-images/generate-icons.js
git commit -m "feat(assets): Add 256px size support for icons

Zodiac stones need larger display sizes for collection grids. Added 256px
to icon size presets in all three locations:
- shared/assetPaths.js (source of truth)
- scripts/ai-images/lib/resizeUtils.js (script fallback)
- scripts/ai-images/generate-icons.js (generation call)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Zodiac to Output Directory List

**Files:**
- Modify: `scripts/ai-images/generate-icons.js:268`

**Problem:** The hardcoded category list for output directories doesn't include `zodiac`.

**Step 1: Add zodiac to category list**

Change line 268 from:
```javascript
for (const cat of ['actions', 'status', 'menu', 'augments', 'resources']) {
```

To:
```javascript
for (const cat of ['actions', 'status', 'menu', 'augments', 'resources', 'zodiac']) {
```

**Step 2: Verify directory creation**

```bash
# Dry run to check directory handling
node scripts/ai-images/generate-icons.js --category zodiac --dry-run
```

**Step 3: Commit**

```bash
git add scripts/ai-images/generate-icons.js
git commit -m "fix(icons): Add zodiac to output directory list in generate-icons.js

The hardcoded category list for ensuring output directories exist was
missing 'zodiac', causing potential directory issues during generation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Regenerate Size Variants from Existing Originals

**Files:**
- No file changes - script execution only

**Step 1: Verify originals exist**

```bash
ls -la frontend/public/assets/icons/originals/zodiac/
```

Expected: Should show `aries.png` (744KB 1024x1024 original)

**Step 2: Run migration script to regenerate all sizes including 256px**

```bash
npm run ai:migrate-paths -- --category icons --force --verbose 2>&1 | head -100
```

This will regenerate all size variants (16, 24, 32, 48, 64, 128, 256) from the originals.

**Step 3: Verify 256px was created**

```bash
ls -la frontend/public/assets/icons/png/256/zodiac/
```

Expected: Should show `aries.png` at 256x256

**Step 4: No commit needed (generated files not in git)**

---

## Task 5: Document "Adding New Asset Categories" Process

**Files:**
- Modify: `docs/AI_IMAGE_GENERATION.md`

**Step 1: Add new section after "Adding New Assets"**

Find the "Adding New Assets" section (around line 388) and add a new section after it:

```markdown
## Adding New Asset Categories

When adding an entirely new category (e.g., zodiac icons) or subcategory, follow this complete checklist. Missing any step will cause generation or display failures.

### Checklist

#### Metadata Layer
1. **Create category JSON file**: `ai-image-metadata/{category}/{subcategory}.json`
   - Include version, category name, description, styleGuide
   - Define each asset with id, prompt, seed, generated flag

2. **Update category manifest**: `ai-image-metadata/{category}/manifest.json`
   - Add new file to `categoryFiles` array
   - Update `totalAssets` count

3. **Update master manifest**: `ai-image-metadata/manifest.json`
   - Add new category file to file list
   - Update `assetCount` total

#### Generation Script Layer
4. **Update output directory list** in `scripts/ai-images/generate-{category}.js`
   - Find the hardcoded category array for directory creation
   - Add your new subcategory name

5. **Verify metadata loading** works for new category:
   ```bash
   node scripts/ai-images/generate-{category}.js --category {subcategory} --dry-run
   ```

#### Path Configuration Layer
6. **Verify SIZE_PRESETS** in `shared/assetPaths.js` includes your category
   - Add new category if top-level (e.g., new asset type)
   - Subcategories use parent category's size presets

#### Admin Dashboard Layer
7. **Subcategory filter** appears automatically if metadata is correct
   - The admin loads categories from metadata files
   - Verify filter works in Icons/Items page

#### Frontend Layer
8. **AssetLoader** typically handles new subcategories automatically
   - Uses canonical paths from `@shared/assetPaths.js`
   - Test loading in game context

### Example: Adding Zodiac Icons

```bash
# 1. Create metadata file
# ai-image-metadata/icons/zodiac.json with 12 zodiac sign icons

# 2. Update icons manifest
# Add "zodiac.json" to categoryFiles in ai-image-metadata/icons/manifest.json

# 3. Update master manifest
# Add "icons/zodiac.json" to ai-image-metadata/manifest.json

# 4. Add to generation script output dirs
# Add 'zodiac' to array at scripts/ai-images/generate-icons.js:268

# 5. Generate icons
npm run ai:generate:icons -- --category zodiac

# 6. Verify in admin dashboard
npm run dev:admin
# Navigate to Icons > filter by zodiac
```

### Common Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| 404 in admin panel | Missing from output dir list | Add to generation script category array |
| Icon shows wrong name | ID normalization mismatch | Check if ID includes category prefix |
| Missing size variant | Size not in SIZE_PRESETS | Add size to appropriate preset array |
| Filter not showing | Manifest not updated | Update categoryFiles in manifest |
```

**Step 2: Commit**

```bash
git add docs/AI_IMAGE_GENERATION.md
git commit -m "docs: Add 'Adding New Asset Categories' guide to AI_IMAGE_GENERATION.md

Documents the complete checklist for adding new asset categories or
subcategories, including metadata, generation scripts, path configuration,
admin dashboard, and frontend integration. Includes common pitfalls table.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Verify Complete Pipeline

**Files:**
- No file changes - verification only

**Step 1: Start services**

```bash
npm run dev:admin &
npm run dev:api &
```

**Step 2: Test admin dashboard**

1. Open http://localhost:5173
2. Navigate to Icons page
3. Select "zodiac" from subcategory filter
4. Verify `zodiac_aries` thumbnail loads (AssetCard uses `getAssetImageUrl`)
5. Click on `zodiac_aries` to open detail panel
6. Verify image loads in detail panel (AssetDetail uses `getAssetImageUrls`)
7. Select different sizes (16, 24, 32, 48, 64, 128, 256) - all should load

**Step 3: Test size variants exist**

```bash
for size in 16 24 32 48 64 128 256; do
  file="frontend/public/assets/icons/png/${size}/zodiac/aries.png"
  if [ -f "$file" ]; then
    dims=$(identify -format "%wx%h" "$file" 2>/dev/null)
    echo "${size}px: EXISTS (${dims})"
  else
    echo "${size}px: MISSING"
  fi
done
```

Expected: All sizes should exist with correct dimensions.

**Step 4: Document verification results**

If all tests pass, the pipeline is fully functional.

---

## Verification Summary

| Component | Test | Expected Result |
|-----------|------|-----------------|
| AssetCard | Load zodiac thumbnail | Image displays at `/assets/icons/png/32/zodiac/aries.png` |
| AssetDetail | Open zodiac icon | Image displays at selected size |
| Size selector | Change to 256px | 256px variant loads successfully |
| Generation | Dry run with zodiac | No directory errors |
| Documentation | Review new section | Complete checklist present |

---

## Files Modified Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `admin/src/lib/assetPathHelper.js` | Fix | Normalize icon IDs in `getAssetUrls()` |
| `shared/assetPaths.js` | Feature | Add 256 to icons SIZE_PRESETS |
| `scripts/ai-images/lib/resizeUtils.js` | Feature | Add 256 to icons size array |
| `scripts/ai-images/generate-icons.js` | Fix + Feature | Add zodiac to dirs + 256 to sizes |
| `docs/AI_IMAGE_GENERATION.md` | Docs | Add category addition guide |
