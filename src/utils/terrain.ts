
import { TERRAIN_CONFIG } from '../config';
import proj4 from 'proj4';

const { BOUNDS } = TERRAIN_CONFIG;

export const getTileXYZ = (lat: number, lon: number, zoom: number) => {
    const n = Math.pow(2, zoom);
    const x = Math.floor(n * ((lon + 180) / 360));
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
        (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2
    );
    return { x, y, z: zoom };
};

export const fetchTerrainTile = async (zoom = 15) => {
    // Calculate tile bounds from BOUNDS
    const minTile = getTileXYZ(BOUNDS.latMax, BOUNDS.lonMin, zoom);
    const maxTile = getTileXYZ(BOUNDS.latMin, BOUNDS.lonMax, zoom);

    const tilesX = maxTile.x - minTile.x + 1;
    const tilesY = maxTile.y - minTile.y + 1;
    const tileSize = 256;

    // Create composite canvas
    const compositeWidth = tilesX * tileSize;
    const compositeHeight = tilesY * tileSize;
    const canvas = document.createElement('canvas');
    canvas.width = compositeWidth;
    canvas.height = compositeHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');

    // Load all tiles
    const tilePromises: Promise<void>[] = [];

    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const tileX = minTile.x + tx;
            const tileY = minTile.y + ty;

            const url = TERRAIN_CONFIG.TERRAIN_TILE_URL
                .replace('{z}', zoom.toString())
                .replace('{x}', tileX.toString())
                .replace('{y}', tileY.toString());

            const promise = new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => {
                    ctx.drawImage(img, tx * tileSize, ty * tileSize);
                    resolve();
                };
                img.onerror = () => {
                    console.error(`Failed to load DEM tile ${tileX},${tileY}`);
                    resolve(); // Continue even if tile fails
                };
                img.src = url;
            });

            tilePromises.push(promise);
        }
    }

    // Wait for all tiles
    await Promise.all(tilePromises);

    // Extract elevation data from composite canvas
    const imgData = ctx.getImageData(0, 0, compositeWidth, compositeHeight);
    const { data } = imgData;
    const elevations = new Float32Array(compositeWidth * compositeHeight);

    let minH = Infinity;
    let maxH = -Infinity;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const meters = (r * 256 + g + b / 256) - 32768;

        elevations[i / 4] = meters;
        if (meters < minH) minH = meters;
        if (meters > maxH) maxH = meters;
    }

    return {
        width: compositeWidth,
        height: compositeHeight,
        data: elevations,
        minHeight: minH,
        maxHeight: maxH
    };
};

export const calculateBoundsDimensions = (bounds: typeof TERRAIN_CONFIG.BOUNDS) => {
    const { latMin, lonMin, latMax, lonMax } = bounds;
    const latMid = (latMin + latMax) / 2;
    const lonMid = (lonMin + lonMax) / 2;

    // Determine UTM zone
    const zone = Math.floor((lonMid + 180) / 6) + 1;
    const utmProjection = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;

    // WGS84
    const wgs84 = 'EPSG:4326';

    // Calculate Width (E-W at mid lat)
    const p1 = proj4(wgs84, utmProjection, [lonMin, latMid]);
    const p2 = proj4(wgs84, utmProjection, [lonMax, latMid]);
    const width = Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));

    // Calculate Height (N-S at mid lon)
    const p3 = proj4(wgs84, utmProjection, [lonMid, latMin]);
    const p4 = proj4(wgs84, utmProjection, [lonMid, latMax]);
    const height = Math.sqrt(Math.pow(p4[0] - p3[0], 2) + Math.pow(p4[1] - p3[1], 2));

    return { width, height, minDimension: Math.min(width, height) };
};
