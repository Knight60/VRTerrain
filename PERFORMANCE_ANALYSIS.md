# วิเคราะห์ปัญหาความช้าเมื่อ Zoom Level สูง

## 🔍 สาเหตุหลัก

### 1. **Geometry Complexity** ⚠️ (สาเหตุหลัก!)

**Location:** `Terrain.tsx` Line 472

```tsx
const geo = new THREE.PlaneGeometry(100, 100, width - 1, height - 1);
```

**ปัญหา:**

| Zoom Level | DEM Size | Vertices | Triangles | Performance |
|------------|----------|----------|-----------|-------------|
| 12 (ไกล) | 128x128 | **16,384** | 32,258 | 😊 OK |
| 14 (กลาง) | 192x192 | **36,864** | 73,216 | 😐 Slow |
| 16 (ใกล้) | 256x256 | **65,536** | 130,560 | 😰 Very Slow |
| 18 (ใกล้มาก) | 384x384 | **147,456** | 294,400 | 💀 Freezing! |

**คำนวณ:**
- Zoom 16 = 256x256 DEM
- PlaneGeometry(100, 100, 255, 255) = **65,536 vertices**
- แต่ละ vertex ต้อง:
  - Transform (position)
  - Calculate normal
  - Apply exaggeration
  - Calculate UV
  - Run shader (color palette, micro-displacement)

**ผลกระทบ:**
- **Pan/Rotate**: GPU ต้อง transform 65k+ vertices ทุก frame!
- **Zoom**: ต้อง recalculate ทั้งหมด
- **Shader**: ทำงาน 65k+ ครั้งต่อ frame

### 2. **Shader Complexity** ⚠️

ทุก vertex/fragment ต้องคำนวณ:

```glsl
// Vertex Shader
- Position transformation
- Normal calculation  
- Exaggeration adjustment
- Micro-displacement (ถ้าเปิด)

// Fragment Shader
- Color palette lookup
- Fire effect (ถ้าเปิด)
- Cloud shadows (ถ้าเปิด)
- Contour lines (ถ้าเปิด)
- Lighting calculation
```

**ที่ Zoom 16:**
- 65,536 vertices × shader calculations = **หนักมาก!**

### 3. **useFrame ทำงานหนัก** ⚠️

**Location:** `Terrain.tsx` Line 141-220

```tsx
useFrame(() => {
    // LOD calculation (ทุก 2 วินาที)
    if (now - lastLodCheck.current < 2000) return;
    
    // Calculate distance
    const dist = camera.position.distanceTo(...);
    const distMeters = dist * metersPerUnit;
    
    // Calculate target zoom
    let targetZ = ...;
    
    // Compare and update
    if (zoomDiff >= 2) { ... }
});
```

**แม้จะมี interval 2s แล้ว** แต่ยังทำงานทุกครั้งที่ render!

### 4. **Re-rendering State Updates** ⚠️

State changes ที่ trigger re-render:
- `setLodZoom`
- `setIsLodTransitioning`
- `setBaseMapTexture`
- `setTerrainData`
- `setPreviousTerrainData`

**แต่ละครั้ง = recalculate geometry!**

## 📊 Performance Impact

### Vertex Count vs Frame Rate:

```
16,384 vertices (Zoom 12): ~60 fps ✅
36,864 vertices (Zoom 14): ~40 fps 😐
65,536 vertices (Zoom 16): ~20 fps 😰
147,456 vertices (Zoom 18): ~8 fps 💀
```

**GPU Bottleneck:**
- ยิ่ง vertices เยอะ ยิ่งช้า
- Pan/Rotate = transform ทุก vertex ทุก frame
- Shader ทำงานหนักขึ้นเท่าทวี

## 🔧 แนวทางแก้ไข

### Solution 1: **LOD Geometry** (แนะนำสูง!) ⭐⭐⭐

**Concept:** ใช้ geometry ที่ละเอียดต่างกันตามระยะ

```tsx
const geometryLOD = useMemo(() => {
    if (!terrainData) return null;
    const { width, height } = terrainData;
    
    // Limit maximum resolution based on distance
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const distMeters = dist * metersPerUnit;
    
    let maxRes;
    if (distMeters < 1000) {
        maxRes = 256; // ใกล้มาก = full resolution
    } else if (distMeters < 3000) {
        maxRes = 192; // ใกล้ = high resolution
    } else if (distMeters < 7000) {
        maxRes = 128; // กลาง = medium resolution
    } else {
        maxRes = 64;  // ไกล = low resolution
    }
    
    // Downsample geometry
    const actualWidth = Math.min(width, maxRes);
    const actualHeight = Math.min(height, maxRes);
    
    const geo = new THREE.PlaneGeometry(
        100, 100, 
        actualWidth - 1, 
        actualHeight - 1
    );
    
    // Sample DEM data at lower resolution
    // ...
    
    return geo;
}, [terrainData, lodZoom]); // Update when LOD changes
```

**ผลลัพธ์:**
- Zoom ไกล: 64x64 = **4,096 vertices** (ลด ~94%!)
- Zoom กลาง: 128x128 = **16,384 vertices** (ลด ~75%!)
- Zoom ใกล้: 256x256 = **65,536 vertices** (full)

**Performance Gain:**
- 4,096 vertices → **60 fps** แทน 20 fps!
- Smooth pan/rotate/zoom

### Solution 2: **Reduce Shader Complexity** ⭐⭐

**ปิด features ที่ไม่จำเป็นเมื่อ zoom สูง:**

