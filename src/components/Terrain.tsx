import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fetchTerrainTile, calculateBoundsDimensions, calculateOptimalZoom } from '../utils/terrain';
import { useThree, useFrame } from '@react-three/fiber';
import { TERRAIN_CONFIG } from '../config';
import { Clouds } from './Clouds';
import { Contours } from './Contours';
import { Fire } from './Fire';

interface CloudLayerConfig {
    minAlt: number;
    maxAlt: number;
    count: number;
    opacity: number;
    minSize: number;
    maxSize: number;
    color: string;
}

interface CloudConfig {
    enabled: boolean;
    globalHeightOffset: number;
    globalHeightScalar: number;
    layers: CloudLayerConfig[];
}

interface WindLayerConfig {
    speed: number;
    direction: number;
}

interface WindConfig {
    enabled: boolean;
    layers: WindLayerConfig[];
}

interface ContourConfig {
    enabled: boolean;
    interval: number;
    majorInterval: number;
    showLabels: boolean;
    minorOpacity: number;
    majorOpacity: number;
}

interface FireConfig {
    ENABLED: boolean;
    LOCATIONS: { lat: number; lon: number; scale: number; intensity: number }[];
    COLOR_INNER: string;
    COLOR_OUTER: string;
    HEIGHT: number;
    HEIGHT_OFFSET: number;
    SPREAD: number;
    ITERATIONS: number;
    OCTAVES: number;
    SMOKE?: {
        ENABLED: boolean;
        HEIGHT: number;
        SPEED: number;
        DISPERSION: number;
        SIZE: number;
        OPACITY: number;
        COLOR: string;
        MAX_HEIGHT?: number;
    };
}

interface TerrainProps {
    shape: 'rectangle' | 'ellipse';
    exaggeration: number;
    paletteColors: string[];
    showSoilProfile?: boolean;
    baseMapName?: string | null;
    onHover?: (data: { height: number; lat: number; lon: number } | null) => void;
    disableHover?: boolean;
    enableMicroDisplacement?: boolean;
    cloudConfig?: CloudConfig;
    windConfig?: WindConfig;
    contourConfig?: ContourConfig;
    fireConfigs?: FireConfig[];
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

const TerrainComponent: React.FC<TerrainProps & { onHeightRangeChange?: (min: number, max: number) => void }> = ({ shape, exaggeration = 100, paletteColors, onHeightRangeChange, showSoilProfile = true, baseMapName = null, onHover, disableHover = false, enableMicroDisplacement = true, cloudConfig, windConfig, contourConfig, fireConfigs }) => {
    const [terrainData, setTerrainData] = useState<{ width: number; height: number; data: Float32Array; minHeight: number; maxHeight: number } | null>(null);
    const [previousTerrainData, setPreviousTerrainData] = useState<typeof terrainData>(null);
    const [isLoadingTerrain, setIsLoadingTerrain] = useState(false);
    const meshRef = useRef<THREE.Group>(null);
    const sedimentTexture = useMemo(() => createSedimentTexture(), []);
    const lastHoverUpdate = useRef(0);
    const { camera } = useThree();

    // LOD State with optimized update frequency
    const [lodZoom, setLodZoom] = useState<number>(() => calculateOptimalZoom(TERRAIN_CONFIG.BOUNDS, 1024, 12));
    const lastLodCheck = useRef(0);
    const currentLodZoom = useRef(lodZoom);
    const [isLodTransitioning, setIsLodTransitioning] = useState(false);

    // Smart Texture Loading: Use partial bounds for high zoom to prevent 40k+ tile loads
    const [activeTextureBounds, setActiveTextureBounds] = useState(TERRAIN_CONFIG.BOUNDS);
    const lastTextureCenter = useRef(new THREE.Vector3(99999, 99999, 99999)); // Force update on first close approach

    // Dynamic LOD Monitoring - Optimized for performance
    useFrame(() => {
        const now = Date.now();
        // Increased check interval to 2 seconds to reduce frequent updates
        if (now - lastLodCheck.current < 2000) return;
        lastLodCheck.current = now;

        // Calculate distance to center (approx) or altitude
        // Camera is at [50, 40, 80] initially. Center is 0,0,0.
        // Simple altitude check: camera.position.y (assuming Y-up world, but controls orbit)
        // Better: Distance to origin (0,0,0) which is center of map
        const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));

        // Mapping Distance to Zoom
        // Dist 200 (Far) -> Zoom 8
        // Dist 20 (Close) -> Zoom 15

        // Base scale impact: The world is scaled to 100 units wide.
        // Map width in meters:
        const mapWidthMeters = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS).width;
        // Scale ratio: 100 units = mapWidthMeters
        // 1 unit = mapWidthMeters / 100
        const metersPerUnit = mapWidthMeters / 100;
        const distMeters = dist * metersPerUnit;

