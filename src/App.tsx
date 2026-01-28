import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Sky, Environment, Stars } from '@react-three/drei'
import { Terrain } from './components/Terrain'

function App() {
    return (
        <div className="relative w-full h-full bg-black">
            {/* UI Overlay */}
            <div className="absolute top-6 left-6 z-10 text-white font-sans pointer-events-none select-none">
                <h1 className="text-4xl font-bold drop-shadow-lg tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                    Terrain Explorer
                </h1>
                <div className="mt-2 text-sm text-gray-200 bg-black/30 backdrop-blur-md p-3 rounded-lg border border-white/10 inline-block">
                    <p className="font-semibold text-emerald-300">Target Area:</p>
                    <p>Lat: 14.397 - 14.403</p>
                    <p>Lon: 101.013 - 101.022</p>
                    <p className="mt-1 text-xs text-gray-400">Source: AWS Terrain Tiles (SRTM)</p>
                </div>
            </div>

            <Canvas shadows camera={{ position: [50, 40, 80], fov: 45 }} dpr={[1, 2]}>
                {/* Atmosphere & Lighting */}
                <fog attach="fog" args={['#dceeff', 50, 300]} />
                <ambientLight intensity={0.5} />
                <directionalLight
                    position={[100, 100, 50]}
                    intensity={1.5}
                    castShadow
                    shadow-mapSize-width={2048}
                    shadow-mapSize-height={2048}
                    shadow-bias={-0.0001}
                />

                <Suspense fallback={null}>
                    <Terrain />
                    <Environment preset="forest" />
                    <Sky
                        distance={450000}
                        sunPosition={[100, 40, 50]}
                        inclination={0}
                        azimuth={0.25}
                        turbidity={10}
                        rayleigh={2}
                    />
                </Suspense>

                <OrbitControls
                    enableDamping
                    dampingFactor={0.05}
                    maxPolarAngle={Math.PI / 2 - 0.05}
                    minDistance={10}
                    maxDistance={250}
                    autoRotate={true}
                    autoRotateSpeed={0.5}
                />
            </Canvas>

            <div className="absolute bottom-6 right-6 z-10 text-right pointer-events-none">
                <div className="text-white/40 text-xs space-y-1">
                    <p>Powered by Vite + React + Three.js</p>
                    <p>Controls: LMB Rotate | RMB Pan | Scroll Zoom</p>
                </div>
            </div>
        </div>
    )
}

export default App
