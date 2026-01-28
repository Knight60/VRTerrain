import { TERRAIN_CONFIG } from '../config';

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
    const centerLat = (BOUNDS.latMin + BOUNDS.latMax) / 2;
    const centerLon = (BOUNDS.lonMin + BOUNDS.lonMax) / 2;
    const { x, y, z } = getTileXYZ(centerLat, centerLon, zoom);

    // Use AWS Terrain Tiles (Terrarium format)
    // Public bucket: https://registry.opendata.aws/terrain-tiles/
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

    return new Promise<{ width: number; height: number; data: Float32Array; minHeight: number; maxHeight: number }>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas context not available'));

            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, img.width, img.height);
            const { data } = imgData;
            const elevations = new Float32Array(img.width * img.height);

            let minH = Infinity;
            let maxH = -Infinity;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // decoding terrarium
                // (red * 256 + green + blue / 256) - 32768
                const meters = (r * 256 + g + b / 256) - 32768;

                elevations[i / 4] = meters;
                if (meters < minH) minH = meters;
                if (meters > maxH) maxH = meters;
            }
            resolve({ width: img.width, height: img.height, data: elevations, minHeight: minH, maxHeight: maxH });
        };
        img.onerror = (e) => reject(new Error(`Failed to load tile image: ${url}`));
    });
};