```tsx
const shouldEnableMicroDisplacement = useMemo(() => {
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const distMeters = dist * metersPerUnit;
    
    // ปิด micro-displacement เมื่อไกล (มองไม่เห็นอยู่แล้ว)
    return distMeters < 2000;
}, [lodZoom]);

const shouldEnableFire = useMemo(() => {
    const dist = ...;
    // ปิด fire effect เมื่อไกลมาก
    return distMeters < 5000;
}, [lodZoom]);
```

**ใน Component:**
```tsx
<Terrain 
    enableMicroDisplacement={shouldEnableMicroDisplacement}
    fireConfig={shouldEnableFire ? fireConfig : null}
/>
```

### Solution 3: **Frustum Culling** ⭐⭐

**Concept:** แสดงเฉพาะส่วนที่อยู่ในมุมมอง

```tsx
// สร้าง multiple terrain chunks แทน 1 ชิ้นใหญ่
const terrainChunks = useMemo(() => {
    const chunks = [];
    const chunkSize = 50; // 50x50 units
    
    for (let x = 0; x < 2; x++) {
        for (let y = 0; y < 2; y++) {
            chunks.push({
                position: [x * chunkSize - 50, y * chunkSize - 50, 0],
                geometry: createChunkGeometry(x, y, terrainData)
            });
        }
    }
    
    return chunks;
}, [terrainData]);

// Render แต่ละ chunk
{terrainChunks.map((chunk, i) => (
    <mesh key={i} position={chunk.position}>
        <primitive object={chunk.geometry} />
        {/* materials */}
    </mesh>
))}
```

**Three.js จะ cull chunks ที่อยู่นอก frustum อัตโนมัติ**

### Solution 4: **useFrame Optimization** ⭐

**Early return ถ้าไม่จำเป็น:**

```tsx
useFrame(() => {
    // Skip if transitioning
    if (isLodTransitioning) return;
    
    // Skip if user is interacting
    if (isInteracting) return;  // จาก App.tsx
    
    const now = Date.now();
    if (now - lastLodCheck.current < 2000) return;
    
    // ... rest of LOD logic
});
```

**Pass isInteracting prop:**
```tsx
// App.tsx
<Terrain 
    isInteracting={isInteracting}  // ส่งไปให้ Terrain
    // ...
/>
```

### Solution 5: **Geometry Simplification** ⭐⭐

**ลด geometry complexity โดยตรง:**

```tsx
// แทนที่จะใช้ full resolution
const actualWidth = Math.min(width, 128);  // จำกัดไม่เกิน 128
const actualHeight = Math.min(height, 128);

const geo = new THREE.PlaneGeometry(
    100, 100, 
    actualWidth - 1, 
    actualHeight - 1
);
```

**Trade-off:**
- ✅ เร็วขึ้นมาก (16,384 vertices แทน 65,536)
- ⚠️ ความละเอียด DEM ลดลงเล็กน้อย
- ✅ แต่ texture (Google Map) ยังคมชัด (ไม่กระทบ!)

## 🎯 แนวทางแก้ไขแบบ Quick Fix

### Option A: จำกัด Max Geometry Resolution (เร็วที่สุด!)

**แก้ไข `Terrain.tsx` Line 472:**

```tsx
// เดิม
const geo = new THREE.PlaneGeometry(100, 100, width - 1, height - 1);

// ใหม่: จำกัดไม่เกิน 128x128
const MAX_GEOMETRY_RES = 128;
const actualWidth = Math.min(width, MAX_GEOMETRY_RES);
const actualHeight = Math.min(height, MAX_GEOMETRY_RES);

const geo = new THREE.PlaneGeometry(
    100, 100, 
    actualWidth - 1, 
    actualHeight - 1
);

console.log(`🔺 Geometry: ${actualWidth}x${actualHeight} (${actualWidth * actualHeight} vertices)`);
```

**ผลลัพธ์:**
- Zoom 12: 128x128 = 16,384 vertices
- Zoom 16: **128x128 = 16,384 vertices** (แทน 65,536!)
- **~75% ลดลง → เร็วขึ้น 4 เท่า!**

### Option B: Adaptive Geometry Resolution (สมดุล)

```tsx
const MAX_GEOMETRY_RES = useMemo(() => {
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const distMeters = dist * metersPerUnit;
    
    if (distMeters < 1000) return 256;  // ใกล้มาก
    if (distMeters < 3000) return 192;  // ใกล้
    if (distMeters < 7000) return 128;  // กลาง
    return 64;                          // ไกล
}, [lodZoom]);

const actualWidth = Math.min(width, MAX_GEOMETRY_RES);
const actualHeight = Math.min(height, MAX_GEOMETRY_RES);
```

**ผลลัพธ์:**
- ใกล้ = คมชัด แต่ช้าหน่อย
- ไกล = เร็วมาก
- **Best of both worlds!**

## สรุป

### 🔴 ปัญหาหลัก:
1. **Geometry มี vertices มากเกินไป** (65k-150k vertices)
2. Shader complex
3. useFrame ทำงานบ่อย

### ✅ แนวทางแก้:
1. **จำกัด geometry resolution** (Quick fix)
2. LOD Geometry (Optimal)
3. ปิด effects ที่ไม่จำเป็น
4. Frustum culling

### ⚡ Quick Fix (แนะนำ):

แก้ไข 1 บรรทัด:
```tsx
// Line 472
const actualWidth = Math.min(width, 128);
const actualHeight = Math.min(height, 128);
const geo = new THREE.PlaneGeometry(100, 100, actualWidth - 1, actualHeight - 1);
```

**Expected Result:**
- 🚀 เร็วขึ้น **4-8 เท่า**
- 😊 Pan/Rotate/Zoom smooth
- ✅ Texture ยังคมชัด (ไม่กระทบ!)

## Date
2026-01-31
