import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config';

/**
 * Calculate visible bounds based on camera position and frustum
 * Returns a subset of TERRAIN_CONFIG.BOUNDS that is visible
 */
export const calculateVisibleBounds = (
    camera: THREE.Camera,
    fullBounds: typeof TERRAIN_CONFIG.BOUNDS
): typeof TERRAIN_CONFIG.BOUNDS => {
    const { latMin, latMax, lonMin, lonMax } = fullBounds;

    // If camera is far away, return full bounds
    const cameraPosition = camera.position;
    const distanceToOrigin = cameraPosition.distanceTo(new THREE.Vector3(0, 0, 0));

    // If distance > 150 units (far view), use full bounds
    if (distanceToOrigin > 150) {
        return fullBounds;
    }

    // Calculate visible range based on camera position
    // Camera is looking at terrain which is 100x100 units (-50 to 50)
    // We can estimate the visible area from camera position

    // For close-up views, limit the bounds to approximately what's visible
    // Estimate: at distance D, visible range is roughly D * tan(FOV/2) * 2
    const fov = 'fov' in camera ? (camera as THREE.PerspectiveCamera).fov : 45;
    const fovRad = (fov * Math.PI) / 180;
    const visibleRange = distanceToOrigin * Math.tan(fovRad / 2) * 2;

    // Add 20% margin for smooth transitions
    const margin = visibleRange * 0.2;
    const effectiveRange = (visibleRange + margin) / 100; // Convert from world units to 0-1 range

    // Clamp to 0.2 minimum (20% of bounds) and 1.0 maximum (full bounds)
    const rangeFactor = Math.min(1.0, Math.max(0.2, effectiveRange));

    // Calculate center of view (currently assuming camera looks at origin)
    // For more accuracy, we could raycast to terrain
    const centerLat = (latMin + latMax) / 2;
    const centerLon = (lonMin + lonMax) / 2;

    // Calculate visible bounds
    const latRange = (latMax - latMin) * rangeFactor;
    const lonRange = (lonMax - lonMin) * rangeFactor;

    const visibleLatMin = Math.max(latMin, centerLat - latRange / 2);
    const visibleLatMax = Math.min(latMax, centerLat + latRange / 2);
    const visibleLonMin = Math.max(lonMin, centerLon - lonRange / 2);
    const visibleLonMax = Math.min(lonMax, centerLon + lonRange / 2);

    return {
        latMin: visibleLatMin,
        latMax: visibleLatMax,
        lonMin: visibleLonMin,
        lonMax: visibleLonMax
    };
};

/**
 * Calculate optimal tile count limit based on zoom level and distance
 * Prevents loading too many tiles at high zoom levels
 */
export const calculateMaxTiles = (zoom: number, distance: number): number => {
    // At zoom 16, limit to much fewer tiles when close up
    if (zoom >= 15) {
        if (distance < 50) return 16;  // 4x4 tiles max when very close
        if (distance < 100) return 36; // 6x6 tiles max when medium close
        return 64; // 8x8 tiles max when far
    }

    if (zoom >= 13) {
        return 100; // 10x10 tiles max
    }

    return 400; // 20x20 tiles max for lower zooms
};

/**
 * Estimate tile count for given bounds at zoom level
 */
export const estimateTileCount = (
    bounds: typeof TERRAIN_CONFIG.BOUNDS,
    zoom: number
): number => {
    const getTileXYZ = (lat: number, lon: number, zoom: number) => {
        const n = Math.pow(2, zoom);
        const x = Math.floor(n * ((lon + 180) / 360));
        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(
            (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2
        );
        return { x, y };
    };

    const minTile = getTileXYZ(bounds.latMax, bounds.lonMin, zoom);
    const maxTile = getTileXYZ(bounds.latMin, bounds.lonMax, zoom);

    const tilesX = maxTile.x - minTile.x + 1;
    const tilesY = maxTile.y - minTile.y + 1;

    return tilesX * tilesY;
};
