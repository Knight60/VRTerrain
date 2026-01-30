# แก้ไขปัญหาหน้าจอมืด

## ปัญหา
หน้าจอเป็นสีปกติแล้วมืดลงทั้งจอทันทีเลย

## สาเหตุที่เป็นไปได้

### 1. Compile Errors จาก visibleBounds ✅ แก้ไขแล้ว
- **แก้ไข**: ลบ visibleBounds references ทั้งหมดออกแล้ว
- ตอนนี้ใช้ `TERRAIN_CONFIG.BOUNDS` แทนทุกที่

### 2. Terrain Data ไม่ถูกโหลด
ตรวจสอบใน **Browser Console (F12)**:

```
DEM LOD Update: Zoom X, using full TERRAIN_CONFIG.BOUNDS
Loading X tiles (AxB) at zoom Z
```

**ถ้าไม่เห็น:** terrainData ไม่ถูกโหลด

### 3. Geometry Rendering มีปัญหา
ตรวจสอบว่า `terrainData` มีค่าหรือไม่:
```tsx
if (!terrainData) return null; // ถ้า true = ไม่แสดงอะไร
```

### 4. Progressive Loading Bug
เช็คว่า `previousTerrainData` และ `terrainData` มีค่าหรือไม่

## วิธีแก้ไข

### ขั้นตอนที่ 1: เปิด Browser Console (F12)

ดูว่ามี errors อะไร:
- ❌ `Cannot find name 'visibleBounds'` → แก้ไขแล้ว
- ❌ `Failed to load terrain` → ปัญหา network หรือ CORS
- ❌ อื่นๆ

### ขั้นตอนที่ 2: ตรวจสอบ Logs

**ควรเห็น:**
```
DEM LOD Update: Zoom 12, using full TERRAIN_CONFIG.BOUNDS
Loading X tiles (AxB) at zoom 12
```

**ถ้าไม่เห็น:** useEffect ไม่ทำงาน

### ขั้นตอนที่ 3: Hard Refresh

กด **Ctrl + Shift + R** (Windows) หรือ **Cmd + Shift + R** (Mac)
เพื่อ clear cache และ reload

### ขั้นตอนที่ 4: ตรวจสอบ Network Tab

1. เปิด **DevTools → Network**
2. Filter: **Img** หรือ **All**
3. Reload หน้า
4. ดูว่า tiles กำลังโหลดหรือไม่

**ถ้าไม่เห็น tiles loading:** 
- useEffect ไม่ trigger
- หรือ fetchTerrainTile มีปัญหา

## สิ่งที่แก้ไขไปแล้ว

### ✅ Terrain.tsx - แก้ไข visibleBounds (Line 400-424)
```tsx
// เปลี่ยนจาก
fetchTerrainTile(lodZoom, visibleBounds)
}, [lodZoom, visibleBounds]);

// เป็น
fetchTerrainTile(lodZoom, TERRAIN_CONFIG.BOUNDS)
}, [lodZoom]); // ✅ แก้แล้ว
```

### ✅ Terrain.tsx - แก้ไข UV Mapping (Line 329-334)
```tsx
// ลบ visibleBounds UV mapping ที่ซับซ้อน
// ใช้ simple mapping แทน
texture.offset.set(uMin, 1 - vMax);
texture.repeat.set(uMax - uMin, vMax - vMin);
```

### ✅ Terrain.tsx - แก้ไข Console Log
```tsx
// เปลี่ยนจาก
console.log(`... Bounds: ${JSON.stringify(visibleBounds)}`);

// เป็น
console.log(`... using full TERRAIN_CONFIG.BOUNDS`);
```

## Debugging Commands

### 1. ใน Browser Console ลองพิมพ์:

```javascript
// ตรวจสอบว่า Three.js scene มี objects หรือไม่
console.log(document.querySelector('canvas'))

// ดู errors ทั้งหมด
console.error('Test error - can you see this?')
```

### 2. Temporary Debug - เพิ่มใน Terrain.tsx

```tsx
// หลัง fetchTerrainTile
console.log('✅ Terrain data loaded:', data.width, 'x', data.height);

// ใน render
console.log('🎨 Rendering terrain:', !!terrainData);
```

## คำแนะนำ

### ถ้ายังมืดอยู่:

1. **ลองปิด Progressive Loading ชั่วคราว:**
   ```tsx
   // Comment out
   // setPreviousTerrainData(terrainData);
   
   // และดูว่าโหลดไหม
   ```

2. **ตรวจสอบ TERRAIN_CONFIG.BOUNDS:**
   ```tsx
   console.log('BOUNDS:', TERRAIN_CONFIG.BOUNDS);
   ```
   
   ถ้า bounds ผิด → tiles โหลดผิด → ไม่มีข้อมูล → จอมืด

3. **Rollback:**
   ถ้าจำเป็น ให้ใช้ git:
   ```bash
   git status
   git diff src/components/Terrain.tsx
   # ถ้าต้องการ rollback
   git checkout src/components/Terrain.tsx
   ```

## สรุป

### การแก้ไขที่ทำไปแล้ว:
✅ ลบ `visibleBounds` references ทั้งหมด  
✅ ใช้ `TERRAIN_CONFIG.BOUNDS` แทน  
✅ แก้ dependencies ใน useEffect  
✅ แก้ UV mapping ให้เรียบง่าย  

### ขั้นตอนถัดไป:
1. **เปิด Browser Console** → ดู errors
2. **Hard Refresh** (Ctrl+Shift+R)
3. **ดู Network Tab** → ตรวจสอบ tiles loading
4. **รายงานผล:** บอกว่าเห็น error อะไรหรือไม่

## Date
2026-01-30
