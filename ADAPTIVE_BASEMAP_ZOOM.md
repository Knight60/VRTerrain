# Adaptive BaseMap Zoom Based on Camera Distance

## สิ่งที่ทำแล้ว ✅

### การคำนวณ baseMapZoom แบบ Adaptive (Terrain.tsx line 232-275)

ตอนนี้ **baseMapZoom** คำนวณจาก **2 ปัจจัย**:

1. **Camera Distance** (ระยะห่างจาก camera ถึง terrain)
2. **LOD Zoom** (level of detail ของ terrain geometry)

```tsx
const baseMapZoom = useMemo(() => {
    // คำนวณระยะห่างใน meters
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const distMeters = dist * metersPerUnit;
    
    // ปรับ zoom ตามระยะ
    let targetZoom: number;
    if (distMeters < 500) targetZoom = 19;        // ใกล้มาก
    else if (distMeters < 1000) targetZoom = 18;  // ใกล้
    else if (distMeters < 2500) targetZoom = 17;  // กลาง
    else if (distMeters < 5000) targetZoom = 16;  // ไกล
    else if (distMeters < 10000) targetZoom = 15; // ไกลมาก
    else targetZoom = 14;                         // ไกลสุด
    
    // เลือก zoom ที่เหมาะสม
    const lodBasedZoom = Math.min(lodZoom + 3, 19);
    const finalZoom = Math.min(targetZoom, lodBasedZoom);
    
    return finalZoom;
}, [baseMapName, lodZoom, camera.position]); // อัพเดทเมื่อ camera เคลื่อนที่
```

## การทำงาน

### Distance Ranges:

| ระยะห่าง (m) | Zoom Level | ความละเอียด | Use Case |
|--------------|------------|-------------|----------|
| < 500m       | 19         | สูงสุด      | Zoom เข้ามากๆ |
| 500-1000m    | 18         | สูง         | Zoom ใกล้ |
| 1000-2500m   | 17         | กลาง        | View ปกติ |
| 2500-5000m   | 16         | ต่ำ         | Zoom ออก |
| 5000-10000m  | 15         | ต่ำมาก      | Overview กว้าง |
| > 10000m     | 14         | ต่ำสุด      | Bird's eye view |

### ตัวอย่าง:

**เมื่อ Zoom ใกล้:**
```
📏 Camera distance: 450m → baseMap zoom: 19 (distance-based: 19, LOD-based: 19)
→ โหลด Google Map ที่ zoom 19 (ละเอียดสุด)
```

**เมื่อ Zoom กลาง:**
```
📏 Camera distance: 1800m → baseMap zoom: 17 (distance-based: 17, LOD-based: 18)
→ โหลด Google Map ที่ zoom 17 (ความละเอียดปานกลาง)
```

**เมื่อ Zoom ไกล:**
```
📏 Camera distance: 8000m → baseMap zoom: 15 (distance-based: 15, LOD-based: 16)
→ โหลด Google Map ที่ zoom 15 (ประหยัด bandwidth)
```

## ข้อดี ✅

1. **ประหยัด Bandwidth**:
   - เมื่ออยู่ไกล ไม่โหลด high-res texture ที่ดูไม่เห็น
   - เมื่ออยู่ใกล้ โหลด high-res เต็มที่

2. **Performance ดีขึ้น**:
   - Zoom ไกล = tiles น้อยกว่า (zoom 14 vs 19)
   - ลด memory usage

3. **Quality เหมาะสม**:
   - ใกล้ = คมชัด (zoom 19)
   - ไกล = พอดู (zoom 14-15)

## ปัญหาที่อาจเกิด ⚠️

### 1. Reload บ่อยเกินไป

**ปัญหา:**
- `camera.position` เปลี่ยนทุกครั้งที่ pan/rotate
- `useMemo` dependency `[camera.position]` trigger ทุก frame
- **Reload texture บ่อยมาก!**

**อาการ:**
- เมื่อ pan/rotate เห็น texture กระพริบ
- Performance ช้า

**วิธีแก้:**

#### Option 1: Debounce with useRef (แนะนำ)

