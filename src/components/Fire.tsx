import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config';
import { latLonToWorld, getTerrainHeight, calculateBoundsDimensions } from '../utils/terrain';

import { SmokePlume } from './SmokePlume';

// Define matched interfaces for Props
interface WindLayerConfig {
    speed: number;
    direction: number;
}

interface WindConfig {
    enabled: boolean;
    layers: WindLayerConfig[];
}

interface FireConfigType {
    ENABLED: boolean;
    LOCATIONS: { lat: number; lon: number; scale: number; intensity: number }[];
    COLOR_INNER?: string;
    COLOR_OUTER?: string;
    HEIGHT: number;
    HEIGHT_OFFSET: number;
    SPREAD: number;
    ITERATIONS: number;
    OCTAVES: number;
    SMOKE?: {
        ENABLED: boolean;
        HEIGHT_MIN: number;
        SPEED: number;
        DISPERSION: number;
        SIZE: number;
        OPACITY: number;
        COLOR: string;
        HEIGHT_MAX?: number;
    };
}

interface FireProps {
    exaggeration: number;
    terrainData?: {
        width: number;
        height: number;
        data: Float32Array;
        minHeight: number;
        maxHeight: number;
    };
    configs?: FireConfigType[];
    bounds?: typeof TERRAIN_CONFIG.BOUNDS;
    windConfig?: WindConfig;
}

// Fire Shader based on mattatz/THREE.Fire
const FireShader = {
    uniforms: {
        "fireTex": { value: null as THREE.Texture | null },
        "color": { value: new THREE.Color(0xeeeeee) },
        "time": { value: 0.0 },
        "seed": { value: 0.0 },
        "invModelMatrix": { value: new THREE.Matrix4() },
        "scale": { value: new THREE.Vector3(1, 1, 1) },
        "noiseScale": { value: new THREE.Vector4(1, 2, 1, 0.3) },
        "magnitude": { value: 1.3 },
        "lacunarity": { value: 2.0 },
        "gain": { value: 0.5 }
    },
    vertexShader: `
        varying vec3 vWorldPos;
        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        }
    `,
    fragmentShader: `
        uniform vec3 color;
        uniform float time;
        uniform float seed;
        uniform mat4 invModelMatrix;
        uniform vec3 scale;
        uniform vec4 noiseScale;
        uniform float magnitude;
        uniform float lacunarity;
        uniform float gain;
        uniform sampler2D fireTex;
        varying vec3 vWorldPos;

        vec3 mod289(vec3 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }
        vec4 mod289(vec4 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }
        vec4 permute(vec4 x) {
            return mod289(((x * 34.0) + 1.0) * x);
        }
        vec4 taylorInvSqrt(vec4 r) {
            return 1.79284291400159 - 0.85373472095314 * r;
        }
        float snoise(vec3 v) {
            const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = mod289(i);
            vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
            float n_ = 0.142857142857;
            vec3  ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            vec4 x = x_ * ns.x + ns.yyyy;
            vec4 y = y_ * ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            vec4 s0 = floor(b0) * 2.0 + 1.0;
            vec4 s1 = floor(b1) * 2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
        }

        float turbulence(vec3 p) {
            float sum = 0.0;
            float freq = 1.0;
            float amp = 1.0;
            for(int i = 0; i < OCTIVES; i++) {
                sum += abs(snoise(p * freq)) * amp;
                freq *= lacunarity;
                amp *= gain;
            }
            return sum;
        }

        vec4 samplerFire(vec3 p, vec4 scale) {
            vec2 st = vec2(sqrt(dot(p.xz, p.xz)), p.y);
            if(st.x <= 0.0 || st.x >= 1.0 || st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);
            p.y -= (seed + time) * scale.w;
            p *= scale.xyz;
            st.y += sqrt(st.y) * magnitude * turbulence(p);
            if(st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);
            return texture2D(fireTex, st);
        }

        vec3 localize(vec3 p) {
            return (invModelMatrix * vec4(p, 1.0)).xyz;
        }

        void main() {
            vec3 rayPos = vWorldPos;
            vec3 rayDir = normalize(rayPos - cameraPosition);
            float rayLen = 0.0288 * length(scale.xyz);
            vec4 col = vec4(0.0);
            for(int i = 0; i < ITERATIONS; i++) {
                rayPos += rayDir * rayLen;
                vec3 lp = localize(rayPos);
                lp.y += 0.5;
                lp.xz *= 2.0;
                col += samplerFire(lp, noiseScale);
            }
            col.a = col.r;
            gl_FragColor = col;
        }
    `
};

