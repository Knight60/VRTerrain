
import React, { Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky, Environment, Stars } from '@react-three/drei'
import { Terrain } from './components/Terrain'
import { CameraTracker } from './components/CameraTracker'
import { TERRAIN_CONFIG } from './config'
import { calculateBoundsDimensions } from './utils/terrain'
import * as THREE from 'three'
import proj4 from 'proj4'

// Update OrbitControls target to actual terrain surface at screen center
const PivotSetter: React.FC<{
    isInteracting: boolean;
    controlsRef: React.RefObject<any>;
}> = ({ isInteracting, controlsRef }) => {
    const { camera, scene } = useThree();
    const raycaster = React.useMemo(() => new THREE.Raycaster(), []);

    // Check on interval or when interaction stops
    React.useEffect(() => {
        if (!isInteracting && controlsRef.current) {
            // Raycast from center of screen (0,0)
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

            // Intersect with scene objects (filtered by name 'terrain')
            // Note: We intersect only recursive children.
            // Performance: This is done once after interaction, so slight cost is acceptable.
            const intersects = raycaster.intersectObjects(scene.children, true);
            const terrainHit = intersects.find(hit => hit.object.name === 'terrain');

            if (terrainHit) {
                // Determine new target
                const newTarget = terrainHit.point;
                const currentTarget = controlsRef.current.target;

                // Only update if significantly different to avoid micro-jitter
                if (newTarget.distanceTo(currentTarget) > 0.1) {
                    controlsRef.current.target.copy(newTarget);
                }
            }
        }
    }, [isInteracting, camera, scene, controlsRef, raycaster]);

    return null;
};

