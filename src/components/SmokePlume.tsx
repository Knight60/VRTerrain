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
    const particleCount = 500; // Reduced for large visible puffs

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
            age: (i / particleCount) * 6, // Stagger initial ages for continuous flow
            life: 4 + Math.random() * 4, // Longer life for smoke to travel
            x: 0,
            y: 0, // Y is UP after rotation [Math.PI/2, 0, 0]
            z: 0,
            vx: (Math.random() - 0.5) * 0.05, // Minimal horizontal velocity at start
            vy: 2.0 + Math.random() * 1.0, // Strong upward velocity
            vz: (Math.random() - 0.5) * 0.05, // Minimal horizontal velocity at start
            offset: Math.random() * Math.PI * 2,
            size: 0.8 + Math.random() * 0.6, // Individual particle size variation
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
        // maxHeightOffset is already in meters, no need to multiply by scale for height check
        const maxRise = (cfg.MAX_HEIGHT || cfg.HEIGHT || 100);

        for (let i = 0; i < particleCount; i++) {
            const p = particleData[i];

            p.age += delta;

            // Reset if too old or too high (Y-UP in local space)
            if (p.age > p.life || p.y > maxRise) {
                p.age = 0;

                // Calculate life based on speed and height to ensure it reaches top
                const nominalSpeed = cfg.SPEED;
                const timeToReachTop = maxRise / nominalSpeed;
                p.life = timeToReachTop * (1.0 + Math.random() * 0.2); // Add buffer

                // Start very tight at the source
                const startSpread = 0.5; // Small initial area
                p.x = (Math.random() - 0.5) * startSpread;
                p.y = 0.5; // Start slightly above base
                p.z = (Math.random() - 0.5) * startSpread;

                // Initial Velocity:
                // vy (Vertical) = SPEED
                // vx, vz (Horizontal) = Controlled by DISPERSION
                p.vy = nominalSpeed * (0.9 + Math.random() * 0.2); // Variation in rise speed

                // Use DISPERSION directly for initial random spread velocity
                p.vx = (Math.random() - 0.5) * cfg.DISPERSION;
                p.vz = (Math.random() - 0.5) * cfg.DISPERSION;

                p.size = 0.8 + Math.random() * 0.6;
            } else {
                // Wind effect increases strongly with height (Y is up)
                const heightRatio = p.y / maxRise;
                const windFactor = Math.pow(heightRatio, 1.5); // Stronger increase with height

                // Gentle expansion as smoke rises
                const spreadFactor = 1.0 + heightRatio * 2.0;

                // Gentle turbulence for natural billowing (reduced from 2.5)
                const turbulence = {
                    x: Math.sin(state.clock.elapsedTime * 0.3 + p.offset + p.y * 0.1) * 0.8,
                    y: Math.sin(state.clock.elapsedTime * 0.2 + p.offset * 0.5) * 0.2,
                    z: Math.cos(state.clock.elapsedTime * 0.25 + p.offset * 0.8 + p.y * 0.08) * 0.8
                };

                // Update position: Rise straight, then drift with wind
                // Use Dispersion in wind drift too
                const dispersal = 1.0 + heightRatio * 2.0;

                p.x += (p.vx + windDx * windSpeed * windFactor * 3.0 + turbulence.x) * delta;
                p.y += (p.vy + turbulence.y) * delta;
                p.z += (p.vz + windDy * windSpeed * windFactor * 3.0 + turbulence.z) * delta;

                // No slowdown, we want to reach max height
                // p.vy *= 0.998;
            }

            // Update buffer (after rotation [PI/2,0,0]: local Y becomes world Z)
            array[i * 3] = p.x;
            array[i * 3 + 1] = p.y; // Y is UP in local space, becomes Z in world 
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
                if (mat.uniforms.colorOuter) mat.uniforms.colorOuter.value.set(cfg.COLOR).offsetHSL(0, 0, 0.3); // Automatically lighter
                if (mat.uniforms.globalOpacity) mat.uniforms.globalOpacity.value = cfg.OPACITY;
                // Scale is World Units Size
                if (mat.uniforms.scale) mat.uniforms.scale.value = cfg.SIZE * scale;
                // MaxHeight is in meters
                const h = (cfg.MAX_HEIGHT || cfg.HEIGHT || 100);
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
            colorOuter: { value: new THREE.Color(config.COLOR).offsetHSL(0, -0.2, 0.2) }, // Darker/Lighter variation
            globalOpacity: { value: config.OPACITY },
            scale: { value: config.SIZE * scale },
            maxHeight: { value: maxHeightOffset }
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
        <points ref={pointsRef} position={position} rotation={[Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={100}>
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
                    varying float vDist; // Distance from center axis
                    uniform float scale;
                    uniform float maxHeight;
                    
                    void main() {
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        
                        // Size: Start large, expand massively with height (Y is up in local space)
                        float heightRatio = position.y / maxHeight;
                        float growth = 2.0 + heightRatio * 15.0; 
                        
                        // Pass normalized distance from center axis (X, Z) to fragment
                        // Normalize by expected growth width approx
                        float widthAtHeight = 10.0 * growth; 
                        float dist = length(position.xz);
                        vDist = smoothstep(0.0, widthAtHeight * 4.0, dist); // 0 at center, 1 at wide edge

                        // Much larger base size for visible smoke puffs
                        gl_PointSize = max(30.0, scale * growth * (12000.0 / -mvPosition.z)); 
                        
                        // Natural fade: fade in quickly, fade out gradually at top (Y is up)
                        float h = max(0.0, position.y);
                        // Gradual fade out at the top
                        vAlpha = 1.0 - smoothstep(maxHeight * 0.7, maxHeight, h);
                        // Very quick fade in at bottom
                        vAlpha *= smoothstep(0.0, maxHeight * 0.05, h);
                    }
                `}
                fragmentShader={`
                    uniform vec3 color;
                    uniform vec3 colorOuter;
                    uniform sampler2D tex;
                    uniform float globalOpacity;
                    varying float vAlpha;
                    varying float vDist;
                    
                    void main() {
                        vec4 texColor = texture2D(tex, gl_PointCoord);
                        // Discard very transparent pixels for better blending
                        if (texColor.a < 0.05) discard;
                        
                        // Gradient Color: Mix Inner (color) and Outer (colorOuter) based on vDist
                        vec3 finalColor = mix(color, colorOuter, min(1.0, vDist * 1.5));

                        // Softer edges
                        float alpha = texColor.a * globalOpacity * vAlpha;
                        alpha *= 0.9; 
                        
                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `}
            />
        </points>
    );
};
