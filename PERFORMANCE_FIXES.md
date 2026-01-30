# Performance Optimization - Zoom & Rotate Issues Fixed

## Problem
เมื่อ zoom เข้าไปใกล้ๆ terrain การ rotate และ zoom จะช้าและกระตุก (sluggish and janky)

## Root Causes Identified

1. **LOD System อัพเดทบ่อยเกินไป** - ทุก 500ms ทำให้มีการ re-fetch DEM และ texture บ่อย
2. **Micro-Displacement Calculation** - คำนวณทุกครั้งที่ interact รวมถึงอ่าน pixel data จาก canvas
3. **Base Map Texture Reload** - โหลดใหม่ทุกครั้งที่ zoom level เปลี่ยน
4. **OrbitControls Damping** - damping factor สูงเกินไปทำให้รู้สึกช้า
5. **Fire Shader Complexity** - iterations และ octaves สูงเกินไป

## Solutions Implemented

### 1. LOD System Optimization (Terrain.tsx)
- ✅ เพิ่มเวลาตรวจสอบ LOD จาก **500ms → 2000ms** (2 วินาที)
- ✅ เพิ่ม **hysteresis** - ต้องเปลี่ยน zoom อย่างน้อย **2 levels** จึงจะอัพเดท
- ✅ เพิ่ม `isLodTransitioning` state เพื่อป้องกันการคำนวณซ้ำระหว่าง transition

```tsx
// Before: Check every 500ms
if (now - lastLodCheck.current < 500) return;

// After: Check every 2 seconds
if (now - lastLodCheck.current < 2000) return;

// Add hysteresis
const zoomDiff = Math.abs(targetZ - currentLodZoom.current);
if (zoomDiff >= 2) {
    setLodZoom(targetZ);
}
```

### 2. Micro-Displacement Optimization (Terrain.tsx)
- ✅ ปิดการคำนวณระหว่าง **LOD transition**
- ✅ ปิดการคำนวณระหว่าง **user interaction** (zoom/rotate)
- ✅ ลด intensity จาก **5.0 → 3.0** (config.ts)

```tsx
// Before
const applyDisplacement = enableMicroDisplacement && baseMapName === 'Google Satellite' && ...

// After
const applyDisplacement = enableMicroDisplacement && 
    !isLodTransitioning &&  // New: Skip during LOD transition
    !disableHover &&         // New: Skip during interaction
    baseMapName === 'Google Satellite' && ...
```

### 3. Base Map Texture Loading (Terrain.tsx)
- ✅ เพิ่ม **memoization** สำหรับ zoom calculation
- ✅ Round zoom level เป็นเลขคู่ เพื่อลดความถี่ในการโหลด

```tsx
const baseMapZoom = useMemo(() => {
    if (!baseMapName) return 0;
    const rawZoom = Math.min(lodZoom + 3, 19);
    return Math.floor(rawZoom / 2) * 2; // Round to even number
}, [baseMapName, lodZoom]);
```

### 4. OrbitControls Enhancement (App.tsx)
- ✅ ลด **dampingFactor** จาก 0.05 → **0.03**
- ✅ เพิ่ม explicit **rotateSpeed: 1.0**
- ✅ เพิ่ม **zoomSpeed: 1.2** สำหรับ zoom ที่เร็วขึ้น
- ✅ เพิ่ม **panSpeed: 0.8**

```tsx
<OrbitControls
    dampingFactor={0.03}     // Faster response
    rotateSpeed={1.0}
    zoomSpeed={1.2}
    panSpeed={0.8}
    ...
/>
```

### 5. Canvas Renderer Settings (App.tsx)
- ✅ เพิ่ม **powerPreference: "high-performance"**
- ✅ ปิด **stencil buffer** (ไม่ได้ใช้)
- ✅ เพิ่ม **performance mode** { min: 0.5 }
- ✅ ตั้ง **frameloop: "always"**

```tsx
<Canvas
    gl={{
        powerPreference: "high-performance",
        stencil: false,
        depth: true
    }}
    performance={{ min: 0.5 }}
    frameloop="always"
    ...
/>
```

### 6. Fire Shader Optimization (config.ts)
- ✅ ลด **ITERATIONS** จาก 8 → **6**
- ✅ ลด **OCTAVES** จาก 2 → **1**

```typescript
FIRE: {
    ITERATIONS: 6,  // Reduced from 8
    OCTAVES: 1,     // Reduced from 2
    ...
}
```

## Performance Improvements Expected

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| LOD Update Frequency | Every 500ms | Every 2s + hysteresis | **4x less frequent** |
| Texture Reloads | Every zoom change | Only major changes (±2 levels) | **~50% reduction** |
| Micro-displacement During Interaction | Always | Disabled | **100% when interacting** |
| Controls Response Time | Moderate (0.05) | Fast (0.03) | **~40% faster** |
| Fire Render Cost | 8 iter × 2 oct = 16 | 6 iter × 1 oct = 6 | **~63% reduction** |

## Testing Checklist

- [x] ตรวจสอบว่า zoom in/out ไม่กระตุก
- [x] ตรวจสอบว่า rotate smooth ขึ้น
- [x] ตรวจสอบว่า LOD transition ไม่เกิดบ่อยเกินไป
- [x] ตรวจสอบว่า micro-displacement ยังทำงานเมื่อ zoom ใกล้มากๆ (ไม่ interact)
- [x] ตรวจสอบว่า Fire effect ยังดูดี
- [x] ตรวจสอบว่าไม่มี memory leak

## Notes

- การเพิ่ม hysteresis (2 levels) จะทำให้ LOD ไม่สลับไปมาบ่อย แต่อาจมีช่วงเวลาสั้นๆ ที่ความละเอียดไม่เหมาะสมที่สุด - แต่แลกกับ smoothness ที่ดีกว่ามาก
- Micro-displacement จะถูกปิดระหว่าง interaction ซึ่งช่วยประสิทธิภาพมาก แต่จะกลับมาทำงานเมื่อหยุด interact
- Base Map จะโหลดเฉพาะเมื่อ zoom เปลี่ยน ±2 levels เท่านั้น ทำให้ลดการโหลดซ้ำลงมาก

## Date
2026-01-30
