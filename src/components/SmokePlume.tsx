import React, { useMemo, useRef, useEffect } from 'react';
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
    MAX_HEIGHT?: number;
}

interface SmokePlumeProps {
    position: [number, number, number]; // Fire Source Position (World Space)
    config: SmokeConfig;
    windLayer?: { speed: number; direction: number }; // Wind at this altitude
    scale: number; // Base scale of fire/world
    maxHeightOffset: number; // Height at which particles die (relative to source)
    lat?: number;
    lon?: number;
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

export const SmokePlume: React.FC<SmokePlumeProps> = ({ position, config, windLayer, scale, maxHeightOffset, lat, lon }) => {
    const particleCount = 1000; // Increased for density

    // Create a softer, cloudy texture
    const texture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        if (context) {
            // Clear
            context.clearRect(0, 0, 128, 128);

            // Draw a soft "puff" (multiple gradients for noise-like look)
            const drawPuff = (x: number, y: number, r: number, alpha: number) => {
                const gradient = context.createRadialGradient(x, y, 0, x, y, r);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
                gradient.addColorStop(0.4, `rgba(255, 255, 255, ${alpha * 0.4})`);
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                context.fillStyle = gradient;
                context.beginPath();
                context.arc(x, y, r, 0, Math.PI * 2);
                context.fill();
            };

            // Main center puff
            drawPuff(64, 64, 60, 1.0);

            // Sub puffs for irregularity
            drawPuff(40, 50, 30, 0.5);
            drawPuff(90, 60, 35, 0.5);
            drawPuff(60, 90, 30, 0.5);
        }
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }, []);

    const configRef = useRef(config);
    const windRef = useRef(windLayer);

    useEffect(() => {
        configRef.current = config;
        windRef.current = windLayer;
    }, [config, windLayer]);

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
            positions[i * 3 + 1] = 0; // Start at source
            positions[i * 3 + 2] = 0;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }, [geometry, positions, particleCount]);

    // Particle State (CPU side)
    const particleData = useMemo(() => {
        return Array.from({ length: particleCount }).map((_, i) => ({
            age: (i / particleCount) * 3, // Stagger initial ages for continuous flow
            life: 2 + Math.random() * 2, // Shorter life for continuous emission
            x: 0,
            y: 0,
            z: 0,
            vx: (Math.random() - 0.5) * 0.1,
            vy: (Math.random() - 0.5) * 0.1,
            vz: 1.0 + Math.random() * 0.5, // Start with upward velocity
            offset: Math.random() * Math.PI * 2,
        }));
    }, [particleCount]);

    useFrame((state, delta) => {
        if (!pointsRef.current) return;

        const cfg = configRef.current;
        const wnd = windRef.current;

        const windSpeed = wnd?.speed || 0;
        const windDir = wnd?.direction || 0;

        // Convert wind direction (degrees) to vector
        // 0=N (+Y), 90=E (+X), 180=S (-Y), 270=W (-X)
        const rad = (windDir * Math.PI) / 180;
        const windDx = Math.sin(rad);
        const windDy = Math.cos(rad);

        const posAttr = pointsRef.current.geometry.attributes.position;
        const array = posAttr.array as Float32Array;

        // Rise Limit
        // Prefer MAX_HEIGHT from UI config, fallback to HEIGHT or default
        const maxRise = (cfg.MAX_HEIGHT || cfg.HEIGHT || 100) * scale;

        for (let i = 0; i < particleCount; i++) {
            const p = particleData[i];

            p.age += delta;

            // Reset if too old or too high (Z-UP check)
            if (p.age > p.life || p.z > maxRise) {
                p.age = 0;
                p.life = 2 + Math.random() * 2; // Shorter life for continuous emission
                // Start VERY tight at the source (like a fire base)
                const startSpread = 0.3 * scale;
                p.x = (Math.random() - 0.5) * startSpread;
                p.y = (Math.random() - 0.5) * startSpread;
                p.z = 0.1 * scale; // Start slightly above base to avoid artifact

                // Initial Velocity: Mostly Up, very little spread
                p.vx = (Math.random() - 0.5) * cfg.DISPERSION * 0.05 * scale;
                p.vy = (Math.random() - 0.5) * cfg.DISPERSION * 0.05 * scale;
                // Upward speed (Fire heat) - faster for continuous effect
                p.vz = cfg.SPEED * (1.0 + Math.random() * 0.5) * scale;
            } else {
                // Wind effect increases with height
                const windFactor = Math.min(1.0, p.z / 20);

                // Billowing expansion: Spread increases with height
                const spreadFactor = 1.0 + (p.z / maxRise) * 2.0;

                // Update position
                p.x += (p.vx * spreadFactor + windDx * windSpeed * windFactor * 0.2) * delta;
                p.y += (p.vy * spreadFactor + windDy * windSpeed * windFactor * 0.2) * delta;
                p.z += p.vz * delta;

                // Turbulence / Curl Noise (Increases with height)
                const curlSize = 0.1;
                const curlStr = 1.0 + (p.z / 10.0); // More turbulent higher up
                p.x += Math.sin(state.clock.elapsedTime * 0.5 + p.offset + p.z * curlSize) * delta * curlStr * scale;
                p.y += Math.cos(state.clock.elapsedTime * 0.3 + p.offset + p.z * curlSize) * delta * curlStr * scale;
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

    // Update Uniforms dynamically
    useFrame(() => {
        if (pointsRef.current) {
            const mat = pointsRef.current.material as THREE.ShaderMaterial;
            const cfg = configRef.current;
            if (mat && mat.uniforms) {
                if (mat.uniforms.color) mat.uniforms.color.value.set(cfg.COLOR);
                if (mat.uniforms.globalOpacity) mat.uniforms.globalOpacity.value = cfg.OPACITY;
                // Scale is World Units Size
                if (mat.uniforms.scale) mat.uniforms.scale.value = cfg.SIZE * scale;
                // MaxHeight is World Units
                const h = (cfg.MAX_HEIGHT || cfg.HEIGHT || 100) * scale;
                if (mat.uniforms.maxHeight) mat.uniforms.maxHeight.value = h;
            }
        }
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

    // Verify Data
    React.useEffect(() => {
        console.log('[SmokePlume] Mounted with:', {
            lat,
            lon,
            position,
            scale,
            calcScaleUniform: config.SIZE * scale,
            maxHeightOffset,
            config,
            windLayer,
            worldY: position[1],
        });
    }, [position, scale, maxHeightOffset, config, windLayer, lat, lon]);

    return (
        <points ref={pointsRef} position={position} rotation={[Math.PI / 2, 0, 0]} frustumCulled={false}>
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
                        // Growth: Start small, get bigger at top (simulating expansion)
                        float growth = 1.0 + (position.z / maxHeight) * 8.0; 
                        
                        // Scale multiplier for visible smoke
                        gl_PointSize = max(10.0, scale * growth * (5000.0 / -mvPosition.z)); 
                        
                        // Fade based on height - fade out at top only
                        float h = max(0.0, position.z);
                        // Fade out near the top
                        vAlpha = 1.0 - smoothstep(maxHeight * 0.6, maxHeight, h);
                        // Quick fade in at very bottom to avoid hard edges
                        vAlpha *= smoothstep(0.0, maxHeight * 0.02, h);
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
