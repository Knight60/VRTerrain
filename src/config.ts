export const TERRAIN_CONFIG = {
    // Zoom Levels
    DEM_ZOOM_LEVEL: 15, // For elevation data (max 15 for AWS SRTM)

    // Map Extent: Latitude and Longitude bounds of the target area
    //*
    BOUNDS: {
        latMin: 14.397022,
        lonMin: 101.013221,
        latMax: 14.403549,
        lonMax: 101.022433
    },
    /**/
    /*
     BOUNDS: {
         latMin: 16.828773,
         lonMin: 101.676558,
         latMax: 16.955233,
         lonMax: 101.843331,
     },
     /**/
    // Target Area Display (for UI)
    SOURCE_TEXT: "AWS Terrain Tiles (SRTM)",

    // Default Shape: 'rectangle' or 'ellipse'
    DEFAULT_SHAPE: 'rectangle',

    // Soil Profile Depth (in meters) from the lowest point
    SOIL_DEPTH_METERS: 20,

    // Visual Effects (Unreal Engine Style)
    EFFECTS: {
        BLOOM: true,
        VIGNETTE: true,
        TILT_SHIFT: false
    },

    // Display Options
    SHOW_SOIL_PROFILE: true,
    SHOW_TERRAIN_SHADOW: true,

    // Background Image
    BACKGROUND_IMAGE: '/background/studio_background.png', // Set to null or empty string to disable
    USE_BACKGROUND_IMAGE: true, // Toggle between background image and white background

    // Exaggeration Settings
    EXAGGERATION: {
        DEFAULT: 200,
        MIN: 10,
        MAX: 500
    },

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
    DEFAULT_BASE_MAP: null, // null = use color palette, or set to a key from BASE_MAPS
    BASE_MAP_ZOOM_LEVEL: 18, // Zoom level for base map tiles (higher = more detail)
};
