# Progressive Loading & Performance Fix

## ปัญหา
เมื่อ zoom ใกล้ๆ และ pan ไปด้านข้าง ระบบยังช้าเพราะ:
1. **ไม่มี Tile Caching** - โหลดซ้ำทุกครั้ง
2. **ไม่มี Progressive Loading** - ต้องรอโหลดเสร็จถึงจะแสดง
3. **visibleBounds เปลี่ยนบ่อย** - ทุกครั้งที่ pan เล็กน้อย

## การแก้ไขที่ทำแล้ว

### 1. Progressive Loading ✅

เพิ่ม state เพื่อเก็บข้อมูลเก่าไว้แสดงขณะโหลดข้อมูลใหม่:

```tsx
// Line 122-124
const [terrainData, setTerrainData] = useState<...>(null);
const [previousTerrainData, setPreviousTerrainData] = useState<typeof terrainData>(null);
const [isLoadingTerrain, setIsLoadingTerrain] = useState(false);
```

**การทำงาน:**
- เมื่อเริ่มโหลดข้อมูลใหม่ → `setIsLoadingTerrain(true)`
- **ยังคงแสดง terrainData เก่า** ไม่หายไป
- เมื่อโหลดเสร็จ → บันทึก previous data และอัพเดท terrain data
- หาก error → เก็บ previous data ไว้

```tsx
// Line 399-420
fetchTerrainTile(lodZoom, visibleBounds).then(data => {
    if (active) {
        setPreviousTerrainData(terrainData);  // เก็บข้อมูลเก่า
        setTerrainData(data);                 // อัพเดทข้อมูลใหม่
        setIsLoadingTerrain(false);
    }
}).catch(error => {
    console.error('Failed to load terrain:', error);
    if (active) {
        setIsLoadingTerrain(false);
        // Keep previous data on error - ไม่หาย!
    }
});
```

**ผลลัพธ์:**
- ✅ **ไม่มีหน้าจอว่าง** ขณะโหลดข้อมูลใหม่
- ✅ **แสดงข้อมูลเก่าต่อ** จนกว่าข้อมูลใหม่จะพร้อม
- ✅ **Smooth transition** ระหว่าง LOD levels

## การแก้ไขเพิ่มเติมที่แนะนำ

### 2. Tile Caching System (ยังไม่ได้ทำ)

**ปัญหา:**
- ทุกครั้งที่ pan หรือ zoom กลับมา ต้องโหลด tiles ซ้ำ
- Waste bandwidth และเวลา

**แนวทางแก้:**

```tsx
// สร้าง Tile Cache
const tileCache = useRef<Map<string, any>>(new Map());

const getCachedTile = (zoom: number, x: number, y: number) => {
    const key = `${zoom}/${x}/${y}`;
    return tileCache.current.get(key);
};

const cacheTile = (zoom: number, x: number, y: number, data: any) => {
    const key = `${zoom}/${x}/${y}`;
    tileCache.current.set(key, data);
    
    // Limit cache size (e.g., 100 tiles max)
    if (tileCache.current.size > 100) {
        const firstKey = tileCache.current.keys().next().value;
        tileCache.current.delete(firstKey);
    }
};
```

**ใน fetchTerrainTile:**
```tsx
// Check cache first
const cachedTile = getCachedTile(zoom, tileX, tileY);
if (cachedTile) {
    ctx.putImageData(cachedTile, tx * tileSize, ty * tileSize);
    resolve();
    return;
}

// Load and cache
img.onload = () => {
    ctx.drawImage(img, tx * tileSize, ty * tileSize);
    const tileData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize);
    cacheTile(zoom, tileX, tileY, tileData);
    resolve();
};
```

### 3. Debounce visibleBounds Update (ยังไม่ได้ทำ)

**ปัญหา:**
- เมื่อ pan visibleBounds เปลี่ยนทันที
- Trigger reload ทันที แม้จะ pan เล็กน้อย

**แนวทางแก้:**

