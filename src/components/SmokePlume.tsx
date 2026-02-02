import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';


interface SmokeConfig {
    ENABLED: boolean;
    HEIGHT: number;
    SPEED: number;
    DISPERSION: number;
    SIZE: number;
    OPACITY: number;
    COLOR: string;
}

interface SmokePlumeProps {
    position: [number, number, number]; // Fire Source Position (World Space)
    config: SmokeConfig;
    windLayer?: { speed: number; direction: number }; // Wind at this altitude
    scale: number; // Base scale of fire/world
    maxHeightOffset: number; // Height at which particles die (relative to source)
}

// Procedural Smoke Texture
const createSmokeTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Texture();

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Soft blurry edge
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(240,240,240,0.5)');
    gradient.addColorStop(0.8, 'rgba(200,200,200,0.1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
};

export const SmokePlume: React.FC<SmokePlumeProps> = ({ position, config, windLayer, scale, maxHeightOffset }) => {
    const particleCount = 200; // Number of smoke particles per plume
    const texture = useMemo(() => createSmokeTexture(), []);

    // Geometry for Points
    const pointsRef = useRef<THREE.Points>(null);
    const geometry = useMemo(() => new THREE.BufferGeometry(), []);

    // Attributes
    const positions = useMemo(() => new Float32Array(particleCount * 3), [particleCount]);
    const seeds = useMemo(() => {
        const arr = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) arr[i] = Math.random();
        return arr;
    }, [particleCount]);

    // Initial fill
    useMemo(() => {
        for (let i = 0; i < particleCount; i++) {
            // Start everyone at 0,0,0 (local space of plume will be fire source)
            // But to avoid initial burst, pre-warm?
            // Just randomize "startY" along the column?
            // Let's randomize their "age" effectively by setting Y to random heights.

            // Or we just update every frame and they spawn from 0.
            // Pre-warm:
            const initialProgress = Math.random();
            // We'll manage position in the useFrame via CPU for true wind simulation?
            // Or shader?
            // CPU is easier for simple logic, but slower? 200 particles is fine on CPU.
            // Actually, `Points` needs `geometry.attributes.position.needsUpdate = true`. 
            // 200 * 3 float32 is tiny.

            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000; // Hide initially
            positions[i * 3 + 2] = 0;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }, [geometry, positions, particleCount]);

    // Particle State (CPU side)
    const particleData = useMemo(() => {
        return Array.from({ length: particleCount }).map(() => ({
            age: Math.random() * 100, // Randomized start age
            life: 10 + Math.random() * 10,
            x: 0,
            y: 0,
            z: 0,
            vx: (Math.random() - 0.5) * config.DISPERSION,
            vy: config.SPEED * (0.8 + Math.random() * 0.4),
            vz: (Math.random() - 0.5) * config.DISPERSION,
            offset: Math.random() * Math.PI * 2,
        }));
    }, [particleCount, config]);

    useFrame((state, delta) => {
        if (!pointsRef.current) return;

        const windSpeed = windLayer?.speed || 0;
        const windDir = windLayer?.direction || 0;

        // Convert wind direction (degrees) to vector
        // 0=N (+Y), 90=E (+X), 180=S (-Y), 270=W (-X)
        const rad = (windDir * Math.PI) / 180;
        const windDx = Math.sin(rad);
        const windDy = Math.cos(rad);

        const posAttr = pointsRef.current.geometry.attributes.position;
        const array = posAttr.array as Float32Array;

        // Wind Force Scalar (adjust to taste)
        const WIND_FORCE = 0.5 * delta;

        // Rise Limit
        // config.HEIGHT is fading height in meters? 
        // We need to convert meters to world units approximately. Or config.HEIGHT IS World Units?
        // App convention: "HEIGHT" usually refers to terrain elevation (World Units). 
        // "HEIGHT_OFFSET" usually Meters.
        // Let's assume config.HEIGHT is Meters, so we scale it.
        const maxRise = config.HEIGHT * scale; // World Units

        for (let i = 0; i < particleCount; i++) {
            const p = particleData[i];

            p.age += delta;

            // Reset if too old or too high
            if (p.age > p.life || p.y > maxRise) {
                p.age = 0;
                p.life = 10 + Math.random() * 5;
                p.x = 0;
                p.y = 0;
                p.z = 0;
                // Randomize velocity slightly per spawn
                p.vx = (Math.random() - 0.5) * config.DISPERSION;
                p.vy = config.SPEED * (0.8 + Math.random() * 0.4) * scale; // Scale vertical speed
                p.vz = (Math.random() - 0.5) * config.DISPERSION;
            } else {
                // Determine wind effect based on height (higher = more wind?)
                // Simple linear wind:
                const windFactor = Math.min(1.0, p.y / 20); // Wind kicks in as it rises

                // Update position
                p.x += (p.vx + windDx * windSpeed * windFactor * 0.1) * delta;
                p.y += p.vy * delta;
                p.z += (p.vz + windDy * windSpeed * windFactor * 0.1) * delta;

                // Add some turbulence/curl
                p.x += Math.sin(state.clock.elapsedTime + p.offset + p.y * 0.1) * delta * 0.5;
                p.z += Math.cos(state.clock.elapsedTime + p.offset + p.y * 0.1) * delta * 0.5;
            }

            // Update buffer
            array[i * 3] = p.x;
            array[i * 3 + 1] = p.y; // Y is UP in this local Mesh group? 
            // VRTerrain convention: Z is UP in World. Y is Lat/North.
            // FireMesh in Fire.tsx calculates position as [worldX, worldY, scaledZ].
            // And then renders with `position={[worldX, worldY, scaledZ]}`.
            // BUT FireMesh applies `rotation={[Math.PI / 2, 0, 0]}`.
            // Rotating +90 X:
            // Original Local Y -> World Z.
            // Original Local Z -> World -Y?
            // Original Local X -> World X.
            // So for particles inside `rotation={[Math.PI / 2, 0, 0]}`:
            // Moving in Local Y + moves UP in World Z.
            // Moving in Local X moves East/West.
            // Moving in Local Z moves North/South.
            // Wait.
            // If FireMesh is rotated X=90...
            // Local (0,1,0) -> Rotates to (0,0,1) World (UP). Correct.
            // Local (1,0,0) -> (1,0,0) World (East). Correct.
            // Local (0,0,1) -> (0,-1,0) World (South).

            // So if Wind Direction is 0 (North, +WorldY):
            // We want particle to move in World +Y.
            // Which is Local -Z.
            // Wind Dir 0 => dy=1 (North).
            // We want Local Z to decrease.
            // So p.z -= windDy?

            // Let's verify:
            // Wind 0 (N): dx=0, dy=1.
            // Target: World (0, 1, 0).
            // Local Vector v st Rot(v) = (0,1,0).
            // Rot = [1 0 0; 0 0 -1; 0 1 0]. (Rotation Matrix for +90deg X)
            // [x, -z, y] = [0, 1, 0]
            // => x=0, -z=1 => z=-1, y=0.
            // So Local Z should be -1.
            // So North (+Y World) corresponds to -Z Local.

            // Wind 90 (E): dx=1, dy=0.
            // Target: World (1, 0, 0).
            // [x, -z, y] = [1, 0, 0].
            // => x=1, z=0, y=0.
            // So East (+X World) corresponds to +X Local.

            // So:
            // Local X += windDx
            // Local Z -= windDy

            // Apply correction to update logic above:
            // p.x += ... (Correct for East/West)
            // p.z -= ... (Correct for North/South)

            array[i * 3] = p.x;
            array[i * 3 + 1] = p.y;
            array[i * 3 + 2] = p.z;
        }

        posAttr.needsUpdate = true;
    });

    // Custom Shader for fading opacity over height/age?
    // Or simpler: use map PointMaterial, but opacity is uniform.
    // We want individual opacity relative to life.
    // PointsMaterial doesn't support per-vertex opacity easily without custom shader or vertex colors (alpha in color attribute not supported well in WebGL1/standard materials without trickery, usually need ShaderMaterial).

    // For "Plume", maybe standard shader is enough if we just set global opacity low.
    // But fading at top is key.
    // Let's use a simple ShaderMaterial for the points.

    const smokeShader = useMemo(() => ({
        uniforms: {
            tex: { value: texture },
            color: { value: new THREE.Color(config.COLOR) },
            globalOpacity: { value: config.OPACITY },
            scale: { value: config.SIZE * scale }, // Scale particle size by world scale
            maxHeight: { value: maxHeightOffset * scale } // Height in World Units
        },
        // ... (rest of shader def, keeping vertexShader string inline in return if preferred, OR defined here)
    }), [texture, config, scale, maxHeightOffset]);

    // Update uniforms if config changes
    /*
    useFrame(() => {
        if (pointsRef.current) {
             const mat = pointsRef.current.material as THREE.ShaderMaterial;
             mat.uniforms.maxHeight.value = maxHeightOffset * scale;
        }
    })
    */

    return (
        <points ref={pointsRef} position={position} rotation={[Math.PI / 2, 0, 0]}>
            {/* Note: Position passed to component is handled by Parent Group usually? 
                Ah, in props: `position: [x,y,z]`.
                If we use that on <points>, good.
            */}
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={particleCount}
                    array={positions}
                    itemSize={3}
                />
            </bufferGeometry>
            <shaderMaterial
                transparent
                depthWrite={false}
                uniforms={smokeShader.uniforms}
                vertexShader={`
                    varying float vAlpha;
                    uniform float scale;
                    uniform float maxHeight;
                    
                    void main() {
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        
                        // Size: Base * Growth * Distance Attenuation
                        float growth = 1.0 + (position.y / maxHeight) * 5.0; // Grow 5x at top
                        gl_PointSize = scale * growth * (300.0 / -mvPosition.z); 
                        
                        // Fade based on height
                        float h = max(0.0, position.y);
                        vAlpha = 1.0 - smoothstep(0.0, maxHeight, h);
                    }
                `}
                fragmentShader={`
                    uniform vec3 color;
                    uniform sampler2D tex;
                    uniform float globalOpacity;
                    varying float vAlpha;
                    
                    void main() {
                        vec4 texColor = texture2D(tex, gl_PointCoord);
                        if (texColor.a < 0.01) discard;
                        gl_FragColor = vec4(color, texColor.a * globalOpacity * vAlpha);
                    }
                `}
            />
        </points>
    );
};