        // Calculate target zoom based on distance
        // Rule of thumb: Pixel size ~ Distance * 0.0003 (FOV dependent)
        // Zoom Level Z resolution ~ 156543 / 2^Z meters/pixel
        // Desired Meters/Pixel = DistanceMeters * 0.001 (approx for visual fidelity)

        let targetZ = 12;
        // Shifted Thresholds for Higher Resolution (approx 2x previous detail)
        if (distMeters < 1000) targetZ = 16;      // Was < 500
        else if (distMeters < 2000) targetZ = 15; // Was < 1000
        else if (distMeters < 5000) targetZ = 14; // Was < 2500
        else if (distMeters < 10000) targetZ = 13; // Was < 5000
        else if (distMeters < 20000) targetZ = 12; // Was < 10000
        else targetZ = 11;                         // Was 10

        // Clamp to Max DEM Level
        targetZ = Math.min(targetZ, TERRAIN_CONFIG.DEM_MAX_LEVEL);

        // Add hysteresis: Only update if zoom changes by at least 2 levels to prevent flickering
        const zoomDiff = Math.abs(targetZ - currentLodZoom.current);
        if (zoomDiff >= 2) {
            currentLodZoom.current = targetZ;
            setIsLodTransitioning(true);
            setLodZoom(targetZ);

            // Calculate visible bounds based on distance
            // When close (dist < 100), use smaller bounds
            // When far (dist > 150), use full bounds
            let newVisibleBounds = TERRAIN_CONFIG.BOUNDS;

            if (distMeters < 5000) {
                // Close up: use only center portion
                const { latMin, latMax, lonMin, lonMax } = TERRAIN_CONFIG.BOUNDS;
                const centerLat = (latMin + latMax) / 2;
                const centerLon = (lonMin + lonMax) / 2;

                // Calculate visible fraction (20% to 100%)
                const fraction = Math.min(1.0, Math.max(0.15, distMeters / 5000));

                const latRange = (latMax - latMin) * fraction;
                const lonRange = (lonMax - lonMin) * fraction;

                // newVisibleBounds = {
                //     latMin: centerLat - latRange / 2,
                //     latMax: centerLat + latRange / 2,
                //     lonMin: centerLon - lonRange / 2,
                //     lonMax: centerLon + lonRange / 2
                // };
            }

            // setVisibleBounds(newVisibleBounds); // DISABLED

            // Reset transition flag after a delay
            setTimeout(() => setIsLodTransitioning(false), 1000);
        }