function App() {
    const [shape, setShape] = React.useState<'rectangle' | 'ellipse'>(TERRAIN_CONFIG.DEFAULT_SHAPE as 'rectangle' | 'ellipse');
    const [exaggeration, setExaggeration] = React.useState(TERRAIN_CONFIG.EXAGGERATION.DEFAULT);
    const [paletteData, setPaletteData] = React.useState<string[]>(TERRAIN_CONFIG.PALETTES[TERRAIN_CONFIG.DEFAULT_PALETTE as keyof typeof TERRAIN_CONFIG.PALETTES]);
    const [paletteName, setPaletteName] = React.useState(TERRAIN_CONFIG.DEFAULT_PALETTE);
    const [baseMapName, setBaseMapName] = React.useState<string | null>(TERRAIN_CONFIG.DEFAULT_BASE_MAP);
    const [elevationRange, setElevationRange] = React.useState<{ min: number; max: number } | null>(null);
    const [effects, setEffects] = React.useState(TERRAIN_CONFIG.EFFECTS);
    const [showSoilProfile, setShowSoilProfile] = React.useState(TERRAIN_CONFIG.SHOW_SOIL_PROFILE);
    const [showTerrainShadow, setShowTerrainShadow] = React.useState(TERRAIN_CONFIG.SHOW_TERRAIN_SHADOW);
    const [enableMicroDisplacement, setEnableMicroDisplacement] = React.useState(TERRAIN_CONFIG.ENABLE_MICRO_DISPLACEMENT);
    const [autoRotate, setAutoRotate] = React.useState(TERRAIN_CONFIG.AUTO_ROTATE);
    const [useBackgroundImage, setUseBackgroundImage] = React.useState(TERRAIN_CONFIG.USE_BACKGROUND_IMAGE);
    const [compassRotation, setCompassRotation] = React.useState(0);
    const [hoverInfo, setHoverInfo] = React.useState<{ height: number; lat: number; lon: number } | null>(null);
    const [isInteracting, setIsInteracting] = React.useState(false);
    const [showCloudDialog, setShowCloudDialog] = React.useState(false);
    const [showContourDialog, setShowContourDialog] = React.useState(false);
    const [showFireDialog, setShowFireDialog] = React.useState(false);
    const [cloudConfig, setCloudConfig] = React.useState({
        enabled: TERRAIN_CONFIG.CLOUDS.ENABLED,
        globalHeightOffset: TERRAIN_CONFIG.CLOUDS.GLOBAL_HEIGHT_OFFSET,
        globalHeightScalar: TERRAIN_CONFIG.CLOUDS.GLOBAL_HEIGHT_SCALAR,
        layers: TERRAIN_CONFIG.CLOUDS.LAYERS.map(l => ({ ...l }))
    });
    const [contourConfig, setContourConfig] = React.useState({
        enabled: TERRAIN_CONFIG.CONTOURS.ENABLED,
        interval: TERRAIN_CONFIG.CONTOURS.INTERVAL,
        majorInterval: TERRAIN_CONFIG.CONTOURS.MAJOR_INTERVAL,
        showLabels: TERRAIN_CONFIG.CONTOURS.SHOW_LABELS,
        minorOpacity: TERRAIN_CONFIG.CONTOURS.MINOR_LINE_OPACITY,
        majorOpacity: TERRAIN_CONFIG.CONTOURS.MAJOR_LINE_OPACITY,
    });
    const [fireConfig, setFireConfig] = React.useState({
        enabled: TERRAIN_CONFIG.FIRES[0].ENABLED,
        height: TERRAIN_CONFIG.FIRES[0].HEIGHT,
        heightOffset: TERRAIN_CONFIG.FIRES[0].HEIGHT_OFFSET,
        spread: TERRAIN_CONFIG.FIRES[0].SPREAD,
        iterations: TERRAIN_CONFIG.FIRES[0].ITERATIONS,
        octaves: TERRAIN_CONFIG.FIRES[0].OCTAVES,
    });

    const controlsRef = React.useRef<any>(null);

    const resetNorth = () => {
        if (controlsRef.current) {
            controlsRef.current.setAzimuthalAngle(0);
        }
    };

    // Toggle helper
    const toggleEffect = (key: keyof typeof TERRAIN_CONFIG.EFFECTS) => {
        setEffects(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleHeightRangeChange = React.useCallback((min: number, max: number) => {
        setElevationRange({ min, max });
    }, []);

    // Calculate effect parameters
    const ambientIntensity = effects.BLOOM ? 0.7 : 0.5;
    const directionalIntensity = effects.BLOOM ? 2.0 : 1.5;
    const fogNear = effects.VIGNETTE ? 40 : 50;
    const fogFar = effects.VIGNETTE ? 250 : 300;
    const fogColor = effects.TILT_SHIFT ? '#e8f4ff' : '#dceeff';

    return (
        <div
            className="relative w-full h-full"
            style={{
                background: useBackgroundImage && TERRAIN_CONFIG.BACKGROUND_IMAGE
                    ? `url(${TERRAIN_CONFIG.BACKGROUND_IMAGE}) center/cover`
                    : '#ffffff',
            }}
        >
            {/* UI Overlay */}
            < div className="absolute top-6 left-6 z-10 text-white font-sans pointer-events-none select-none" >
                <h1 className="text-4xl font-bold drop-shadow-lg tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                    Terrain Explorer
                </h1>
                <div className="mt-2 text-sm text-gray-200 bg-black/30 backdrop-blur-md p-3 rounded-lg border border-white/10 inline-block pointer-events-auto">
                    <p className="font-semibold text-emerald-300">Target Area:</p>
                    <p>Lat: {TERRAIN_CONFIG.BOUNDS.latMin.toFixed(3)} - {TERRAIN_CONFIG.BOUNDS.latMax.toFixed(3)}</p>
                    <p>Lon: {TERRAIN_CONFIG.BOUNDS.lonMin.toFixed(3)} - {TERRAIN_CONFIG.BOUNDS.lonMax.toFixed(3)}</p>
                    <p className="mt-1 text-xs text-gray-400">Source: {TERRAIN_CONFIG.DEM_SRC_NAME}</p>

                    <div className="mt-4 border-t border-white/10 pt-3 space-y-4">
                        <div>
                            <p className="font-semibold text-emerald-300 mb-2">Display Shape:</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setShape('rectangle')}
                                    className={`px-3 py-2 rounded-md text-xs font-medium transition-colors border text-center ${shape === 'rectangle'
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                        }`}
                                >
                                    Rectangle
                                </button>
                                <button
                                    onClick={() => setShape('ellipse')}
                                    className={`px-3 py-2 rounded-md text-xs font-medium transition-colors border text-center ${shape === 'ellipse'
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                        }`}
                                >
                                    Ellipse
                                </button>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <p className="font-semibold text-emerald-300">Vertical Exaggeration:</p>
                                <span className="text-xs text-white bg-white/10 px-1.5 py-0.5 rounded">{exaggeration}%</span>
                            </div>
                            <input
                                type="range"
                                min={TERRAIN_CONFIG.EXAGGERATION.MIN}
                                max={TERRAIN_CONFIG.EXAGGERATION.MAX}
                                step={10}
                                value={exaggeration}
                                onChange={(e) => setExaggeration(Number(e.target.value))}
                                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                            />
                        </div>

                        {elevationRange && (
                            <div className="flex justify-between text-xs text-gray-300 pt-1 border-t border-white/5 mt-1">
                                <span>Min: {elevationRange.min.toFixed(0)}m</span>
                                <span>Max: {elevationRange.max.toFixed(0)}m</span>
                            </div>
                        )}

                        <div>
                            <p className="font-semibold text-emerald-300 mb-2">Color Palette:</p>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(TERRAIN_CONFIG.PALETTES).map(([key, colors]) => (
                                    <button
                                        key={key}
                                        onClick={() => {
                                            setPaletteName(key);
                                            setPaletteData(colors);
                                            setBaseMapName(null); // Deselect base map
                                        }}
                                        className={`p-2 rounded-md border text-left flex flex-col gap-1 transition-colors ${paletteName === key && !baseMapName
                                            ? 'bg-emerald-500/20 border-emerald-500'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                                            }`}
                                    >
                                        <span className={`text-xs font-medium ${paletteName === key && !baseMapName ? 'text-emerald-300' : 'text-gray-400'}`}>
                                            {key}
                                        </span>
                                        <div className="h-2 w-full rounded-sm overflow-hidden flex">
                                            {colors.map((c, i) => (
                                                <div key={i} style={{ backgroundColor: c }} className="flex-1 h-full" />
                                            ))}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className="font-semibold text-emerald-300 mb-2">Base Map:</p>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.keys(TERRAIN_CONFIG.BASE_MAPS).map((key) => (
                                    <button
                                        key={key}
                                        onClick={() => {
                                            setBaseMapName(key);
                                            setPaletteName(''); // Deselect palette
                                        }}
                                        className={`px-3 py-2 rounded-md text-xs font-medium transition-colors border text-left ${baseMapName === key
                                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                            }`}
                                    >
                                        {key}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className="font-semibold text-emerald-300 mb-2">Unreal FX:</p>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={effects.BLOOM}
                                        onChange={() => toggleEffect('BLOOM')}
                                        className="accent-emerald-500"
                                    />
                                    Enhanced Lighting
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={effects.VIGNETTE}
                                        onChange={() => toggleEffect('VIGNETTE')}
                                        className="accent-emerald-500"
                                    />
                                    Atmospheric Depth
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={effects.TILT_SHIFT}
                                        onChange={() => toggleEffect('TILT_SHIFT')}
                                        className="accent-emerald-500"
                                    />
                                    Bright Sky Mode
                                </label>
                            </div>
                        </div>

                        <div>
                            <p className="font-semibold text-emerald-300 mb-2">Display Options:</p>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showSoilProfile}
                                        onChange={() => setShowSoilProfile(!showSoilProfile)}
                                        className="accent-emerald-500"
                                    />
                                    Soil Profile (Cross-Section)
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showTerrainShadow}
                                        onChange={() => setShowTerrainShadow(!showTerrainShadow)}
                                        className="accent-emerald-500"
                                    />
                                    Terrain Shadow
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={enableMicroDisplacement}
                                        onChange={() => setEnableMicroDisplacement(!enableMicroDisplacement)}
                                        className="accent-emerald-500"
                                    />
                                    Micro-Displacement (Roughness)
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={autoRotate}
                                        onChange={() => setAutoRotate(!autoRotate)}
                                        className="accent-emerald-500"
                                    />
                                    Auto Rotate
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={useBackgroundImage}
                                        onChange={() => setUseBackgroundImage(!useBackgroundImage)}
                                        className="accent-emerald-500"
                                    />
                                    Studio Background
                                </label>
                                <button
                                    onClick={() => setShowCloudDialog(true)}
                                    className="mt-2 w-full px-3 py-2 rounded-md text-xs font-medium transition-colors border bg-cyan-500/20 border-cyan-500 text-cyan-300 hover:bg-cyan-500/30"
                                >
                                    ☁️ Cloud Configuration
                                </button>
                                <button
                                    onClick={() => setShowContourDialog(true)}
                                    className="mt-2 w-full px-3 py-2 rounded-md text-xs font-medium transition-colors border bg-amber-500/20 border-amber-500 text-amber-300 hover:bg-amber-500/30"
                                >
                                    📊 Contour Configuration
                                </button>
                                <button
                                    onClick={() => setShowFireDialog(true)}
                                    className="mt-2 w-full px-3 py-2 rounded-md text-xs font-medium transition-colors border bg-orange-500/20 border-orange-500 text-orange-300 hover:bg-orange-500/30"
                                >
                                    🔥 Fire Configuration
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div >

            {/* Cloud Configuration Dialog */}
            {
                showCloudDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-gray-900/95 border border-white/20 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-emerald-400">☁️ Cloud Configuration</h2>
                                <button
                                    onClick={() => setShowCloudDialog(false)}
                                    className="text-gray-400 hover:text-white text-2xl leading-none"
                                >
                                    ×
                                </button>
                            </div>

                            {/* Global Settings */}
                            <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10">
                                <h3 className="text-sm font-semibold text-cyan-300 mb-3">Global Settings</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="flex items-center gap-2 text-xs text-gray-300">
                                        <input
                                            type="checkbox"
                                            checked={cloudConfig.enabled}
                                            onChange={(e) => setCloudConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                                            className="accent-emerald-500"
                                        />
                                        Enable Clouds
                                    </label>
                                    <div>
                                        <label className="text-xs text-gray-400">Height Scalar</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={cloudConfig.globalHeightScalar}
                                            onChange={(e) => setCloudConfig(prev => ({ ...prev, globalHeightScalar: parseFloat(e.target.value) || 0 }))}
                                            className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400">Height Offset (km)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={cloudConfig.globalHeightOffset}
                                            onChange={(e) => setCloudConfig(prev => ({ ...prev, globalHeightOffset: parseFloat(e.target.value) || 0 }))}
                                            className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Layer Settings */}
                            {cloudConfig.layers.map((layer, index) => (
                                <div key={index} className="mb-4 p-4 bg-white/5 rounded-lg border border-white/10">
                                    <h3 className="text-sm font-semibold text-cyan-300 mb-3">Layer {index + 1}</h3>
                                    <div className="grid grid-cols-4 gap-3">
                                        <div>
                                            <label className="text-xs text-gray-400">Min Alt (km)</label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={layer.minAlt}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], minAlt: parseFloat(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Max Alt (km)</label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={layer.maxAlt}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], maxAlt: parseFloat(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Count</label>
                                            <input
                                                type="number"
                                                step="10"
                                                value={layer.count}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], count: parseInt(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Opacity</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                max="1"
                                                value={layer.opacity}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], opacity: parseFloat(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Min Size</label>
                                            <input
                                                type="number"
                                                step="5"
                                                value={layer.minSize}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], minSize: parseInt(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Max Size</label>
                                            <input
                                                type="number"
                                                step="5"
                                                value={layer.maxSize}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], maxSize: parseInt(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Speed</label>
                                            <input
                                                type="number"
                                                step="1"
                                                value={layer.speed}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], speed: parseFloat(e.target.value) || 0 };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">Color</label>
                                            <input
                                                type="color"
                                                value={layer.color}
                                                onChange={(e) => {
                                                    const newLayers = [...cloudConfig.layers];
                                                    newLayers[index] = { ...newLayers[index], color: e.target.value };
                                                    setCloudConfig(prev => ({ ...prev, layers: newLayers }));
                                                }}
                                                className="w-full mt-1 h-7 bg-black/30 border border-white/20 rounded cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}

                            <div className="flex justify-end gap-3 mt-4">
                                <button
                                    onClick={() => setShowCloudDialog(false)}
                                    className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Contour Configuration Dialog */}
            {
                showContourDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-gray-900/95 border border-white/20 rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-amber-400">📊 Contour Configuration</h2>
                                <button
                                    onClick={() => setShowContourDialog(false)}
                                    className="text-gray-400 hover:text-white text-2xl leading-none"
                                >
                                    ×
                                </button>
                            </div>

                            <div className="space-y-4">
                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={contourConfig.enabled}
                                        onChange={(e) => setContourConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                                        className="accent-amber-500"
                                    />
                                    Enable Contour Lines
                                </label>

                                <div>
                                    <label className="text-xs text-gray-400">Minor Interval (m)</label>
                                    <input
                                        type="number"
                                        step="5"
                                        value={contourConfig.interval}
                                        onChange={(e) => setContourConfig(prev => ({ ...prev, interval: parseInt(e.target.value) || 20 }))}
                                        className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400">Major Interval (m)</label>
                                    <input
                                        type="number"
                                        step="10"
                                        value={contourConfig.majorInterval}
                                        onChange={(e) => setContourConfig(prev => ({ ...prev, majorInterval: parseInt(e.target.value) || 100 }))}
                                        className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                    />
                                </div>

                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={contourConfig.showLabels}
                                        onChange={(e) => setContourConfig(prev => ({ ...prev, showLabels: e.target.checked }))}
                                        className="accent-amber-500"
                                    />
                                    Show Labels
                                </label>

                                <div>
                                    <label className="text-xs text-gray-400">Minor Line Opacity: {contourConfig.minorOpacity.toFixed(2)}</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={contourConfig.minorOpacity}
                                        onChange={(e) => setContourConfig(prev => ({ ...prev, minorOpacity: parseFloat(e.target.value) }))}
                                        className="w-full mt-1 accent-amber-500"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400">Major Line Opacity: {contourConfig.majorOpacity.toFixed(2)}</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={contourConfig.majorOpacity}
                                        onChange={(e) => setContourConfig(prev => ({ ...prev, majorOpacity: parseFloat(e.target.value) }))}
                                        className="w-full mt-1 accent-amber-500"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-4">
                                <button
                                    onClick={() => setShowContourDialog(false)}
                                    className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Fire Configuration Dialog */}
            {
                showFireDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-gray-900/95 border border-white/20 rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-orange-400">🔥 Fire Configuration</h2>
                                <button
                                    onClick={() => setShowFireDialog(false)}
                                    className="text-gray-400 hover:text-white text-2xl leading-none"
                                >
                                    ×
                                </button>
                            </div>

                            <div className="space-y-4">
                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={fireConfig.enabled}
                                        onChange={(e) => setFireConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                                        className="accent-orange-500"
                                    />
                                    Enable Fire Effects
                                </label>

                                <div>
                                    <label className="text-xs text-gray-400">Fire Height</label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={fireConfig.height}
                                        onChange={(e) => setFireConfig(prev => ({ ...prev, height: parseFloat(e.target.value) || 2 }))}
                                        className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400">Height Offset (m)</label>
                                    <input
                                        type="number"
                                        step="1"
                                        value={fireConfig.heightOffset}
                                        onChange={(e) => setFireConfig(prev => ({ ...prev, heightOffset: parseFloat(e.target.value) || 0 }))}
                                        className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-400">Fire Spread</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={fireConfig.spread}
                                        onChange={(e) => setFireConfig(prev => ({ ...prev, spread: parseFloat(e.target.value) || 0.5 }))}
                                        className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                    />
                                </div>

                                <div className="border-t border-white/10 pt-4 mt-4">
                                    <h3 className="text-sm font-semibold text-orange-300 mb-3">Performance Settings</h3>

                                    <div>
                                        <label className="text-xs text-gray-400">Iterations (8-20, lower = faster)</label>
                                        <input
                                            type="number"
                                            min="4"
                                            max="30"
                                            step="2"
                                            value={fireConfig.iterations}
                                            onChange={(e) => setFireConfig(prev => ({ ...prev, iterations: parseInt(e.target.value) || 10 }))}
                                            className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                        />
                                    </div>

                                    <div className="mt-3">
                                        <label className="text-xs text-gray-400">Octaves (1-3, lower = faster)</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="4"
                                            step="1"
                                            value={fireConfig.octaves}
                                            onChange={(e) => setFireConfig(prev => ({ ...prev, octaves: parseInt(e.target.value) || 2 }))}
                                            className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/20 rounded text-white text-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-4">
                                <button
                                    onClick={() => setShowFireDialog(false)}
                                    className="px-4 py-2 rounded-md text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            <Canvas
                shadows
                camera={{
                    // Terrain is 100x100 units. Show with 50% margin = 150 units view.
                    // FOV 45°, tan(22.5°) ≈ 0.414. Distance = 75 / 0.414 ≈ 181
                    // Position camera at 45° angle looking down at center
                    position: [0, 130, 130], // Elevated view with 50% margin
                    fov: 45
                }}
                dpr={[1, 1.5]}
                gl={{
                    alpha: true,
                    premultipliedAlpha: false,
                    antialias: true,
                    powerPreference: "high-performance",
                    stencil: false,
                    depth: true
                }}
                onCreated={({ gl }) => {
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = 1.0;
                    gl.setClearColor(0x000000, 0); // Fully transparent
                }}
                style={{ background: 'transparent' }}
                performance={{ min: 0.5 }}
                frameloop="always"
            >
                <PivotSetter isInteracting={isInteracting} controlsRef={controlsRef} />
                {/* Atmosphere & Lighting */}
                {/* <fog attach="fog" args={[fogColor, fogNear, fogFar]} /> */}
                <ambientLight intensity={ambientIntensity} />

                {/* Camera Tracker for Compass */}
                <CameraTracker onRotationChange={setCompassRotation} />

                <directionalLight
                    position={[100, 100, 50]}
                    intensity={directionalIntensity}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                    shadow-camera-left={-100}
                    shadow-camera-right={100}
                    shadow-camera-top={100}
                    shadow-camera-bottom={-100}
                    shadow-camera-near={0.5}
                    shadow-camera-far={500}
                    shadow-bias={-0.0001}
                />
                {effects.BLOOM && (
                    <pointLight position={[0, 50, 0]} intensity={0.3} distance={100} color="#ffffff" />
                )}

                <Suspense fallback={null}>
                    <Terrain
                        shape={shape}
                        exaggeration={exaggeration}
                        paletteColors={paletteData}
                        onHeightRangeChange={handleHeightRangeChange}
                        showSoilProfile={showSoilProfile}
                        baseMapName={baseMapName}
                        onHover={TERRAIN_CONFIG.ENABLE_HOVER_INFO ? setHoverInfo : undefined}
                        enableMicroDisplacement={enableMicroDisplacement}
                        disableHover={isInteracting}
                        cloudConfig={cloudConfig}
                        contourConfig={contourConfig}
                        fireConfigs={React.useMemo(() => {
                            const firstFire = {
                                ...TERRAIN_CONFIG.FIRES[0],
                                ENABLED: fireConfig.enabled,
                                HEIGHT: fireConfig.height,
                                HEIGHT_OFFSET: fireConfig.heightOffset,
                                SPREAD: fireConfig.spread,
                                ITERATIONS: fireConfig.iterations,
                                OCTAVES: fireConfig.octaves,
                            };
                            return [firstFire, ...TERRAIN_CONFIG.FIRES.slice(1)];
                        }, [fireConfig])}
                    />

                    {/* Shadow Plane */}
                    <ShadowPlane
                        show={showTerrainShadow}
                        shape={shape}
                        exaggeration={exaggeration}
                    />
                    <Environment preset="forest" background={false} />
                    {/* Sky component creates background - disabled to show custom image */}
                    {/* <Sky
                        distance={450000}
                        sunPosition={[100, 40, 50]}
                        inclination={0}
                        azimuth={0.25}
                        turbidity={effects.TILT_SHIFT ? 5 : 10}
                        rayleigh={effects.TILT_SHIFT ? 3 : 2}
                    /> */}
                </Suspense>

                <OrbitControls
                    ref={controlsRef}
                    enableDamping
                    dampingFactor={0.03}
                    rotateSpeed={1.0}
                    zoomSpeed={1.2}
                    panSpeed={0.8}
                    maxPolarAngle={Math.PI / 2 - 0.05}
                    minDistance={10}
                    maxDistance={250}
                    autoRotate={autoRotate}
                    autoRotateSpeed={0.5}
                    onStart={() => setIsInteracting(true)}
                    onEnd={() => setIsInteracting(false)}
                />
            </Canvas>

            {/* Height Indicator */}
            {
                hoverInfo && (() => {
                    // Calculate UTM
                    const zone = Math.floor((hoverInfo.lon + 180) / 6) + 1;
                    const utmProjection = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
                    const wgs84 = 'EPSG:4326'; // proj4 checks for this string or definition
                    const [utmX, utmY] = proj4(wgs84, utmProjection, [hoverInfo.lon, hoverInfo.lat]);

                    return (
                        <div className="absolute bottom-6 left-6 z-10 text-[#0066B0] font-mono font-bold text-sm pointer-events-none bg-white/10 px-4 py-2 rounded backdrop-blur-md border border-white/20 select-none drop-shadow-md flex flex-col gap-1">
                            <div>Elevation: {hoverInfo.height.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m</div>
                            <div className="text-xs text-white/80">
                                Lat: {hoverInfo.lat.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}<br />
                                Lon: {hoverInfo.lon.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}
                            </div>
                            <div className="text-xs text-emerald-400 mt-1">
                                UTM Zone: {zone}N<br />
                                E: {utmX.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br />
                                N: {utmY.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>
                    );
                })()
            }

            <div className="absolute bottom-6 right-6 z-10 text-right pointer-events-none">
                <div className="text-gray/40 text-xs space-y-1">
                    <p>Developed by Pisut.Nak</p>
                    <p>Powered by Vite + React + Three.js</p>
                    <p>Controls: LMB Rotate | RMB Pan | Scroll Zoom</p>
                </div>
            </div>

            {/* North Arrow */}
            {/* North Arrow */}
            <div
                className="absolute top-1/2 right-8 z-10 pointer-events-auto transform -translate-y-1/2 cursor-pointer hover:scale-110 transition-transform duration-200"
                onClick={resetNorth}
                title="Reset to North"
            >
                <div className="relative w-20 h-20 flex items-center justify-center">
                    {/* Compass Circle */}
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 backdrop-blur-md border-2 border-white/30 shadow-2xl"></div>

                    {/* North Arrow SVG */}
                    <svg width="60" height="60" viewBox="0 0 60 60" className="relative z-10 drop-shadow-lg" style={{ transform: `rotate(${compassRotation}deg)`, transition: 'transform 0.1s ease-out' }}>
                        {/* Arrow Shadow */}
                        <path
                            d="M 30 10 L 37 35 L 30 32 L 23 35 Z"
                            fill="rgba(0,0,0,0.3)"
                            transform="translate(1, 1)"
                        />
                        {/* North Arrow (Red) */}
                        <path
                            d="M 30 10 L 37 35 L 30 32 Z"
                            fill="#ef4444"
                            stroke="#fff"
                            strokeWidth="0.5"
                        />
                        {/* South Arrow (White) */}
                        <path
                            d="M 30 32 L 23 35 L 30 10 Z"
                            fill="#f8fafc"
                            stroke="#fff"
                            strokeWidth="0.5"
                        />
                        {/* Center Dot */}
                        <circle cx="30" cy="32" r="3" fill="#1e293b" stroke="#fff" strokeWidth="1" />

                        {/* Cardinal Directions */}
                        <text x="30" y="8" textAnchor="middle" className="fill-white font-bold text-xs" style={{ fontSize: '10px' }}>N</text>
                        <text x="52" y="35" textAnchor="middle" className="fill-white/60 font-semibold text-xs" style={{ fontSize: '8px' }}>E</text>
                        <text x="30" y="55" textAnchor="middle" className="fill-white/60 font-semibold text-xs" style={{ fontSize: '8px' }}>S</text>
                        <text x="8" y="35" textAnchor="middle" className="fill-white/60 font-semibold text-xs" style={{ fontSize: '8px' }}>W</text>
                    </svg>
                </div>
            </div>
        </div >
    )
}

// Extracted ShadowPlane component to prevent re-rendering/re-creating textures on every App render
const ShadowPlane = React.memo(({ show, shape, exaggeration }: { show: boolean, shape: 'rectangle' | 'ellipse', exaggeration: number }) => {
    const alphaMap = React.useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        if (shape === 'ellipse') {
            const gradient = ctx.createRadialGradient(256, 256, 100, 256, 256, 256);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
            gradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.5)');
            gradient.addColorStop(0.9, 'rgba(255, 255, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 512, 512);
        } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, 512, 512);
            const edgeBlur = 250;
            const gradTop = ctx.createLinearGradient(0, 0, 0, edgeBlur);
            gradTop.addColorStop(0, 'rgba(0, 0, 0, 1)');
            gradTop.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = gradTop;
            ctx.fillRect(0, 0, 512, edgeBlur);
            const gradBottom = ctx.createLinearGradient(0, 512 - edgeBlur, 0, 512);
            gradBottom.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradBottom.addColorStop(1, 'rgba(0, 0, 0, 1)');
            ctx.fillStyle = gradBottom;
            ctx.fillRect(0, 512 - edgeBlur, 512, edgeBlur);
            const gradLeft = ctx.createLinearGradient(0, 0, edgeBlur, 0);
            gradLeft.addColorStop(0, 'rgba(0, 0, 0, 1)');
            gradLeft.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradLeft;
            ctx.fillRect(0, 0, edgeBlur, 512);
            const gradRight = ctx.createLinearGradient(512 - edgeBlur, 0, 512, 0);
            gradRight.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradRight.addColorStop(1, 'rgba(0, 0, 0, 1)');
            ctx.fillStyle = gradRight;
            ctx.fillRect(512 - edgeBlur, 0, edgeBlur, 512);
            ctx.globalCompositeOperation = 'source-over';
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }, [shape]);

    const shadowY = React.useMemo(() => {
        const dimensions = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS);
        const gapMeters = TERRAIN_CONFIG.SHADOW_DISTANCE_UNIT === 'percent'
            ? dimensions.minDimension * (TERRAIN_CONFIG.SHADOW_DISTANCE_VALUE / 100)
            : TERRAIN_CONFIG.SHADOW_DISTANCE_VALUE;

        // Calculate base scale to match Terrain.tsx (100 / Width)
        const baseMultiplier = 100 / dimensions.width;
        // User requested fixed soil depth/shadow distance regardless of exaggeration
        // So we use baseMultiplier (1:1 scale) instead of multiplying by exaggeration
        const currentMultiplier = baseMultiplier;

        const soilDepthMeters = TERRAIN_CONFIG.SOIL_DEPTH_UNIT === 'percent'
            ? dimensions.minDimension * (TERRAIN_CONFIG.SOIL_DEPTH_VALUE / 100)
            : TERRAIN_CONFIG.SOIL_DEPTH_VALUE;

        return -(soilDepthMeters + gapMeters) * currentMultiplier;
    }, [exaggeration]);

    if (!show || !alphaMap) return null;

    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, shadowY, 0]} receiveShadow>
            <planeGeometry args={[100, 100]} />
            <meshBasicMaterial
                color="#000000"
                alphaMap={alphaMap}
                transparent={true}
                opacity={0.3}
                depthWrite={false}
            />
        </mesh>
    );
});

export default App;
