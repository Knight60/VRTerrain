import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fetchTerrainTile } from '../utils/terrain';
import { TERRAIN_CONFIG } from '../config';

interface TerrainProps {
    shape: 'rectangle' | 'ellipse';
    exaggeration: number;
    paletteColors: string[];
}

// Helper to convert hex to rgb
const hexToRgb = (hex: string) => {
    // Match first 6 hex digits (ignore alpha if present)
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 };
};

// Helper to interpolate between colors
const getColorFromScale = (t: number, colors: string[]) => {
    if (t <= 0) {
        const c = hexToRgb(colors[0]);
        return [c.r, c.g, c.b];
    }
    if (t >= 1) {
        const c = hexToRgb(colors[colors.length - 1]);
        return [c.r, c.g, c.b];
    }

    // Map t to segment
    const segmentCount = colors.length - 1;
    const index = t * segmentCount;
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(lowerIndex + 1, colors.length - 1);
    const factor = index - lowerIndex;

    const c1 = hexToRgb(colors[lowerIndex]);
    const c2 = hexToRgb(colors[upperIndex]);

    return [
        c1.r + (c2.r - c1.r) * factor,
        c1.g + (c2.g - c1.g) * factor,
        c1.b + (c2.b - c1.b) * factor
    ];
};

const createSedimentTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Create layered soil pattern
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    // Add random stops for "layers"
    gradient.addColorStop(0, '#594433');   // Dark soil top
    gradient.addColorStop(0.1, '#7a5c40');
    gradient.addColorStop(0.2, '#594433');
    gradient.addColorStop(0.3, '#A0522D'); // Sienna
    gradient.addColorStop(0.4, '#8B4513'); // SaddleBrown
    gradient.addColorStop(0.5, '#CD853F'); // Peru
    gradient.addColorStop(0.6, '#DEB887'); // Burlywood
    gradient.addColorStop(0.7, '#D2691E'); // Chocolate
    gradient.addColorStop(0.8, '#8B4513');
    gradient.addColorStop(0.9, '#634735');
    gradient.addColorStop(1, '#2F2018');   // Bedrock

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping; // Stretch vertically
    return tex;
};

