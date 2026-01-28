
import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Sky, Environment, Stars } from '@react-three/drei'
import { Terrain } from './components/Terrain'
import { CameraTracker } from './components/CameraTracker'
import { TERRAIN_CONFIG } from './config'
import { calculateBoundsDimensions } from './utils/terrain'
import * as THREE from 'three'
import proj4 from 'proj4'

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
    const [useBackgroundImage, setUseBackgroundImage] = React.useState(TERRAIN_CONFIG.USE_BACKGROUND_IMAGE);
    const [compassRotation, setCompassRotation] = React.useState(0);
    const [hoverInfo, setHoverInfo] = React.useState<{ height: number; lat: number; lon: number } | null>(null);
    const [isInteracting, setIsInteracting] = React.useState(false);

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
            <div className="absolute top-6 left-6 z-10 text-white font-sans pointer-events-none select-none">
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
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShape('rectangle')}
                                    className={`px - 3 py - 1 rounded - md text - xs font - medium transition - colors border ${shape === 'rectangle'
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                        } `}
                                >
                                    Rectangle
                                </button>
                                <button
                                    onClick={() => setShape('ellipse')}
                                    className={`px - 3 py - 1 rounded - md text - xs font - medium transition - colors border ${shape === 'ellipse'
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                        } `}
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
                                        checked={useBackgroundImage}
                                        onChange={() => setUseBackgroundImage(!useBackgroundImage)}
                                        className="accent-emerald-500"
                                    />
                                    Studio Background
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <Canvas
                shadows
                camera={{ position: [50, 40, 80], fov: 45 }}
                dpr={[1, 2]}
                gl={{
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: effects.BLOOM ? 1.2 : 1.0,
                    alpha: true,
                    premultipliedAlpha: false,
                    antialias: true
                }}
                onCreated={({ gl }) => {
                    gl.setClearColor(0x000000, 0); // Fully transparent
                }}
                style={{ background: 'transparent' }}
            >
                {/* Atmosphere & Lighting */}
                {/* <fog attach="fog" args={[fogColor, fogNear, fogFar]} /> */}
                <ambientLight intensity={ambientIntensity} />

                {/* Camera Tracker for Compass */}
                <CameraTracker onRotationChange={setCompassRotation} />

                <directionalLight
                    position={[100, 100, 50]}
                    intensity={directionalIntensity}
                    castShadow
                    shadow-mapSize-width={2048}
                    shadow-mapSize-height={2048}
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
                        disableHover={isInteracting}
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
                    enableDamping
                    dampingFactor={0.05}
                    maxPolarAngle={Math.PI / 2 - 0.05}
                    minDistance={10}
                    maxDistance={250}
                    autoRotate={true}
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
                <div className="text-white/40 text-xs space-y-1">
                    <p>Powered by Vite + React + Three.js</p>
                    <p>Controls: LMB Rotate | RMB Pan | Scroll Zoom</p>
                </div>
            </div>

            {/* North Arrow */}
            <div className="absolute top-1/2 right-8 z-10 pointer-events-none transform -translate-y-1/2">
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
