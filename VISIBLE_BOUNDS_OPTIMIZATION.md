# Performance Fix - Visible Bounds Optimization

## Problem
เมื่อ zoom ใกล้มากๆ ระบบยังช้าและกระตุก เพราะกำลังโหลด **ทั้ง bounds** ทุกครั้ง

## Root Cause Analysis

### จำนวน Tiles ที่โหลด:

**Config Bounds:** 
- Lat: 16.828773 - 16.955233 (ประมาณ 14 km)
- Lon: 101.676558 - 101.843331 (ประมาณ 18.7 km)

**ที่ Zoom Level ต่างๆ:**

| Zoom | Tile Size (meters) | Tiles X | Tiles Y | Total Tiles | Data Size |
|------|-------------------|---------|---------|-------------|-----------|
| 12   | ~2.4 km          | 8       | 6       | **48**      | 12 MB     |
| 13   | ~1.2 km          | 16      | 11      | **176**     | 45 MB     |
| 14   | ~610 m           | 31      | 22      | **682**     | 175 MB    |
| 15   | ~305 m           | 61      | 44      | **2,684**   | 688 MB    |
| 16   | ~153 m           | 122     | 88      | **10,736**  | 2.75 GB   |

**ปัญหาใหญ่:**
- ที่ zoom 16 (ใกล้มาก) = **10,736 tiles!**
- ขนาดข้อมูล: **2.75 GB!**
- ใช้เวลาโหลดนานมาก และทำให้ browser แทบแฟ้ง

## Solution: Visible Bounds Optimization

### 1. Dynamic Bounds Calculation (Terrain.tsx)

เพิ่ม **visibleBounds** state ที่คำนวณจาก camera distance:

```tsx
// Visible Bounds Optimization - Only load tiles for visible area
const [visibleBounds, setVisibleBounds] = useState(TERRAIN_CONFIG.BOUNDS);
```

### 2. Distance-Based Bounds Reduction

เมื่อ camera ใกล้ (< 5000m), ลด bounds ลงเหลือเฉพาะส่วนกลาง:

```tsx
if (distMeters < 5000) {
    const centerLat = (latMin + latMax) / 2;
    const centerLon = (lonMin + lonMax) / 2;
    
    // Calculate visible fraction (15% to 100%)
    const fraction = Math.min(1.0, Math.max(0.15, distMeters / 5000));
    
    const latRange = (latMax - latMin) * fraction;
    const lonRange = (lonMax - lonMin) * fraction;
    
    newVisibleBounds = {
        latMin: centerLat - latRange / 2,
        latMax: centerLat + latRange / 2,
        lonMin: centerLon - lonRange / 2,
        lonMax: centerLon + lonRange / 2
    };
}
```

### 3. Modified fetchTerrainTile (terrain.ts)

เพิ่ม **customBounds** parameter:

```tsx
export const fetchTerrainTile = async (
    zoom?: number, 
    customBounds?: typeof BOUNDS
) => {
    const bounds = customBounds || BOUNDS;
    // ... use bounds instead of BOUNDS everywhere
```

### 4. Tile Count Limit

เพิ่มการแจ้งเตือนเมื่อ tiles มากเกินไป:

```tsx
const MAX_TILES = 100; // Maximum 100 tiles (e.g., 10x10)

if (totalTiles > MAX_TILES) {
    console.warn(`Tile count (${totalTiles}) exceeds maximum (${MAX_TILES})`);
}
```

### 5. Apply to Both DEM and Base Map

```tsx
// DEM
fetchTerrainTile(lodZoom, visibleBounds)

// Base Map
const minTile = latLonToTile(visibleBounds.latMax, visibleBounds.lonMin, zoom);
const maxTile = latLonToTile(visibleBounds.latMin, visibleBounds.lonMax, zoom);
```

## Performance Improvement

### Tile Reduction at Different Distances:

| Distance (meters) | Fraction | Zoom 16 Tiles | Reduction |
|-------------------|----------|---------------|-----------|
| 5000+ (far)       | 100%     | 10,736        | 0%        |
| 2500 (medium)     | 50%      | 2,684         | **75%**   |
| 1000 (close)      | 20%      | 430           | **96%**   |
| 500 (very close)  | 15%      | 242           | **98%**   |

### Expected Results:

1. **เมื่อ zoom ไกล** (> 5000m):
   - ใช้ full bounds
   - เห็นทั้งพื้นที่
   
2. **เมื่อ zoom ใกล้** (500-1000m):
   - ใช้เพียง **15-20% ของ bounds**
   - ลด tiles จาก 10,736 → **242 tiles**
   - **ลด data size จาก 2.75 GB → 62 MB!**
   - **เร็วขึ้นกว่า 40 เท่า!**

3. **ความราบรื่น**:
   - ไม่ต้องโหลด tiles ที่ไม่เห็น
   - Transition ระหว่าง LOD smooth ขึ้น
   - Memory usage ลดลงมาก

## Implementation Details

### Files Modified:

1. **src/utils/terrain.ts**
   - เพิ่ม `customBounds` parameter ใน `fetchTerrainTile()`
   - เพิ่มการแจ้งเตือน tile count
   - เพิ่ม console.log สำหรับ debug

2. **src/components/Terrain.tsx**
   - เพิ่ม `visibleBounds` state
   - คำนวณ bounds จาก camera distance
   - ใช้ `visibleBounds` ใน DEM และ Base Map loading
   - อัพเดท UV mapping ให้ใช้ `visibleBounds`

3. **src/utils/frustum.ts** (NEW)
   - Utility functions สำหรับ frustum culling
   - (ยังไม่ได้ใช้ แต่เตรียมไว้สำหรับการ optimize เพิ่มเติม)

## Testing

### ตรวจสอบใน Console:

```
Loading X tiles (AxB) at zoom Z
DEM LOD Update: Zoom Z, Bounds: {...}
```

### คาดหวัง:

- **ระยะไกล**: Loading ~48-176 tiles
- **ระยะกลาง**: Loading ~20-50 tiles  
- **ระยะใกล้**: Loading ~10-30 tiles
- **ไม่ควรเกิน 100 tiles** เว้นแต่ zoom out มาก

## Limitations & Future Improvements

### Current Limitations:

1. **Center-focused only**: ตอนนี้ใช้เฉพาะ center ของ bounds
   - อนาคต: ติดตาม camera look-at direction

2. **โหลดเฉพาะส่วนกลาง**: เมื่อ pan ไปขอบอาจไม่มี data
   - อนาคต: Dynamic bounds based on camera frustum

3. **Terrain mesh ยังคง full size**: geometry ยังครอบคลุม full bounds
   - อนาคต: Dynamic mesh resizing

### Future Optimizations:

1. **Tile Streaming**: โหลด tiles เฉพาะที่จำเป็น on-demand
2. **Tile Caching**: เก็บ tiles ที่โหลดแล้วไว้ใน cache
3. **Progressive Loading**: โหลด low-res ก่อน แล้วค่อย refine
4. **Web Workers**: ย้าย tile processing ไป worker thread

## Date
2026-01-30