export const Terrain: React.FC<TerrainProps & { onHeightRangeChange?: (min: number, max: number) => void }> = ({ shape, exaggeration = 100, paletteColors, onHeightRangeChange }) => {
    const [terrainData, setTerrainData] = useState<{ width: number; height: number; data: Float32Array; minHeight: number; maxHeight: number } | null>(null);
    const meshRef = useRef<THREE.Group>(null);
    const sedimentTexture = useMemo(() => createSedimentTexture(), []);

    useEffect(() => {
        // Zoom 14 captures a bit more context, Zoom 15 is finer.
        fetchTerrainTile(15).then(setTerrainData).catch(console.error);
    }, []);

    // Calculate visible range based on shape
    const visibleRange = useMemo(() => {
        if (!terrainData) return null;
        const { width, height, data, minHeight, maxHeight } = terrainData;

        if (shape === 'rectangle') {
            return { min: minHeight, max: maxHeight };
        }

        // For ellipse, we must scan
        let min = Infinity;
        let max = -Infinity;
        let hasVisible = false;

        for (let i = 0; i < data.length; i++) {
            const ix = i % width;
            const iy = Math.floor(i / width);

            // Normalize to -1..1
            const nx = (ix / (width - 1)) * 2 - 1;
            const ny = (iy / (height - 1)) * 2 - 1;

            if (nx * nx + ny * ny <= 1.0) {
                const val = data[i];
                if (val < min) min = val;
                if (val > max) max = val;
                hasVisible = true;
            }
        }

        return hasVisible ? { min, max } : { min: minHeight, max: maxHeight };
    }, [terrainData, shape]);

    useEffect(() => {
        if (visibleRange && onHeightRangeChange) {
            onHeightRangeChange(visibleRange.min, visibleRange.max);
        }
    }, [visibleRange, onHeightRangeChange]);

    const { topGeometry, sideGeometries } = useMemo(() => {
        if (!terrainData || !visibleRange) return { topGeometry: null, sideGeometries: [] };
        const { width, height, data, minHeight } = terrainData;
        const { min: visibleMin, max: visibleMax } = visibleRange;

        // --- Top Surface ---
        const geo = new THREE.PlaneGeometry(100, 100, width - 1, height - 1);
        const count = geo.attributes.position.count;
        const arr = geo.attributes.position.array;
        const colors: number[] = [];

        const heightRange = visibleMax - visibleMin || 1;
        const baseMultiplier = 0.15;
        const currentMultiplier = baseMultiplier * (exaggeration / 100);

        for (let i = 0; i < count; i++) {
            const rawHeight = data[i] || minHeight;
            const relativeHeight = rawHeight - minHeight;
            arr[i * 3 + 2] = relativeHeight * currentMultiplier;

            const hRaw = rawHeight;
            const hNormalized = (hRaw - visibleMin) / heightRange;
            const h = Math.min(Math.max(hNormalized, 0), 1);

            const safePalette = paletteColors && paletteColors.length > 0 ? paletteColors : ['#000000', '#ffffff'];
            const [r, g, b] = getColorFromScale(h, safePalette);
            colors.push(r, g, b);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        // --- Side Walls (Rectangle Only) ---
        const sides: THREE.BufferGeometry[] = [];
        if (shape === 'rectangle') {
            const baseDepth = -TERRAIN_CONFIG.SOIL_DEPTH_METERS * currentMultiplier;
            const halfSize = 50;

            const generateWall = (edge: 'N' | 'S' | 'W' | 'E') => {
                const isHorizontal = edge === 'N' || edge === 'S';
                const segmentCount = isHorizontal ? width - 1 : height - 1;

                const positions = new Float32Array(segmentCount * 6 * 3); // 6 vertices per quad, 3 components per vertex
                const uvs = new Float32Array(segmentCount * 6 * 2);       // 6 vertices per quad, 2 components per UV
                const normals = new Float32Array(segmentCount * 6 * 3);  // 6 vertices per quad, 3 components per normal

                const stepX = 100 / (width - 1);
                const stepY = 100 / (height - 1);

                let idx = 0; // Index for the positions, uvs, normals arrays

                // Determine normal direction for the wall
                const nx = edge === 'W' ? -1 : (edge === 'E' ? 1 : 0);
                const ny = edge === 'N' ? 1 : (edge === 'S' ? -1 : 0);
                const nz = 0; // Normals are in XY plane (local to group, which is world XY after rotation)

                // Helper to get coordinates and height for a point along the edge
                const getProps = (k: number) => {
                    let x = 0, y = 0, hIndex = 0;
                    if (edge === 'N') { // North edge (top row of data, y = +50)
                        x = -halfSize + k * stepX;
                        y = halfSize;
                        hIndex = k; // Row 0
                    } else if (edge === 'S') { // South edge (bottom row of data, y = -50)
                        x = -halfSize + k * stepX;
                        y = -halfSize;
                        hIndex = (height - 1) * width + k; // Row Max
                    } else if (edge === 'W') { // West edge (left column of data, x = -50)
                        x = -halfSize;
                        y = halfSize - k * stepY; // Iterate from top (N) to bottom (S)
                        hIndex = k * width; // Col 0, Row k
                    } else if (edge === 'E') { // East edge (right column of data, x = +50)
                        x = halfSize;
                        y = halfSize - k * stepY; // Iterate from top (N) to bottom (S)
                        hIndex = k * width + (width - 1); // Col Max, Row k
                    }

                    const rawH = data[hIndex] || minHeight;
                    const z = (rawH - minHeight) * currentMultiplier;
                    return { x, y, z };
                };

                // Helper to push a vertex's data
                const pushVert = (v: { x: number, y: number, z: number }, u: number, v_coord: number) => {
                    positions[idx * 3] = v.x;
                    positions[idx * 3 + 1] = v.y;
                    positions[idx * 3 + 2] = v.z;

                    normals[idx * 3] = nx;
                    normals[idx * 3 + 1] = ny;
                    normals[idx * 3 + 2] = nz;

                    uvs[idx * 2] = u;
                    uvs[idx * 2 + 1] = v_coord; // V=0 at top, V=1 at bottom for texture

                    idx++;
                };

                for (let i = 0; i < segmentCount; i++) {
                    const p1 = getProps(i);     // Current point on the top edge
                    const p2 = getProps(i + 1);   // Next point on the top edge

                    // Define the four corners of the quad for this segment
                    const TL = { x: p1.x, y: p1.y, z: p1.z };         // Top-Left (current segment's top)
                    const BL = { x: p1.x, y: p1.y, z: baseDepth };    // Bottom-Left (current segment's base)
                    const TR = { x: p2.x, y: p2.y, z: p2.z };         // Top-Right (next segment's top)
                    const BR = { x: p2.x, y: p2.y, z: baseDepth };    // Bottom-Right (next segment's base)

                    // UV mapping for horizontal (U) and vertical (V) texture coordinates
                    const u1 = i / segmentCount;
                    const u2 = (i + 1) / segmentCount;

                    // Vertices for the two triangles forming the quad
                    // Winding order is crucial for correct face culling and normal direction.
                    // We want the normal to point outwards from the terrain block.
                    // The group is rotated [-Math.PI / 2, 0, 0], so local Y is world Z, local Z is world -Y.
                    // The normals (nx, ny, nz) are defined in the group's local XY plane.
                    // After group rotation, (nx, ny, 0) becomes (nx, 0, ny) in world space.
                    // So, for North wall (ny=1), normal is (0,0,1) in world Z.
                    // For South wall (ny=-1), normal is (0,0,-1) in world Z.
                    // For West wall (nx=-1), normal is (-1,0,0) in world X.
                    // For East wall (nx=1), normal is (1,0,0) in world X.

                    if (edge === 'N') { // Normal (0,1,0) in local space. Points "up" in world Z.
                        // Tri 1: BL, TR, TL (CCW when looking from +Y local, which is +Z world)
                        pushVert(BL, u1, 1); pushVert(TR, u2, 0); pushVert(TL, u1, 0);
                        // Tri 2: BL, BR, TR
                        pushVert(BL, u1, 1); pushVert(BR, u2, 1); pushVert(TR, u2, 0);
                    } else if (edge === 'S') { // Normal (0,-1,0) in local space. Points "down" in world Z.
                        // Tri 1: TL, TR, BL (CCW when looking from -Y local, which is -Z world)
                        pushVert(TL, u1, 0); pushVert(TR, u2, 0); pushVert(BL, u1, 1);
                        // Tri 2: TR, BR, BL
                        pushVert(TR, u2, 0); pushVert(BR, u2, 1); pushVert(BL, u1, 1);
                    } else if (edge === 'W') { // Normal (-1,0,0) in local space. Points "left" in world X.
                        // Tri 1: TL, TR, BL (CCW when looking from -X local, which is -X world)
                        pushVert(TL, u1, 0); pushVert(TR, u2, 0); pushVert(BL, u1, 1);
                        // Tri 2: TR, BR, BL
                        pushVert(TR, u2, 0); pushVert(BR, u2, 1); pushVert(BL, u1, 1);
                    } else { // E (Normal (1,0,0) in local space. Points "right" in world X.)
                        // Tri 1: BL, TR, TL (CCW when looking from +X local, which is +X world)
                        pushVert(BL, u1, 1); pushVert(TR, u2, 0); pushVert(TL, u1, 0);
                        // Tri 2: BL, BR, TR
                        pushVert(BL, u1, 1); pushVert(BR, u2, 1); pushVert(TR, u2, 0);
                    }
                }

                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
                geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
                return geo;
            }

            sides.push(generateWall('N'));
            sides.push(generateWall('S'));
            sides.push(generateWall('W'));
            sides.push(generateWall('E'));
        }

        return { topGeometry: geo, sideGeometries: sides };
    }, [terrainData, exaggeration, paletteColors, visibleRange, shape]);

    const alphaMap = useMemo(() => {
        if (shape === 'rectangle') return null;

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 512, 512);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.ellipse(256, 256, 254, 254, 0, 0, 2 * Math.PI);
        ctx.fill();

        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }, [shape]);

    if (!topGeometry) return (
        <mesh>
            <boxGeometry args={[10, 1, 10]} />
            <meshStandardMaterial color="gray" wireframe />
        </mesh>
    );

    return (
        <group ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
            {/* Top Surface */}
            <mesh geometry={topGeometry} receiveShadow castShadow>
                <meshStandardMaterial
                    vertexColors
                    roughness={0.8}
                    metalness={0.1}
                    side={THREE.DoubleSide}
                    alphaMap={alphaMap}
                    transparent={shape === 'ellipse'}
                    alphaTest={shape === 'ellipse' ? 0.1 : 0}
                />
            </mesh>

            {/* Side Walls (Rectangle Only) */}
            {shape === 'rectangle' && sideGeometries.length === 4 && (
                <>
                    {sideGeometries.map((geo, i) => (
                        <mesh key={i} geometry={geo} receiveShadow castShadow>
                            <meshStandardMaterial map={sedimentTexture} roughness={1} side={THREE.DoubleSide} />
                        </mesh>
                    ))}
                </>
            )}
        </group>
    );
};