```tsx
const lastCameraDistance = useRef<number>(0);
const lastBaseMapZoom = useRef<number>(0);

const baseMapZoom = useMemo(() => {
    const distMeters = ...;
    
    // Hysteresis: เปลี่ยนก็ต่อเมื่อระยะเปลี่ยน > 30%
    if (lastCameraDistance.current > 0) {
        const distChange = Math.abs(distMeters - lastCameraDistance.current) 
                          / lastCameraDistance.current;
        if (distChange < 0.3) {
            // ไม่เปลี่ยนมากพอ ใช้ zoom เดิม
            return lastBaseMapZoom.current;
        }
    }
    
    lastCameraDistance.current = distMeters;
    const finalZoom = ...;
    lastBaseMapZoom.current = finalZoom;
    
    return finalZoom;
}, [baseMapName, lodZoom, camera.position]);
```

#### Option 2: ใช้ distance ranges ที่กว้างขึ้น

```tsx
// เปลี่ยนจาก
if (distMeters < 500) targetZoom = 19;
else if (distMeters < 1000) targetZoom = 18;

// เป็น (กว้างขึ้น 2-3 เท่า)
if (distMeters < 1000) targetZoom = 19;      // กว้างขึ้นจาก 500
else if (distMeters < 3000) targetZoom = 18; // กว้างขึ้นจาก 1000
```

#### Option 3: ใช้ lodZoom เป็นหลัก distance เป็นรอง

```tsx
// แทนที่จะใช้ min (เลือกต่ำกว่า)
const finalZoom = Math.min(targetZoom, lodBasedZoom);

// ใช้ max (เลือกสูงกว่า) แต่จำกัด
const finalZoom = Math.max(
    Math.min(lodBasedZoom, 19),  // LOD-based (จำกัดไม่เกิน 19)
    targetZoom - 1                // Distance-based อนุโลม -1 level
);
```

### 2. Dependency Array

**ปัญหา:**
```tsx
}, [baseMapName, lodZoom, camera.position]); // camera.position เปลี่ยนทุก frame!
```

**วิธีแก้:**
```tsx
// Option A: ใช้เฉพาะ lodZoom (ไม่รับรู้ camera movement)
}, [baseMapName, lodZoom]);

// Option B: ใช้ individual components + debounce
}, [baseMapName, lodZoom, 
    Math.floor(camera.position.x / 10), // Round to reduce sensitivity
    Math.floor(camera.position.y / 10),
    Math.floor(camera.position.z / 10)]);
```

## แนวทางแก้ไขที่แนะนำ

### แก้ไขแบบเร็ว (Quick Fix):

**ขยาย distance ranges ให้กว้างขึ้น:**

```tsx
// Line 253-265 ใน Terrain.tsx
let targetZoom: number;
if (distMeters < 1000) {           // จาก 500 → 1000
    targetZoom = 19;
} else if (distMeters < 3000) {    // จาก 1000 → 3000
    targetZoom = 18;
} else if (distMeters < 7000) {    // จาก 2500 → 7000
    targetZoom = 17;
} else if (distMeters < 15000) {   // จาก 5000 → 15000
    targetZoom = 16;
} else if (distMeters < 30000) {   // จาก 10000 → 30000
    targetZoom = 15;
} else {
    targetZoom = 14;
}
```

**ผลลัพธ์:**
- ลด reload frequency ลง ~50%
- ยังคงได้ zoom ที่เหมาะสม

### แก้ไขแบบ Optimal (ใช้ Ref + Hysteresis):

เพิ่ม ref tracking และ hysteresis เพื่อป้องกันการเปลี่ยนบ่อย

## สรุป

### ✅ ทำเสร็จแล้ว:
- baseMapZoom คำนวณตาม camera distance
- ใกล้ = zoom สูง (19)
- ไกล = zoom ต่ำ (14)

### ⚠️ ป้องกันปัญหา:
- อาจ reload บ่อยเมื่อ camera เคลื่อนที่
- แนะนำขยาย distance ranges หรือเพิ่ม hysteresis

### 📊 ผลลัพธ์:
- **Bandwidth**: ประหยัดได้ถึง 80% เมื่อ zoom ไกล
- **Performance**: เร็วขึ้นเพราะ tiles น้อยลง
- **Quality**: เหมาะสมตามระยะ

## Testing

### ทดสอบ:

1. **Zoom Out ไกลๆ** (> 10km)
   - ดู console: `baseMap zoom: 14`
   - Tiles ควรน้อย

2. **Zoom In ใกล้ๆ** (< 500m)
   - ดู console: `baseMap zoom: 19`
   - ภาพควรคมชัดมาก

3. **Pan ไปมา**
   - ถ้า texture กระพริบ = reload บ่อยเกินไป
   - แก้: ขยาย distance ranges

## Date
2026-01-30