// Single Fire mesh component
const FireMesh: React.FC<{
    position: [number, number, number];
    scale: number;
    fireTex: THREE.Texture;
    iterations: number;
    octaves: number;
}> = ({ position, scale, fireTex, iterations, octaves }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const materialRef = useRef<THREE.ShaderMaterial>(null);

    const uniforms = useMemo(() => ({
        fireTex: { value: fireTex },
        color: { value: new THREE.Color(0xeeeeee) },
        time: { value: 0.0 },
        seed: { value: Math.random() * 19.19 },
        invModelMatrix: { value: new THREE.Matrix4() },
        scale: { value: new THREE.Vector3(scale, scale * 2, scale) },
        noiseScale: { value: new THREE.Vector4(1, 2, 1, 0.3) },
        magnitude: { value: 1.3 },
        lacunarity: { value: 2.0 },
        gain: { value: 0.5 }
    }), [fireTex, scale]);

    const defines = useMemo(() => ({
        "ITERATIONS": String(iterations),
        "OCTIVES": String(octaves)
    }), [iterations, octaves]);

    useFrame((state) => {
        if (meshRef.current && materialRef.current) {
            meshRef.current.updateMatrixWorld();
            const invMatrix = new THREE.Matrix4();
            invMatrix.copy(meshRef.current.matrixWorld).invert();

            materialRef.current.uniforms.time.value = state.clock.elapsedTime;
            materialRef.current.uniforms.invModelMatrix.value = invMatrix;
            // Fire goes up in Y direction (Local Space)
            materialRef.current.uniforms.scale.value.set(scale, scale * 2, scale);
        }
    });

    return (
        // Rotate to stand upright: Terrain Local Z is Up.
        // Mesh Y is Shader Up.
        // Rotate X 90 (PI/2) aligns Y with Z.
        <mesh
            ref={meshRef}
            position={position}
            scale={[scale, scale * 2, scale]}
            rotation={[Math.PI / 2, 0, 0]}
            renderOrder={10} // Ensure it draws after transparent terrain overlays
        >
            <boxGeometry args={[1, 1, 1]} />
            <shaderMaterial
                ref={materialRef}
                defines={defines}
                uniforms={uniforms}
                vertexShader={FireShader.vertexShader}
                fragmentShader={FireShader.fragmentShader}
                transparent
                depthWrite={false}
                depthTest={true}
                polygonOffset={true}
                polygonOffsetFactor={-20} // Pull towards camera significantly to beat terrain micro-displacement
                side={THREE.DoubleSide}
            />
        </mesh>
    );
};

export const Fire: React.FC<FireProps> = ({ exaggeration, terrainData, configs, bounds, windConfig }) => {
    const activeBounds = TERRAIN_CONFIG.BOUNDS; // ALWAYS use full bounds to match static geometry

    // Load fire texture
    const fireTex = useLoader(THREE.TextureLoader, '/fire/Fire.png');

    useEffect(() => {
        if (fireTex) {
            fireTex.magFilter = THREE.LinearFilter;
            fireTex.minFilter = THREE.LinearFilter;
            fireTex.wrapS = THREE.ClampToEdgeWrapping;
            fireTex.wrapT = THREE.ClampToEdgeWrapping;
        }
    }, [fireTex]);

    // Calculate baseScale to match Terrain's vertical scaling
    const baseScale = useMemo(() => {
        const dims = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS);
        return 100 / dims.width;
    }, []);

    // Create fire instances for each location in each config
    const fireInstances = useMemo(() => {
        if (!configs || !terrainData) return [];

        const allInstances: {
            key: string,
            position: [number, number, number],
            scale: number,
            iterations: number,
            octaves: number,
            smokeConfig?: any,
            lat: number,
            lon: number
        }[] = [];

        configs.forEach((config, configIdx) => {
            if (!config.ENABLED) return;

            const { LOCATIONS, HEIGHT, HEIGHT_OFFSET, SPREAD, ITERATIONS, OCTAVES, SMOKE } = config;

            LOCATIONS.forEach((loc, locIdx) => {
                // Use ACTIVE bounds to calculate World Position
                const [worldX, worldY] = latLonToWorld(loc.lat, loc.lon, activeBounds);

                if (Math.abs(worldX) > 60 || Math.abs(worldY) > 60) {
                    return; // Outside view
                }

                const terrainZ = getTerrainHeight(worldX, worldY, terrainData, exaggeration, activeBounds);
                const offsetZ = HEIGHT_OFFSET * (exaggeration / 100);
                const fireScale = (loc.scale || 1.0) * HEIGHT * SPREAD;
                const scaledZ = (terrainZ + offsetZ) * baseScale;

                // Log position for debugging
                console.log(`[Fire] Creating instance ${configIdx}-${locIdx}:`, {
                    lat: loc.lat,
                    lon: loc.lon,
                    worldX,
                    worldY,
                    terrainZ,
                    scaledZ,
                    smokeEnabled: SMOKE?.ENABLED
                });

                allInstances.push({
                    key: `fire-${configIdx}-${locIdx}`,
                    position: [worldX, worldY, scaledZ],
                    scale: fireScale,
                    iterations: ITERATIONS,
                    octaves: OCTAVES,
                    smokeConfig: SMOKE,
                    lat: loc.lat,
                    lon: loc.lon
                });
            });
        });

        return allInstances;
    }, [configs, terrainData, exaggeration, activeBounds, baseScale]);

    if (fireInstances.length === 0 || !fireTex) return null;

    // Get Wind Layer 0 for smoke (simplification)
    const activeWind = windConfig?.enabled && windConfig.layers.length > 0 ? windConfig.layers[0] : undefined;

    return (
        <group>
            {fireInstances.map((fire) => (
                <group key={fire.key}>
                    <FireMesh
                        position={fire.position}
                        scale={fire.scale}
                        fireTex={fireTex}
                        iterations={fire.iterations}
                        octaves={fire.octaves}
                    />
                    {fire.smokeConfig && fire.smokeConfig.ENABLED && (
                        <SmokePlume
                            position={fire.position} // Smoke originates at fire base
                            config={fire.smokeConfig}
                            windLayer={activeWind}
                            scale={baseScale}
                            maxHeightOffset={fire.smokeConfig.HEIGHT_MAX || 100}
                            lat={fire.lat}
                            lon={fire.lon}
                        />
                    )}
                </group>
            ))}
        </group>
    );
};
