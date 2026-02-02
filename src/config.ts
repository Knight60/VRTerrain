export const TERRAIN_CONFIG = {

    // Map Extent: Latitude and Longitude bounds of the target area
    /*
    BOUNDS: {
        latMin: 14.397022,
        lonMin: 101.013221,
        latMax: 14.403549,
        lonMax: 101.022433
    },
    /**/
    //*
    BOUNDS: {
        latMin: 16.828773,
        lonMin: 101.676558,
        latMax: 16.955233,
        lonMax: 101.843331,
    },
    /**/

    // Camera & Navigation
    CAMERA: {
        MOVE_SPEED: 0.5,        // Speed of smoothing to target on double-click (Higher = Faster)
    },

    // elevation = (r * 256 + g + b / 256) - 32768
    DEM_SRC_NAME: "AWS Terrain Tiles (SRTM)",
    DEM_TILE_URL: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    DEM_MAX_LEVEL: 15, // For elevation data (max 15 for AWS SRTM)
    // Exaggeration Settings
    EXAGGERATION: {
        DEFAULT: 200,
        MIN: 10,
        MAX: 1000
    },
    /**/
    // Target Area Display (for UI)
    // Default Shape: 'rectangle' or 'ellipse'
    DEFAULT_SHAPE: 'rectangle',

    // Soil Profile Depth (in meters) from the lowest point
    // Soil Profile Depth
    SOIL_DEPTH_VALUE: 10,
    SOIL_DEPTH_UNIT: 'percent', // 'meters' or 'percent' of shortest bounds width

    // Display Options
    ENABLE_HOVER_INFO: true, // Show elevation and coordinates on hover
    SHOW_SOIL_PROFILE: true,
    SHOW_TERRAIN_SHADOW: true,
    ENABLE_MICRO_DISPLACEMENT: true, // Artificial roughness from satellite texture
    MICRO_DISPLACEMENT_INTENSITY: 3.0, // Strength of the displacement effect (reduced for better performance)

    AUTO_ROTATE: true, // Automatically rotate the camera around the terrain
    SHADOW_DISTANCE_VALUE: 10, // Distance of shadow from terrain base
    SHADOW_DISTANCE_UNIT: 'percent', // 'meters' or 'percent' of shortest bounds width

    // Background Image
    BACKGROUND_IMAGE: './background/studio_background.png', // Set to null or empty string to disable
    USE_BACKGROUND_IMAGE: true, // Toggle between background image and white background

    // Color Palettes
    DEFAULT_PALETTE: 'Terrain',
    PALETTES: {
        'Terrain': ['#05037eff', '#16a870ff', '#eeff00d3', '#ee2828ff', '#f18304ff', '#faf7f5ff'],
        'Tropical': ['#006400', '#228B22', '#F4A460', '#8B4513'],
        'Desert': ['#F4A460', '#D2691E', '#CD5C5C', '#8B0000'],
        'Volcanic': ['#000000', '#550000', '#aa0000', '#ff4500'],
        'Snow': ['#2f4f4f', '#708090', '#b0c4de', '#ffffff'],
        'Oceanic': ['#000080', '#0000cd', '#20b2aa', '#e0ffff'],
    },

    // Base Map Tile Servers (XYZ Tiled)
    BASE_MAPS: {
        'Google Satellite': 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        'OpenStreetMap': 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    },
    DEFAULT_BASE_MAP: 'Google Satellite', // null = use color palette, or set to a key from BASE_MAPS
    BASE_MAP_ZOOM_LEVEL: 18, // Zoom level for base map tiles (higher = more detail)

    // Cloud Settings
    CLOUDS: {
        ENABLED: false,
        CLOUD_TEXTURE_URL: './cloud/cloud.png',
        GLOBAL_HEIGHT_OFFSET: 0, // Add/subtract km to all clouds
        GLOBAL_HEIGHT_SCALAR: 0.1, // Scale all cloud heights
        LAYERS: [
            // Level 1: Low, Sparse (0.5 - 2 km)
            { minAlt: 1.0, maxAlt: 7.0, count: 0, opacity: 0.3, minSize: 10, maxSize: 30, color: '#ffffff' },
            // Level 2: Mid, Medium (2 - 6 km)
            { minAlt: 5.0, maxAlt: 12.0, count: 500, opacity: 0.2, minSize: 70, maxSize: 100, color: '#ffffff' },
            // Level 3: High, Dense (10 - 20 km)
            { minAlt: 10.0, maxAlt: 20.0, count: 800, opacity: 0.1, minSize: 100, maxSize: 200, color: '#fff0e0' }
        ]
    },

    // Wind Settings (matches Cloud Layers)
    WIND: {
        ENABLED: true,
        LAYERS: [
            { speed: 0.5, direction: 270 }, // Direction in degrees (0 = North, 90 = East, 180 = South, 270 = West)
            { speed: 15, direction: 270 },
            { speed: 25, direction: 270 }
        ]
    },

    // Contour Lines Settings
    CONTOURS: {
        ENABLED: true,              // Show/hide contour lines
        INTERVAL: 20,               // Minor contour interval in meters
        MAJOR_INTERVAL: 100,        // Major contour interval (every 5 minor = 100m)
        // Minor contours (every 20m)
        MINOR_LINE_COLOR: '#686868', // Gray for minor lines
        MINOR_LINE_WIDTH: 1.0,       // Thinner
        MINOR_LINE_OPACITY: 0.5,     // More transparent
        // Major contours (every 100m)
        MAJOR_LINE_COLOR: '#333333', // Darker for major lines
        MAJOR_LINE_WIDTH: 2.0,       // Thicker
        MAJOR_LINE_OPACITY: 0.7,     // More visible
        // Labels
        SHOW_LABELS: true,          // Show elevation labels
        LABEL_COLOR: '#222222',     // Dark color for labels
        LABEL_BASE_SIZE: 0.5,       // Base size of labels
    },

    // Fire Effect Settings
    FIRE_TEXTURE_URL: './fire/Fire.png',
    FIRES: [
        {
            ENABLED: true,
            LOCATIONS: [
                { lat: 16.868028, lon: 101.781342, scale: 1.0, intensity: 1.0 },
            ],
            COLOR_INNER: '#ffaa00',     // Inner flame color (yellow-orange)
            COLOR_OUTER: '#ff3300',     // Outer flame color (red-orange)
            HEIGHT: 2.0,                // Fire height in world units
            HEIGHT_OFFSET: 100.0,       // Height offset in meters
            SPREAD: 0.5,                // Fire spread radius
            ITERATIONS: 6,              // Raymarching iterations (reduced for better performance)
            OCTAVES: 1,                 // Noise octaves (reduced for better performance)
            SMOKE: {
                ENABLED: true,
                HEIGHT_MAX: 100.0,       // Smoke rise height in meters
                HEIGHT_MIN: 10.0,          // Meters (not currently used)
                DISPERSION: 1.2,       // Horizontal spread factor
                SPEED: 2.0,             // Vertical rise speed (meters/sec)
                SIZE: 20,             // Particle base size (larger = bigger smoke puffs)
                SIZE_GROWTH: 20.0,      // Size expansion with height
                OPACITY: 0.8,           // Base opacity (0-1)
                COLOR_INNER: '#e6e6e6', // Inner gradient color
                COLOR_OUTER: '#000000', // Outer gradient color
                COLOR_RATIO: 0.8        // Gradient smoothing ratio (0-1)
            }
        }
    ],

    // Visual Effects (Unreal Engine Style)
    EFFECTS: {
        BLOOM: true,
        VIGNETTE: true,
        TILT_SHIFT: false
    },
};
