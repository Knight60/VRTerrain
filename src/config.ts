export const TERRAIN_CONFIG = {
    // SRTM Tile settings
    // Default zoom level for fetching terrain
    ZOOM_LEVEL: 15,

    // Map Extent: Latitude and Longitude bounds of the target area
    BOUNDS: {
        latMin: 14.397022,
        lonMin: 101.013221,
        latMax: 14.403549,
        lonMax: 101.022433
    },

    // Target Area Display (for UI)
    SOURCE_TEXT: "AWS Terrain Tiles (SRTM)",

    // Default Shape: 'rectangle' or 'ellipse'
    DEFAULT_SHAPE: 'ellipse',

    // Soil Profile Depth (in meters) from the lowest point
    SOIL_DEPTH_METERS: 20,

    // Exaggeration Settings
    EXAGGERATION: {
        DEFAULT: 200,
        MIN: 0,
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

    }
};