        // --- Smart Texture Update Logic ---
        // Dynamically update texture bounds when zoomed in (BaseMap Zoom >= 16 approx 15km)
        // If close to ground (< 15000m), use partial texture bounds to allow high zoom (18-19)
        if (distMeters < 15000) {
            const distToLast = camera.position.distanceTo(lastTextureCenter.current);
            const distMetersToLast = distToLast * metersPerUnit;

            // Only update if moved significantly (> 500m) to prevent frequent reloading
            if (distMetersToLast > 500) {
                const fullLatRange = TERRAIN_CONFIG.BOUNDS.latMax - TERRAIN_CONFIG.BOUNDS.latMin;
                const fullLonRange = TERRAIN_CONFIG.BOUNDS.lonMax - TERRAIN_CONFIG.BOUNDS.lonMin;
                const centerLat = (TERRAIN_CONFIG.BOUNDS.latMin + TERRAIN_CONFIG.BOUNDS.latMax) / 2;
                const centerLon = (TERRAIN_CONFIG.BOUNDS.lonMin + TERRAIN_CONFIG.BOUNDS.lonMax) / 2;

                // Map Camera Pos (-50 to 50) to Lat/Lon offsets
                // World X+ is East (+Lon)
                // World Z+ is South (-Lat) (Assuming Camera looks down Z and Z is inverted Mesh Y)
                const lonOffset = (camera.position.x / 100) * fullLonRange;
                const latOffset = (-camera.position.z / 100) * fullLatRange;

                const targetCenterLat = centerLat + latOffset;
                const targetCenterLon = centerLon + lonOffset;

                // View Size: ~3000m buffer box (covers Zoom 16 view with margin)
                const viewSizeMeters = 3000;
                const viewFraction = Math.min(1.0, viewSizeMeters / (mapWidthMeters || 10000));

                const latSize = fullLatRange * viewFraction;
                const lonSize = fullLonRange * viewFraction;

                const newBounds = {
                    latMin: Math.max(TERRAIN_CONFIG.BOUNDS.latMin, targetCenterLat - latSize / 2),
                    latMax: Math.min(TERRAIN_CONFIG.BOUNDS.latMax, targetCenterLat + latSize / 2),
                    lonMin: Math.max(TERRAIN_CONFIG.BOUNDS.lonMin, targetCenterLon - lonSize / 2),
                    lonMax: Math.min(TERRAIN_CONFIG.BOUNDS.lonMax, targetCenterLon + lonSize / 2)
                };

                setActiveTextureBounds(newBounds);
                lastTextureCenter.current.copy(camera.position);
                console.log(`🖼️ Smart Bounds Update: Moved ${Math.round(distMetersToLast)}m -> Reloading Partial Texture`);
            }
        } else if (activeTextureBounds !== TERRAIN_CONFIG.BOUNDS) {
            // Zoomed out: Reset to full bounds
            setActiveTextureBounds(TERRAIN_CONFIG.BOUNDS);
            lastTextureCenter.current.set(99999, 99999, 99999);
            console.log(`🖼️ Smart Bounds Reset: Full Map Mode`);
        }
    });

    // Helper function to convert lat/lon to tile coordinates
    const latLonToTile = (lat: number, lon: number, zoom: number) => {
        const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
        return { x, y, z: zoom };
    };

    // Load base map texture
    const [baseMapTexture, setBaseMapTexture] = useState<THREE.Texture | null>(null);
    const [detailMapTexture, setDetailMapTexture] = useState<THREE.Texture | null>(null);

    // Memoize zoom calculation based on BOTH lodZoom AND camera distance
    // Closer to camera = higher zoom (more detail), farther = lower zoom (less detail)
    const baseMapZoom = useMemo(() => {
        if (!baseMapName) return 0;

        // Calculate camera distance to terrain center
        const dist = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));

        // Calculate distance in meters (approximate)
        const mapWidthMeters = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS).width;
        const metersPerUnit = mapWidthMeters / 100;
        const distMeters = dist * metersPerUnit;

        // Adjusted visibility range to be 10 levels with distMeters conditions
        // Increasing Z level by +1 at same viewing distances
        let targetZoom: number;

        if (distMeters < 1500) {        // Level 1: Ultra Close
            targetZoom = 19;
        } else if (distMeters < 3000) { // Level 2: Extended Zoom 19
            targetZoom = 19;
        } else if (distMeters < 4500) { // Level 3: Extended Zoom 19
            targetZoom = 19;
        } else if (distMeters < 6000) { // Level 4: High Detail
            targetZoom = 18;
        } else if (distMeters < 7500) { // Level 5
            targetZoom = 18;
        } else if (distMeters < 9000) { // Level 6
            targetZoom = 18;
        } else if (distMeters < 11000) { // Level 7: Medium Detail
            targetZoom = 17;
        } else if (distMeters < 13000) { // Level 8
            targetZoom = 17;
        } else if (distMeters < 15000) { // Level 9
            targetZoom = 17;
        } else if (distMeters < 30000) { // Level 10: Far
            targetZoom = 16;
        } else {                         // Fallback
            targetZoom = 15;
        }

        const finalZoom = targetZoom; // Prioritize distance-based detail (ignore geometry LOD limit)

        console.log(`📏 Camera distance: ${Math.round(distMeters)}m → baseMap zoom: ${finalZoom}`);

        // CRITICAL SAFETY CAP: 
        // If we are using valid full bounds, we CANNOT load zoom > 16 (40k+ tiles).
        // Only allow > 16 if activeTextureBounds is partial (different from full bounds)
        // Note: Object comparison needs reference check.
        if (activeTextureBounds === TERRAIN_CONFIG.BOUNDS && finalZoom > 16) {
            console.warn(`⚠️ Cap zoom to 16 because using Full Bounds (prevent crash)`);
            return 16;
        }

        return finalZoom;
    }, [baseMapName, lodZoom, activeTextureBounds]); // Re-calculate when LOD changes or bounds change

    // Properly dispose of texture when it changes to prevent memory leaks
    useEffect(() => {
        return () => {
            if (baseMapTexture) {
                baseMapTexture.dispose();
            }
        };
    }, [baseMapTexture]);

    // EFFECT 1: Load BASE MAP (Background, Low-Res, Full Extent)
    useEffect(() => {
        let active = true;

        if (baseMapName && TERRAIN_CONFIG.BASE_MAPS[baseMapName as keyof typeof TERRAIN_CONFIG.BASE_MAPS]) {
            const urlTemplate = TERRAIN_CONFIG.BASE_MAPS[baseMapName as keyof typeof TERRAIN_CONFIG.BASE_MAPS];

            // Fixed Zoom for Background (16 gives better clarity ~ 2m/pixel)
            const zoom = 16;
            const bounds = TERRAIN_CONFIG.BOUNDS;

            console.log(`🌍 Base Layer Loading: Zoom ${zoom} (Fixed)`);

            const minTile = latLonToTile(bounds.latMax, bounds.lonMin, zoom);
            const maxTile = latLonToTile(bounds.latMin, bounds.lonMax, zoom);

            const tilesX = maxTile.x - minTile.x + 1;
            const tilesY = maxTile.y - minTile.y + 1;

            if (tilesX * tilesY > 400) { // Limit background usage
                console.warn(`Base layer too large (${tilesX * tilesY}), capping.`);
            }

            const canvas = document.createElement('canvas');
            const tileSize = 256;
            canvas.width = tilesX * tileSize;
            canvas.height = tilesY * tileSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            let loadedCount = 0;
            const totalTiles = tilesX * tilesY;

            const finishBaseTexture = () => {
                if (!active) return;

                // Helper functions are simpler here since we use Full Bounds
                const latLonToPixel = (lat: number, lon: number, zoom: number) => {
                    const scale = Math.pow(2, zoom);
                    const worldX = (lon + 180) / 360 * scale;
                    const worldY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale;
                    return { x: worldX * 256, y: worldY * 256 };
                };

                const minPixel = latLonToPixel(bounds.latMax, bounds.lonMin, zoom);
                const maxPixel = latLonToPixel(bounds.latMin, bounds.lonMax, zoom);
                const minTilePixelX = minTile.x * 256;
                const minTilePixelY = minTile.y * 256;

                const uMin = (minPixel.x - minTilePixelX) / canvas.width;
                const vMin = (minPixel.y - minTilePixelY) / canvas.height;
                const uMax = (maxPixel.x - minTilePixelX) / canvas.width;
                const vMax = (maxPixel.y - minTilePixelY) / canvas.height;

                const texture = new THREE.CanvasTexture(canvas);
                texture.wrapS = THREE.ClampToEdgeWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.minFilter = THREE.LinearFilter;
                texture.flipY = true;

                texture.offset.set(uMin, 1 - vMax);
                texture.repeat.set(uMax - uMin, vMax - vMin);

                texture.needsUpdate = true;
                setBaseMapTexture(texture);
            };

            for (let ty = 0; ty < tilesY; ty++) {
                for (let tx = 0; tx < tilesX; tx++) {
                    const tileX = minTile.x + tx;
                    const tileY = minTile.y + ty;
                    const tileUrl = urlTemplate.replace('{x}', tileX.toString()).replace('{y}', tileY.toString()).replace('{z}', zoom.toString());

                    const img = new Image();
                    img.crossOrigin = 'Anonymous';
                    img.onload = () => {
                        if (!active) return;
                        ctx.drawImage(img, tx * tileSize, ty * tileSize);
                        loadedCount++;
                        if (loadedCount === totalTiles) finishBaseTexture();
                    };
                    img.onerror = () => { loadedCount++; if (loadedCount === totalTiles) finishBaseTexture(); };
                    img.src = tileUrl;
                }
            }
        } else {
            setBaseMapTexture(null);
        }
        return () => { active = false; };
    }, [baseMapName]);

    // EFFECT 2: Load DETAIL MAP (High-Res, Partial Extent, Overlay)
    useEffect(() => {
        let active = true;

        if (baseMapName && TERRAIN_CONFIG.BASE_MAPS[baseMapName as keyof typeof TERRAIN_CONFIG.BASE_MAPS]) {
            const urlTemplate = TERRAIN_CONFIG.BASE_MAPS[baseMapName as keyof typeof TERRAIN_CONFIG.BASE_MAPS];
            const bounds = activeTextureBounds;

            // If using FULL bounds, we don't need Detail Layer (Base Layer handles it)
            if (bounds === TERRAIN_CONFIG.BOUNDS) {
                setDetailMapTexture(null);
                return;
            }

            const zoom = baseMapZoom; // High Res (18-19)
            console.log(`🔎 Detail Layer Loading: Zoom ${zoom} (Partial)`);

            const minTile = latLonToTile(bounds.latMax, bounds.lonMin, zoom);
            const maxTile = latLonToTile(bounds.latMin, bounds.lonMax, zoom);

            const tilesX = maxTile.x - minTile.x + 1;
            const tilesY = maxTile.y - minTile.y + 1;

            if (tilesX * tilesY > 2500) return; // Safety

            const canvas = document.createElement('canvas');
            const tileSize = 256;
            const padding = 2; // Padding
            canvas.width = tilesX * tileSize + padding * 2;
            canvas.height = tilesY * tileSize + padding * 2;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // CLEAR with Transparent (Instead of Soil Color) to act as Overlay
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let loadedCount = 0;
            const totalTiles = tilesX * tilesY;
            if (totalTiles === 0) return;

            const finishDetailTexture = () => {
                if (!active) return;

                const latLonToPixel = (lat: number, lon: number, zoom: number) => {
                    const scale = Math.pow(2, zoom);
                    const worldX = (lon + 180) / 360 * scale;
                    const worldY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale;
                    return { x: worldX * 256, y: worldY * 256 };
                };

                const minPixel = latLonToPixel(TERRAIN_CONFIG.BOUNDS.latMax, TERRAIN_CONFIG.BOUNDS.lonMin, zoom);
                const maxPixel = latLonToPixel(TERRAIN_CONFIG.BOUNDS.latMin, TERRAIN_CONFIG.BOUNDS.lonMax, zoom);
                const minTilePixelX = minTile.x * 256;
                const minTilePixelY = minTile.y * 256;

                // Adjust uMin for Padding and Partial Offset
                const uMin = (minPixel.x - minTilePixelX + padding) / canvas.width;
                const vMin = (minPixel.y - minTilePixelY + padding) / canvas.height;
                const uMax = (maxPixel.x - minTilePixelX + padding) / canvas.width;
                const vMax = (maxPixel.y - minTilePixelY + padding) / canvas.height;

                const texture = new THREE.CanvasTexture(canvas);
                texture.wrapS = THREE.ClampToEdgeWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.minFilter = THREE.LinearFilter;
                texture.flipY = true;

                texture.offset.set(uMin, 1 - vMax);
                texture.repeat.set(uMax - uMin, vMax - vMin);
                texture.needsUpdate = true;
                setDetailMapTexture(texture);
            };

            for (let ty = 0; ty < tilesY; ty++) {
                for (let tx = 0; tx < tilesX; tx++) {
                    const tileX = minTile.x + tx;
                    const tileY = minTile.y + ty;
                    const tileUrl = urlTemplate.replace('{x}', tileX.toString()).replace('{y}', tileY.toString()).replace('{z}', zoom.toString());

                    const img = new Image();
                    img.crossOrigin = 'Anonymous';
                    img.onload = () => {
                        if (!active) return;
                        ctx.drawImage(img, tx * tileSize + padding, ty * tileSize + padding);
                        loadedCount++;
                        if (loadedCount === totalTiles) finishDetailTexture();
                    };
                    img.onerror = () => { loadedCount++; if (loadedCount === totalTiles) finishDetailTexture(); };
                    img.src = tileUrl;
                }
            }
        } else {
            setDetailMapTexture(null);
        }
        return () => { active = false; };
    }, [baseMapName, baseMapZoom, activeTextureBounds]);

    useEffect(() => {
        // Fetch DEM with dynamic LOD - using FULL bounds (not visibleBounds)
        // Progressive Loading: Keep previous data while loading new data
        console.log(`DEM LOD Update: Zoom ${lodZoom}, using full TERRAIN_CONFIG.BOUNDS`);

        setIsLoadingTerrain(true);
        let active = true;

        fetchTerrainTile(lodZoom, TERRAIN_CONFIG.BOUNDS).then(data => {
            if (active) {
                // Save previous data before updating
                setPreviousTerrainData(terrainData);
                setTerrainData(data);
                setIsLoadingTerrain(false);
            }
        }).catch(error => {
            console.error('Failed to load terrain:', error);
            if (active) {
                setIsLoadingTerrain(false);
                // Keep previous data on error
            }
        });

        return () => { active = false; };
    }, [lodZoom]); // Only reload when lodZoom changes (not on pan!)

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
        // PERFORMANCE OPTIMIZATION: Limit geometry resolution to prevent slowdowns
        // High zoom levels can have 256x256+ DEM data = 65k+ vertices = VERY SLOW!
        // Solution: Downsample geometry while keeping texture quality

        const MAX_GEOMETRY_RES = 128; // Limit to 128x128 = 16,384 vertices max
        const actualWidth = Math.min(width, MAX_GEOMETRY_RES);
        const actualHeight = Math.min(height, MAX_GEOMETRY_RES);

        const geo = new THREE.PlaneGeometry(100, 100, actualWidth - 1, actualHeight - 1);

        console.log(`🔺 Geometry: ${actualWidth}x${actualHeight} (${actualWidth * actualHeight} vertices) from DEM ${width}x${height}`);

        const count = geo.attributes.position.count;
        const arr = geo.attributes.position.array;

        // Downsample DEM data to match geometry resolution if needed
        let sampledData: Float32Array;
        if (actualWidth < width || actualHeight < height) {
            // Need to downsample DEM data
            sampledData = new Float32Array(actualWidth * actualHeight);

            for (let gy = 0; gy < actualHeight; gy++) {
                for (let gx = 0; gx < actualWidth; gx++) {
                    // Map geometry coordinate to DEM coordinate
                    const demX = Math.floor((gx / (actualWidth - 1)) * (width - 1));
                    const demY = Math.floor((gy / (actualHeight - 1)) * (height - 1));
                    const demIdx = demY * width + demX;
                    const geoIdx = gy * actualWidth + gx;

                    sampledData[geoIdx] = data[demIdx] || minHeight;
                }
            }
        } else {
            // No downsampling needed
            sampledData = data;
        }

        // Initialize vertex colors buffer (allocated but not computed yet)
        const colors = new Float32Array(count * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Store original height data as custom attribute
        const heightData = new Float32Array(geo.attributes.position.count);
        for (let i = 0; i < heightData.length; i++) {
            heightData[i] = sampledData[i] || minHeight;
        }
        geo.setAttribute('heightData', new THREE.BufferAttribute(heightData, 1));

        const heightRange = visibleMax - visibleMin || 1;
        // Apply exaggeration directly to vertices to separate it from soil depth
        const currentMultiplier = exaggeration / 100;

        for (let i = 0; i < count; i++) {
            // Use downsampled DEM data
            const rawHeight = sampledData[i] || minHeight;
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

        // Base depth is fixed relative to map width (1:1 scale), unaffected by exaggeration
        const baseDepth = -soilDepthMeters;

        const sides: THREE.BufferGeometry[] = [];

        if (shape === 'rectangle') {
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
            };

            sides.push(generateWall('N'));
            sides.push(generateWall('S'));
            sides.push(generateWall('W'));
            sides.push(generateWall('E'));
        } else if (shape === 'ellipse') {
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
    }, [terrainData, visibleRange, shape, exaggeration]); // Exaggeration dependency added

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
        // Logic must match geometry generation (MAX_GEOMETRY_RES = 128)
        const MAX_GEOMETRY_RES = 128;
        const tWidth = terrainData?.width || 2;
        const tHeight = terrainData?.height || 2;
        // Use the actual geometry resolution for UV mapping to match vertex topology
        const widthSegments = Math.min(tWidth, MAX_GEOMETRY_RES) - 1;
        const heightSegments = Math.min(tHeight, MAX_GEOMETRY_RES) - 1;

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

        // --- MICRO-DISPLACEMENT LOGIC ---
        // Enhanced detail from texture for Satellite maps at high zoom
        // Disabled during LOD transitions for better performance
        let displacementData: Float32Array | null = null;

        const applyDisplacement = enableMicroDisplacement && !isLodTransitioning && !disableHover && baseMapName === 'Google Satellite' && lodZoom >= TERRAIN_CONFIG.DEM_MAX_LEVEL && baseMapTexture && baseMapTexture.image;

        if (applyDisplacement) {
            try {
                const img = baseMapTexture.image;
                // Create a temporary canvas to read pixels if image is not already a canvas
                let ctx: CanvasRenderingContext2D | null = null;
                if (img instanceof HTMLCanvasElement) {
                    ctx = img.getContext('2d');
                } else {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const c = canvas.getContext('2d');
                    if (c) {
                        c.drawImage(img, 0, 0);
                        ctx = c;
                    }
                }

                if (ctx) {
                    const w = img.width;
                    const h = img.height;
                    const imgData = ctx.getImageData(0, 0, w, h).data;
                    displacementData = new Float32Array(count);

                    // Strength of displacement (meters)
                    // At zoom 16+ each pixel is <2m. Trees are 5-20m.
                    const detailStrength = TERRAIN_CONFIG.MICRO_DISPLACEMENT_INTENSITY * (exaggeration / 100);

                    // We compute roughness/luminance at each vertex UV
                    const uvArr = uvAttr.array as Float32Array;

                    for (let i = 0; i < count; i++) {
                        const u = uvArr[i * 2];
                        const v = uvArr[i * 2 + 1]; // v is 0..1 (bottom to top? or top to bottom? Standard Plane is 0 bottom 1 top? No top-left usually)
                        // In our UV generation: v = 1 - (iy / heightSegments). iy=0 (top) -> v=1. iy=max -> v=0.
                        // Texture image Y: 0 is top.
                        // So imageY = (1 - v) * h.

                        // Clamp UV
                        const tx = Math.floor(Math.max(0, Math.min(1, u)) * (w - 1));
                        const ty = Math.floor(Math.max(0, Math.min(1, 1 - v)) * (h - 1));

                        const idx = (ty * w + tx) * 4;
                        const r = imgData[idx];
                        const g = imgData[idx + 1];
                        const b = imgData[idx + 2];

                        // Luminance
                        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

                        // High-pass filter approximation? 
                        // Just use straight luminance as height offset for now (Leaves/Roofs often brighter than gaps/shadows)
                        // Shift range to -0.5..0.5 so we don't just raise everything.
                        displacementData[i] = (lum - 0.5) * detailStrength;
                    }
                }
            } catch (e) {
                console.warn("Failed to calculate displacement", e);
            }
        }

        // --- END DISPLACEMENT LOGIC ---

        const positionAttr = geo.attributes.position;
        const posArray = positionAttr.array as Float32Array;

        // Pre-parse colors to avoid thousands of regex calls inside loop
        const rgbPalette = safePalette.map(hex => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255
            } : { r: 0, g: 0, b: 0 };
        });

        // Current multiplier from geometry generation logic
        const currentMultiplier = exaggeration / 100;

        for (let i = 0; i < count; i++) {
            const hRaw = heightData[i];

            // Re-apply height with exaggeration + displacement
            const relativeHeight = hRaw - visibleMin;
            let finalZ = relativeHeight * currentMultiplier;

            if (displacementData) {
                finalZ += displacementData[i];
            }

            posArray[i * 3 + 2] = finalZ;

            // Color update
            if (!baseMapTexture) { // Only update colors if no base map, save CPU
                const hNormalized = (hRaw - visibleMin) / heightRange;
                const h = Math.min(Math.max(hNormalized, 0), 1);

                const [r, g, b] = getColorFromScaleParsed(h, rgbPalette);
                colorArray[i * 3] = r;
                colorArray[i * 3 + 1] = g;
                colorArray[i * 3 + 2] = b;
            }
        }

        if (displacementData) {
            positionAttr.needsUpdate = true;
            geo.computeVertexNormals();
        }

        if (!baseMapTexture) {
            colorAttr.needsUpdate = true;
        }

        if (!baseMapTexture) {
            colorAttr.needsUpdate = true;
        }

    }, [topGeometry, visibleRange, paletteColors, baseMapTexture, terrainData?.width, terrainData?.height, lodZoom, exaggeration, baseMapName, enableMicroDisplacement]);

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
        if (!onHover || !terrainData || disableHover) return;

        // Throttle updates to ~30fps
        const now = Date.now();
        if (now - lastHoverUpdate.current < 32) return;
        lastHoverUpdate.current = now;

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
                name="terrain"
                geometry={topGeometry}
                receiveShadow
                castShadow
                scale={[1, 1, baseScale]}
                visible={!baseMapTexture}
                onPointerMove={onHover ? (e) => {
                    e.stopPropagation();
                    handlePointerMove(e);
                } : undefined}
                onPointerOut={onHover ? () => onHover(null) : undefined}
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

            {/* Top Surface - Base Map Mode (Background) */}
            <mesh
                name="terrain"
                geometry={topGeometry}
                receiveShadow
                castShadow
                scale={[1, 1, baseScale]}
                visible={!!baseMapTexture}
                onPointerMove={onHover ? (e) => {
                    e.stopPropagation();
                    handlePointerMove(e);
                } : undefined}
                onPointerOut={onHover ? () => onHover(null) : undefined}
            >
                <meshStandardMaterial
                    map={baseMapTexture}
                    vertexColors={false}
                    roughness={0.9}
                    metalness={0.0}
                    side={THREE.DoubleSide}
                    alphaMap={alphaMap}
                    transparent={shape === 'ellipse'}
                    alphaTest={shape === 'ellipse' ? 0.1 : 0}
                />
            </mesh>

            {/* Top Surface - Detail Map Mode (High Res Overlay) */}
            <mesh
                name="terrain"
                geometry={topGeometry}
                // No shadows for overlay
                scale={[1, 1, baseScale]}
                visible={!!detailMapTexture}
                renderOrder={1}
                onPointerMove={onHover ? (e) => {
                    e.stopPropagation();
                    handlePointerMove(e);
                } : undefined}
                onPointerOut={onHover ? () => onHover(null) : undefined}
            >
                <meshStandardMaterial
                    map={detailMapTexture}
                    vertexColors={false}
                    roughness={0.8}
                    metalness={0.1}
                    side={THREE.DoubleSide}
                    alphaMap={alphaMap}
                    transparent={true}
                    polygonOffset={true}
                    polygonOffsetFactor={-1}
                    alphaTest={shape === 'ellipse' ? 0.1 : 0}
                />
            </mesh>

            {/* Side Walls */}
            {showSoilProfile && (shape === 'rectangle' || shape === 'ellipse') && sideGeometries.length > 0 && (
                <>
                    {sideGeometries.map((geo, i) => (
                        <mesh key={i} geometry={geo} receiveShadow castShadow scale={[1, 1, baseScale]}>
                            <meshStandardMaterial map={sedimentTexture} roughness={1} side={THREE.DoubleSide} />
                        </mesh>
                    ))}
                </>
            )}
            {terrainData && <Contours terrainData={terrainData} exaggeration={exaggeration} shape={shape} config={contourConfig} />}
            {terrainData && <Fire exaggeration={exaggeration} terrainData={terrainData} configs={fireConfigs} bounds={activeTextureBounds} windConfig={windConfig} />}
            <Clouds exaggeration={exaggeration} cloudConfig={cloudConfig} windConfig={windConfig} />
        </group>
    );
};

export const Terrain = React.memo(TerrainComponent);

