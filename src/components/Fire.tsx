import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config';
import { calculateBoundsDimensions } from '../utils/terrain';

interface FireProps {
    exaggeration: number;
    terrainData?: {
        width: number;
        height: number;
        data: Float32Array;
        minHeight: number;
        maxHeight: number;
    };
    config?: {
        enabled: boolean;
        height: number;
        spread: number;
        iterations: number;
        octaves: number;
    }
}

// Convert lat/lon to world coordinates (matching terrain)
const latLonToWorld = (lat: number, lon: number, bounds: typeof TERRAIN_CONFIG.BOUNDS): [number, number] => {
    const { latMin, latMax, lonMin, lonMax } = bounds;

    // Normalize to 0-1
    const nx = (lon - lonMin) / (lonMax - lonMin);
    const ny = (lat - latMin) / (latMax - latMin);

    // Convert to world coordinates (-50 to 50)
    const worldX = (nx * 100) - 50;
    const worldY = 50 - (ny * 100); // Flip Y to match terrain

    return [worldX, worldY];
};

// Get terrain height at position using the same formula as Terrain.tsx
const getTerrainHeight = (
    x: number, y: number,
    terrainData: FireProps['terrainData'],
    exaggeration: number
): number => {
    if (!terrainData) return 0;

    const { width, height, data, minHeight } = terrainData;
    const dimensions = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS);
    const unitsPerMeter = 100 / dimensions.width;

    // Convert world coords (-50 to 50) to grid coords (0 to width-1)
    // X: -50 -> 0, 50 -> width-1
    // Y: 50 -> 0, -50 -> height-1 (Y is flipped in terrain)
    const gridX = Math.floor(((x + 50) / 100) * (width - 1));
    const gridY = Math.floor(((50 - y) / 100) * (height - 1));

    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(width - 1, gridX));
    const clampedY = Math.max(0, Math.min(height - 1, gridY));

    const idx = clampedY * width + clampedX;
    const terrainHeight = data[idx] ?? minHeight;

    // Use same formula as Terrain.tsx: (height - minHeight) * unitsPerMeter * exaggeration/100
    return (terrainHeight - minHeight) * unitsPerMeter * (exaggeration / 100);
};

// Fire Shader based on mattatz/THREE.Fire
// Note: defines are set dynamically based on config
const getFireShaderDefines = () => ({
    "ITERATIONS": String(TERRAIN_CONFIG.FIRE.ITERATIONS || 10),
    "OCTIVES": String(TERRAIN_CONFIG.FIRE.OCTAVES || 2)
});

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
            // Fire goes up in Z direction (after terrain rotation)
            materialRef.current.uniforms.scale.value.set(scale, scale, scale * 2);
        }
    });

    return (
        // Rotate to stand upright: the terrain group is rotated [-PI/2, 0, 0]
        // So fire needs to go "up" in the Z axis (which becomes Y in world space)
        <mesh
            ref={meshRef}
            position={position}
            scale={[scale, scale, scale * 2]}
            rotation={[Math.PI / 2, 0, 0]}
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
            />
        </mesh>
    );
};

export const Fire: React.FC<FireProps> = ({ exaggeration, terrainData, config }) => {
    const { ENABLED, HEIGHT, SPREAD, ITERATIONS, OCTAVES } = useMemo(() => {
        const defaults = TERRAIN_CONFIG.FIRE;
        return {
            ENABLED: config?.enabled ?? defaults.ENABLED,
            HEIGHT: config?.height ?? defaults.HEIGHT,
            SPREAD: config?.spread ?? defaults.SPREAD,
            ITERATIONS: config?.iterations ?? defaults.ITERATIONS,
            OCTAVES: config?.octaves ?? defaults.OCTAVES,
        };
    }, [config]);

    const { LOCATIONS } = TERRAIN_CONFIG.FIRE;

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

    // Create fire instances for each location
    const fireInstances = useMemo(() => {
        if (!ENABLED || !terrainData) return [];

        return LOCATIONS.map((loc, idx) => {
            const [worldX, worldY] = latLonToWorld(loc.lat, loc.lon, TERRAIN_CONFIG.BOUNDS);
            const terrainZ = getTerrainHeight(worldX, worldY, terrainData, exaggeration);

            // Fire scale for visual size
            const fireScale = (loc.scale || 1.0) * HEIGHT * SPREAD;

            return {
                key: `fire-${idx}`,
                // Position fire directly on terrain surface (Z = terrain height)
                position: [worldX, worldY, terrainZ] as [number, number, number],
                scale: fireScale
            };
        });
    }, [ENABLED, LOCATIONS, HEIGHT, SPREAD, terrainData, exaggeration]);

    if (!ENABLED || fireInstances.length === 0 || !fireTex) return null;

    return (
        <group>
            {fireInstances.map((fire) => (
                <FireMesh
                    key={fire.key}
                    position={fire.position}
                    scale={fire.scale}
                    fireTex={fireTex}
                    iterations={ITERATIONS}
                    octaves={OCTAVES}
                />
            ))}
        </group>
    );
};
