import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fetchTerrainTile, calculateBoundsDimensions, calculateOptimalZoom } from '../utils/terrain';
import { TERRAIN_CONFIG } from '../config';

interface TerrainProps {
    shape: 'rectangle' | 'ellipse';
    exaggeration: number;
    paletteColors: string[];
    showSoilProfile?: boolean;
    baseMapName?: string | null;
    onHover?: (data: { height: number; lat: number; lon: number } | null) => void;
}

// Helper to interpolate between pre-parsed colors
interface RGB { r: number; g: number; b: number; }

const getColorFromScaleParsed = (t: number, rgbColors: RGB[]) => {
    if (t <= 0) {
        const c = rgbColors[0];
        return [c.r, c.g, c.b];
    }
    if (t >= 1) {
        const c = rgbColors[rgbColors.length - 1];
        return [c.r, c.g, c.b];
    }

    // Map t to segment
    const segmentCount = rgbColors.length - 1;
    const index = t * segmentCount;
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(lowerIndex + 1, rgbColors.length - 1);
    const factor = index - lowerIndex;

    const c1 = rgbColors[lowerIndex];
    const c2 = rgbColors[upperIndex];

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

export const Terrain: React.FC<TerrainProps & { onHeightRangeChange?: (min: number, max: number) => void }> = ({ shape, exaggeration = 100, paletteColors, onHeightRangeChange, showSoilProfile = true, baseMapName = null, onHover }) => {
    const [terrainData, setTerrainData] = useState<{ width: number; height: number; data: Float32Array; minHeight: number; maxHeight: number } | null>(null);
    const meshRef = useRef<THREE.Group>(null);
    const sedimentTexture = useMemo(() => createSedimentTexture(), []);

    // Helper function to convert lat/lon to tile coordinates
    const latLonToTile = (lat: number, lon: number, zoom: number) => {
        const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
        return { x, y, z: zoom };
    };

    // Load base map texture
    const [baseMapTexture, setBaseMapTexture] = useState<THREE.Texture | null>(null);

    useEffect(() => {
        if (baseMapName && TERRAIN_CONFIG.BASE_MAPS[baseMapName as keyof typeof TERRAIN_CONFIG.BASE_MAPS]) {
            const urlTemplate = TERRAIN_CONFIG.BASE_MAPS[baseMapName as keyof typeof TERRAIN_CONFIG.BASE_MAPS];
            // Calculate optimal zoom for texture (higher detail than DEM)
            // Target ~2048 pixels wide for good texture quality
            const zoom = calculateOptimalZoom(TERRAIN_CONFIG.BOUNDS, 2048, 19);
            console.log('BaseMap Optimal Zoom:', zoom);

            // Calculate tile bounds from BOUNDS (note: latMax goes to minTile.y)
            const minTile = latLonToTile(TERRAIN_CONFIG.BOUNDS.latMax, TERRAIN_CONFIG.BOUNDS.lonMin, zoom);
            const maxTile = latLonToTile(TERRAIN_CONFIG.BOUNDS.latMin, TERRAIN_CONFIG.BOUNDS.lonMax, zoom);

            const tilesX = maxTile.x - minTile.x + 1;
            const tilesY = maxTile.y - minTile.y + 1;

            // Create a canvas to composite all tiles
            const canvas = document.createElement('canvas');
            const tileSize = 256;
            canvas.width = tilesX * tileSize;
            canvas.height = tilesY * tileSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Load all tiles
            let loadedCount = 0;
            const totalTiles = tilesX * tilesY;

            for (let ty = 0; ty < tilesY; ty++) {
                for (let tx = 0; tx < tilesX; tx++) {
                    const tileX = minTile.x + tx;
                    const tileY = minTile.y + ty;

                    const tileUrl = urlTemplate
                        .replace('{x}', tileX.toString())
                        .replace('{y}', tileY.toString())
                        .replace('{z}', zoom.toString());

                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                        ctx.drawImage(img, tx * tileSize, ty * tileSize);
                        loadedCount++;

                        if (loadedCount === totalTiles) {
                            // All tiles loaded, calculate precise UV mapping
                            // Calculate the exact position of BOUNDS within the tile grid

                            // Helper: convert lat/lon to exact pixel position within tile
                            const latLonToPixel = (lat: number, lon: number, zoom: number) => {
                                const scale = Math.pow(2, zoom);
                                const worldX = (lon + 180) / 360 * scale;
                                const worldY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale;
                                return { x: worldX * 256, y: worldY * 256 };
                            };

                            const minPixel = latLonToPixel(TERRAIN_CONFIG.BOUNDS.latMax, TERRAIN_CONFIG.BOUNDS.lonMin, zoom);
                            const maxPixel = latLonToPixel(TERRAIN_CONFIG.BOUNDS.latMin, TERRAIN_CONFIG.BOUNDS.lonMax, zoom);

                            // Calculate UV coordinates relative to the composite canvas
                            const minTilePixelX = minTile.x * 256;
                            const minTilePixelY = minTile.y * 256;

                            const uMin = (minPixel.x - minTilePixelX) / canvas.width;
                            const vMin = (minPixel.y - minTilePixelY) / canvas.height;
                            const uMax = (maxPixel.x - minTilePixelX) / canvas.width;
                            const vMax = (maxPixel.y - minTilePixelY) / canvas.height;

                            // Create texture
                            const texture = new THREE.CanvasTexture(canvas);
                            texture.wrapS = THREE.ClampToEdgeWrapping;
                            texture.wrapT = THREE.ClampToEdgeWrapping;
                            texture.minFilter = THREE.LinearFilter;
                            texture.flipY = true;

                            // Store UV bounds in texture for later use
                            // (texture as any).uvBounds = { uMin, vMin, uMax, vMax };

                            // Apply texture transform to map the specific bounds to the 0..1 UV space of the mesh
                            texture.offset.set(uMin, vMin);
                            texture.repeat.set(uMax - uMin, vMax - vMin);

                            texture.needsUpdate = true;
                            setBaseMapTexture(texture);
                        }
                    };
                    img.onerror = (error) => {
                        console.error(`Error loading tile ${tileX},${tileY}:`, error);
                        loadedCount++;
                        if (loadedCount === totalTiles) {
                            const texture = new THREE.CanvasTexture(canvas);
                            texture.wrapS = THREE.ClampToEdgeWrapping;
                            texture.wrapT = THREE.ClampToEdgeWrapping;
                            texture.minFilter = THREE.LinearFilter;
                            texture.flipY = true;
                            setBaseMapTexture(texture);
                        }
                    };
                    img.src = tileUrl;
                }
            }
        } else {
            setBaseMapTexture(null);
        }
    }, [baseMapName]);

    useEffect(() => {
        // Calculate optimal zoom for DEM (Elevation)
        // Target ~1024 pixels wide for geometry (mesh density)
        const zoom = calculateOptimalZoom(TERRAIN_CONFIG.BOUNDS, 1024, TERRAIN_CONFIG.DEM_MAX_LEVEL);
        console.log('DEM Optimal Zoom:', zoom);

        fetchTerrainTile(zoom).then(setTerrainData).catch(console.error);
    }, []); // Will reload when component remounts with new BOUNDS

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

        // Initialize vertex colors buffer (allocated but not computed yet)
        const colors = new Float32Array(count * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Store original height data as custom attribute
        const heightData = new Float32Array(geo.attributes.position.count);
        for (let i = 0; i < heightData.length; i++) {
            heightData[i] = data[i] || minHeight;
        }
        geo.setAttribute('heightData', new THREE.BufferAttribute(heightData, 1));

        const heightRange = visibleMax - visibleMin || 1;
        // Generate geometry with normalized height (1.0 scale).
        // Actual exaggeration is applied via mesh.scale.z to avoid expensive geometry regeneration.
        const currentMultiplier = 1.0;

        for (let i = 0; i < count; i++) {
            // Use DEM data directly without rotation
            const rawHeight = data[i] || minHeight;
            const relativeHeight = rawHeight - minHeight;
            arr[i * 3 + 2] = relativeHeight * currentMultiplier;

            // Initial UVs are standard 0..1 from PlaneGeometry, which is fine for start.
            // We will update them in the useEffect below if needed.
        }

        geo.computeVertexNormals();

        // Calculate Soil Depth
        const dimensions = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS);
        const soilDepthMeters = TERRAIN_CONFIG.SOIL_DEPTH_UNIT === 'percent'
            ? dimensions.minDimension * (TERRAIN_CONFIG.SOIL_DEPTH_VALUE / 100)
            : TERRAIN_CONFIG.SOIL_DEPTH_VALUE;

        // --- Side Walls (Rectangle Only) ---
        const sides: THREE.BufferGeometry[] = [];
        if (shape === 'rectangle') {
            const baseDepth = -soilDepthMeters * currentMultiplier;
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
        } else if (shape === 'ellipse') {
            const baseDepth = -soilDepthMeters * currentMultiplier;
            const R = 49.6; // Slightly less than 50 to match mask (254/512 approx)
            const segments = 128; // Smoothness

            // Helper for bilinear interpolation
            const getHeight = (x: number, y: number) => {
                // x, y in -50..50 range
                // Map to grid coordinates
                // Grid X: -50 -> 0, +50 -> width-1
                const gx = ((x + 50) / 100) * (width - 1);
                // Grid Y: +50 -> 0, -50 -> height-1 (Row 0 is Top/+50)
                const gy = ((50 - y) / 100) * (height - 1);

                const ix = Math.floor(gx);
                const iy = Math.floor(gy);
                const fx = gx - ix;
                const fy = gy - iy;

                // Clamp indices
                const c = (v: number, max: number) => Math.max(0, Math.min(max, v));
                const idx = (cX: number, cY: number) => c(cY, height - 1) * width + c(cX, width - 1);

                const h00 = data[idx(ix, iy)] || minHeight;
                const h10 = data[idx(ix + 1, iy)] || minHeight;
                const h01 = data[idx(ix, iy + 1)] || minHeight;
                const h11 = data[idx(ix + 1, iy + 1)] || minHeight;

                // Bilinear
                const hTop = h00 * (1 - fx) + h10 * fx;
                const hBot = h01 * (1 - fx) + h11 * fx;
                const h = hTop * (1 - fy) + hBot * fy;

                return (h - minHeight) * currentMultiplier;
            };

            const positions: number[] = [];
            const normals: number[] = [];
            const uvs: number[] = [];

            for (let i = 0; i < segments; i++) {
                // Current Angle
                const theta1 = (i / segments) * 2 * Math.PI;
                const x1 = R * Math.cos(theta1);
                const y1 = R * Math.sin(theta1);
                const z1 = getHeight(x1, y1);

                // Next Angle
                const theta2 = ((i + 1) / segments) * 2 * Math.PI;
                const x2 = R * Math.cos(theta2);
                const y2 = R * Math.sin(theta2);
                const z2 = getHeight(x2, y2);

                // Vertices
                // TL: p1 top
                // BL: p1 base
                // TR: p2 top
                // BR: p2 base
                // Normal? Outward radial.
                // N1 = (cos t1, sin t1, 0)
                // N2 = (cos t2, sin t2, 0)

                const addVert = (x: number, y: number, z: number, th: number, u: number, v: number) => {
                    positions.push(x, y, z);
                    // Normal points out from center in XY plane
                    normals.push(Math.cos(th), Math.sin(th), 0);
                    uvs.push(u, v);
                };

                const u1 = i / segments;
                const u2 = (i + 1) / segments;

                // Tri 1: BL, TR, TL (Outward CCW??)
                // Let's check winding. Center (0,0).
                // Theta goes 0 -> 2PI (CCW in XY).
                // 1 is Angle 0. 2 is Angle Small+.
                // 1 is Right. 2 is Slightly Up-Right.
                // Looking from Outside (Right):
                // TL(1), TR(2).
                // Triangle BL, TR, TL.
                // BL(1, base) -> TR(2, top) -> TL(1, top).
                // Vector BL->TR (up-ish, left-ish). BL->TL (up-ish).
                // Cross product...
                // Let's stick to standard counter-clockwise definition.
                // 1 is "Left" in the sequence if we walk CCW?
                // No, if we walk CCW, 1 is 'previous', 2 is 'next'.
                // So 1 is Left, 2 is Right (if looking from center).
                // But we look from OUTSIDE.
                // Looking from outside, 1 (Angle 0) is Right?? No.
                // Angle 0 is East. Angle small is North-East.
                // If I stand East and look West (at terrain):
                // 0 is Center-ish. Small is Right-ish.
                // Wait. Standard CCW 2D plane.
                // Let's just create Quad p1(Left), p2(Right).
                // p1 is Angle i. p2 is Angle i+1.
                // From outside?
                // Tangent is (-sin, cos).
                // Normal (cos, sin).
                // If we move along tangent, we move CCW.
                // So p1 is "behind", p2 is "ahead".
                // If we face the wall (looking inward -Normal), Left is p2, Right is p1.
                // If we face OUTWARD (looking along Normal):
                // Left is p1. Right is p2.
                // So p1=Left, p2=Right.
                // TL=Top1, TR=Top2.
                // Quad: TL, BL, TR, BR.
                // Tri 1: BL, TR, TL.
                // Tri 2: BL, BR, TR.

                // BL
                addVert(x1, y1, baseDepth, theta1, u1, 1);
                // TR
                addVert(x2, y2, z2, theta2, u2, 0);
                // TL
                addVert(x1, y1, z1, theta1, u1, 0);

                // BL
                addVert(x1, y1, baseDepth, theta1, u1, 1);
                // BR
                addVert(x2, y2, baseDepth, theta2, u2, 1);
                // TR
                addVert(x2, y2, z2, theta2, u2, 0);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            sides.push(geo);
        }

        return { topGeometry: geo, sideGeometries: sides };
    }, [terrainData, visibleRange, shape]); // Removed paletteColors & baseMapTexture from dependencies

    // Effect to handle Appearance Updates (Colors & UVs) directly on the geometry
    useEffect(() => {
        if (!topGeometry || !visibleRange) return;

        const geo = topGeometry;
        const count = geo.attributes.position.count;
        const heightDataAttr = geo.getAttribute('heightData');
        const colorAttr = geo.getAttribute('color');
        const uvAttr = geo.getAttribute('uv');

        if (!heightDataAttr || !colorAttr || !uvAttr) return;

        // 1. Ensure UVs are standard 0..1 (PlaneGeometry defaults)
        // This is crucial for alphaMap (ellipse) to work correctly.
        // We no longer modify UVs for the Base Map; we modify the texture offset/repeat instead.
        // However, since we previously mutated UVs, we must reset them here to be safe.
        const uvArray = uvAttr.array as Float32Array;
        const widthSegments = (terrainData?.width || 2) - 1;
        const heightSegments = (terrainData?.height || 2) - 1;

        for (let i = 0; i < count; i++) {
            const ix = i % (widthSegments + 1);
            const iy = Math.floor(i / (widthSegments + 1));
            const u = ix / widthSegments;
            const v = 1 - (iy / heightSegments);
            uvArray[i * 2] = u;
            uvArray[i * 2 + 1] = v;
        }
        uvAttr.needsUpdate = true;


        // 2. Handle Color Updates (Palette)
        // Optimization: Even if using Base Map, we update colors so switching back is fast.
        // OR: Only update if !baseMapTexture to save CPU? 
        // Let's update always to keep state consistent, but optimize the loop 
        // Update: optimizing the loop with pre-parsed colors.

        const heightData = heightDataAttr.array as Float32Array;
        const colorArray = colorAttr.array as Float32Array;
        const { min: visibleMin, max: visibleMax } = visibleRange;
        const heightRange = visibleMax - visibleMin || 1;
        const safePalette = paletteColors && paletteColors.length > 0 ? paletteColors : ['#000000', '#ffffff'];

        // Pre-parse colors to avoid thousands of regex calls inside loop
        const rgbPalette = safePalette.map(hex => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255
            } : { r: 0, g: 0, b: 0 };
        });

        for (let i = 0; i < count; i++) {
            const hRaw = heightData[i];
            const hNormalized = (hRaw - visibleMin) / heightRange;
            const h = Math.min(Math.max(hNormalized, 0), 1);

            const [r, g, b] = getColorFromScaleParsed(h, rgbPalette);
            colorArray[i * 3] = r;
            colorArray[i * 3 + 1] = g;
            colorArray[i * 3 + 2] = b;
        }
        colorAttr.needsUpdate = true;
    }, [topGeometry, visibleRange, paletteColors, baseMapTexture, terrainData?.width, terrainData?.height]);

    // Calculate dynamic Z-scale based on real-world dimensions
    // User requirement: Height (meters) should match X/Y (meters).
    // Mesh is 100 units wide. Real world is N meters wide.
    // Scale X = 100 / RealWidth.
    // We apply this scale to Z to ensure 1:1 proportion at 100% exaggeration.
    const dimensions = useMemo(() => calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS), []);
    // We use width (X) as the reference for scaling Z to match.
    // Ideally, the mesh should also respect aspect ratio, but assuming 100x100:
    const baseScale = 100 / dimensions.width;

    const zScale = baseScale * (exaggeration / 100);

    const handlePointerMove = (e: THREE.Intersection) => {
        if (!onHover || !terrainData) return;
        // e.point is in world space.
        // World Y = (RawHeight - minHeight) * zScale
        // RawHeight = (World Y / zScale) + minHeight
        const worldY = e.point.y;
        const realHeight = (worldY / zScale) + terrainData.minHeight;

        // Calculate Lat/Lon based on World X/Z
        // Plane is 100x100 (-50 to 50)
        // X: -50 (LonMin) -> +50 (LonMax)
        // Z: -50 (Top/North/LatMax) -> +50 (Bottom/South/LatMin)

        const { x, z } = e.point;
        const { latMin, latMax, lonMin, lonMax } = TERRAIN_CONFIG.BOUNDS;

        // Normalize X from -50..50 to 0..1
        const u = (x + 50) / 100;
        const lon = lonMin + u * (lonMax - lonMin);

        // Normalize Z from -50..50 to 0..1
        // Z=-50 -> v=0 (Top) -> LatMax
        // Z=50 -> v=1 (Bottom) -> LatMin
        const v = (z + 50) / 100;
        // Linear interpolation: LatMax -> LatMin
        const lat = latMax + v * (latMin - latMax);

        onHover({ height: realHeight, lat, lon });
    };

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
            {/* Top Surface - Palette Mode (Vertex Colors) */}
            <mesh
                geometry={topGeometry}
                receiveShadow
                castShadow
                scale={[1, 1, zScale]}
                visible={!baseMapTexture}
                onPointerMove={(e) => {
                    e.stopPropagation();
                    handlePointerMove(e);
                }}
                onPointerOut={() => onHover && onHover(null)}
            >
                <meshStandardMaterial
                    vertexColors={true}
                    roughness={0.8}
                    metalness={0.1}
                    side={THREE.DoubleSide}
                    alphaMap={alphaMap}
                    transparent={shape === 'ellipse'}
                    alphaTest={shape === 'ellipse' ? 0.1 : 0}
                />
            </mesh>

            {/* Top Surface - Base Map Mode (Texture) */}
            {/* By using two separate meshes/materials, we avoid shader recompilation when toggling mode */}
            <mesh
                geometry={topGeometry}
                receiveShadow
                castShadow
                scale={[1, 1, zScale]}
                visible={!!baseMapTexture}
                onPointerMove={(e) => {
                    e.stopPropagation();
                    handlePointerMove(e);
                }}
                onPointerOut={() => onHover && onHover(null)}
            >
                <meshStandardMaterial
                    map={baseMapTexture}
                    vertexColors={false}
                    roughness={0.8}
                    metalness={0.1}
                    side={THREE.DoubleSide}
                    alphaMap={alphaMap}
                    transparent={shape === 'ellipse'}
                    alphaTest={shape === 'ellipse' ? 0.1 : 0}
                />
            </mesh>

            {/* Side Walls */}
            {showSoilProfile && (shape === 'rectangle' || shape === 'ellipse') && sideGeometries.length > 0 && (
                <>
                    {sideGeometries.map((geo, i) => (
                        <mesh key={i} geometry={geo} receiveShadow castShadow scale={[1, 1, zScale]}>
                            <meshStandardMaterial map={sedimentTexture} roughness={1} side={THREE.DoubleSide} />
                        </mesh>
                    ))}
                </>
            )}
        </group>
    );
};