```tsx
// เพิ่ม debounce
const visibleBoundsUpdateTimer = useRef<NodeJS.Timeout | null>(null);
const pendingVisibleBounds = useRef(TERRAIN_CONFIG.BOUNDS);

// ใน useFrame
if (zoomDiff >= 2) {
    // คำนวณ newVisibleBounds...
    
    // แทนที่จะ setVisibleBounds ทันที
    // ใช้ debounce
    pendingVisibleBounds.current = newVisibleBounds;
    
    if (visibleBoundsUpdateTimer.current) {
        clearTimeout(visibleBoundsUpdateTimer.current);
    }
    
    visibleBoundsUpdateTimer.current = setTimeout(() => {
        setVisibleBounds(pendingVisibleBounds.current);
    }, 500); // รอ 500ms หลัง pan หยุด
}
```

### 4. Multi-Resolution Texture (ยังไม่ได้ทำ)

**แนวคิด:**
- โหลด low-res texture ก่อน (zoom 14)
- แสดงทันที
- Background load high-res texture (zoom 19)
- Fade transition เมื่อพร้อม

```tsx
const [lowResTexture, setLowResTexture] = useState<THREE.Texture | null>(null);
const [highResTexture, setHighResTexture] = useState<THREE.Texture | null>(null);

// Load low-res first
useEffect(() => {
    loadBaseMap(Math.min(lodZoom, 14)).then(setLowResTexture);
}, [lodZoom]);

// Load high-res in background
useEffect(() => {
    if (lodZoom > 14) {
        setTimeout(() => {
            loadBaseMap(baseMapZoom).then(setHighResTexture);
        }, 100); // เริ่มโหลดหลัง 100ms
    }
}, [lodZoom, baseMapZoom]);

// Use high-res if available, otherwise low-res
const textureToUse = highResTexture || lowResTexture;
```

## สถานะปัจจุบัน

### ✅ ทำเสร็จแล้ว:
1. Progressive Loading - แสดงข้อมูลเก่าขณะโหลดใหม่
2. Error Handling - เก็บข้อมูลเก่าไว้เมื่อ error

### ❌ ยังไม่ได้ทำ (แต่แนะนำ):
1. Tile Caching - cache tiles ที่โหลดแล้ว
2. Debounce visibleBounds - ลด reload frequency
3. Multi-Resolution Texture - แสดง low-res ก่อน
4. Background Loading - โหลด high-res ใน background

## การทดสอบ

### ทดสอบ Progressive Loading:

1. **Zoom In** ใกล้ๆ
2. **Pan** ไปด้านข้าง
3. **สังเกต:**
   - ✅ ภาพเก่าควรยังแสดงอยู่ (ไม่หาย)
   - ✅ ภาพใหม่ค่อยๆ โหลดมาแทนที่
   - ✅ หาก error ภาพเก่ายังอยู่

### เปิด Console ดู:

```
DEM LOD Update: Zoom 16, Bounds: {...}
Loading X tiles (AxB) at zoom 16
```

**ถ้ายังช้า:**
- จำนวน tiles ยังมากเกินไป
- ควรเพิ่ม Tile Caching
- ควรเพิ่ม Debounce

## Performance Tips

### ปัจจุบัน (หลัง Progressive Loading):
- **เมื่อ Pan**: แสดงภาพเก่า → โหลดใหม่ → แสดงภาพใหม่
- **ระยะเวลา**: ~1-3 วินาที (ขึ้นอยู่กับจำนวน tiles)
- **UX**: ดีขึ้น แต่ยังไม่เพอร์เฟค

### เมื่อเพิ่ม Tile Caching:
- **เมื่อ Pan กลับ**: ดึงจาก cache → **ทันที!**
- **ระยะเวลา**: ~0.1 วินาที
- **UX**: Smooth มาก

### เมื่อเพิ่ม Multi-Res Texture:
- **เมื่อ Zoom In**: แสดง low-res ทันที → high-res ค่อยมา
- **ระยะเวลา**: Low-res ~0.5s, High-res ~2s
- **UX**: ดูราบรื่น ไม่ต้องรอ

## Next Steps

1. **ทดสอบ Progressive Loading** - ดูว่าช่วยได้หรือไม่
2. **ถ้ายังช้า** → เพิ่ม Tile Caching (priority สูง)
3. **ถ้า caching ช่วยได้** → เพิ่ม Debounce
4. **สุดท้าย** → Multi-Resolution Texture

## Date
2026-01-30

## Status
✅ Progressive Loading implemented
⏳ Tile Caching recommended but not yet implemented
⏳ Other optimizations pending based on user feedback
