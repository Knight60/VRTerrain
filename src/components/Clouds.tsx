import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { TERRAIN_CONFIG } from '../config';

// Static Cloud Sprite - No internal animation/reshaping
const CloudSprite = React.memo(({
    position,
    speed,
    scale,
    opacity,
    texture
}: {
    position: [number, number, number];
    speed: number;
    scale: number;
    opacity: number;
    texture: THREE.Texture;
}) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const initialX = useRef(position[0]);

    useFrame((state, delta) => {
        if (meshRef.current) {
            // Move from East (+X) to West (-X)
            const moveSpeed = speed * delta * 0.2;
            meshRef.current.position.x -= moveSpeed;

            // Wrap around
            if (meshRef.current.position.x < -60) {
                meshRef.current.position.x = 60;
            }
        }
    });

    return (
        <mesh ref={meshRef} position={position}>
            <planeGeometry args={[scale, scale * 0.6]} />
            <meshBasicMaterial
                map={texture}
                transparent={true}
                opacity={opacity}
                side={THREE.DoubleSide}
                depthWrite={false}
                alphaTest={0.01}
            />
            {/* Billboard effect - always face camera */}
            <primitive object={new THREE.Object3D()} attach="onBeforeRender">
                {(mesh: THREE.Mesh, scene: THREE.Scene, camera: THREE.Camera) => {
                    mesh.quaternion.copy(camera.quaternion);
                }}
            </primitive>
        </mesh>
    );
});

// Billboard Cloud Component - Simple version
const BillboardCloud = React.memo(({
    position,
    speed,
    direction,
    scale,
    opacity,
    texture
}: {
    position: [number, number, number];
    speed: number;
    direction: number;
    scale: number;
    opacity: number;
    texture: THREE.Texture;
}) => {
    const spriteRef = useRef<THREE.Sprite>(null);

    useFrame((state, delta) => {
        if (spriteRef.current) {
            // Direction 0 = North (moves South? No, wind FROM North blows TO South).
            // Usually "Wind Direction 0" means blowing FROM North.
            // If we interpret direction as "Vector Angle":
            // 0 = +X (East)? 90 = +Y (North)? 270 = -Y (South)?
            // User config said: 270 = West.
            // If 270 is West (-X), then 0 is East (+X)? 90 is North (+Y)?
            // Let's use generic degrees -> radians conversion.
            // moveX = speed * cos(rad) * delta * 0.2
            // moveY = speed * sin(rad) * delta * 0.2
            // If 270 is West (-X), cos(270) = 0? No, cos(270deg) = 0.
            // Wait, standard unit circle: 0=East, 90=North, 180=West, 270=South.
            // User Comment in config: "0 = North, 90 = East, 180 = South, 270 = West".
            // This is Compass bearing (moving TO?).
            // If 0 is North (+Y), 90 is East (+X).
            // This is clockwise from North?
            // Usually compass: 0=N, 90=E, 180=S, 270=W.
            // 0 degrees = +Y direction?
            // 90 degrees = +X direction?
            // This matches standard map coordinates if Y is North.
            // Let's implement this mapping.
            // angle = (90 - direction) ? No.
            // If dir=0 (N, +Y) -> dx=0, dy=1.
            // If dir=90 (E, +X) -> dx=1, dy=0.
            // If dir=180 (S, -Y) -> dx=0, dy=-1.
            // This corresponds to:
            // x = sin(dir)
            // y = cos(dir)

            const rad = (direction * Math.PI) / 180;
            const dx = Math.sin(rad); // 0->0, 90->1
            const dy = Math.cos(rad); // 0->1, 90->0

            // Adjust factor to match previous "speed * delta * 0.2" scale
            const moveSpeed = speed * delta * 0.2;

            // Move cloud
            spriteRef.current.position.x += dx * moveSpeed;
            spriteRef.current.position.y += dy * moveSpeed; // Note: In 3D terrain, "y" is usually "North" in 2D map logic, but here Position is [x, y, z].
            // In Terrain.tsx/Fire.tsx, we saw:
            // position = [worldX, worldY, scaledZ].
            // So Y IS North/South axis in world space?
            // And Z is Elevation (Height).
            // Checks: Fire.tsx: `position: [worldX, worldY, scaledZ]`.
            // BillboardCloud prop: `position: [def.baseX, def.baseY, z]`.
            // So X=East/West, Y=North/South, Z=Altitude.
            // So my dx/dy logic updating .x and .y is correct for Lat/Lon movement.

            // Wrap around logic (Boundary +/- 60 approx)
            if (spriteRef.current.position.x < -60) spriteRef.current.position.x += 120;
            if (spriteRef.current.position.x > 60) spriteRef.current.position.x -= 120;
            if (spriteRef.current.position.y < -60) spriteRef.current.position.y += 120;
            if (spriteRef.current.position.y > 60) spriteRef.current.position.y -= 120;
        }
    });

    return (
        <sprite ref={spriteRef} position={position} scale={[scale, scale * 0.6, 1]}>
            <spriteMaterial
                map={texture}
                transparent={true}
                opacity={opacity}
                depthWrite={false}
            />
        </sprite>
    );
});

interface CloudLayerConfig {
    minAlt: number;
    maxAlt: number;
    count: number;
    opacity: number;
    minSize: number;
    maxSize: number;
    color: string;
}

interface CloudConfigProps {
    enabled: boolean;
    globalHeightOffset: number;
    globalHeightScalar: number;
    layers: CloudLayerConfig[];
}

interface WindLayerConfig {
    speed: number;
    direction: number;
}

interface WindConfigProps {
    enabled: boolean;
    layers: WindLayerConfig[];
}

interface CloudsProps {
    exaggeration: number;
    cloudConfig?: CloudConfigProps;
    windConfig?: WindConfigProps;
}

export const Clouds: React.FC<CloudsProps> = ({ exaggeration, cloudConfig, windConfig }) => {
    // Determine config values
    const CLOUD_ENABLED = cloudConfig?.enabled ?? TERRAIN_CONFIG.CLOUDS.ENABLED;
    const WIND_ENABLED = windConfig?.enabled ?? TERRAIN_CONFIG.WIND.ENABLED;
    const GLOBAL_HEIGHT_OFFSET = cloudConfig?.globalHeightOffset ?? TERRAIN_CONFIG.CLOUDS.GLOBAL_HEIGHT_OFFSET;
    const GLOBAL_HEIGHT_SCALAR = cloudConfig?.globalHeightScalar ?? TERRAIN_CONFIG.CLOUDS.GLOBAL_HEIGHT_SCALAR;
    const CLOUD_LAYERS: CloudLayerConfig[] = cloudConfig?.layers ?? TERRAIN_CONFIG.CLOUDS.LAYERS;
    const WIND_LAYERS: WindLayerConfig[] = windConfig?.layers ?? TERRAIN_CONFIG.WIND.LAYERS;

    // Load cloud texture
    const texture = useLoader(THREE.TextureLoader, TERRAIN_CONFIG.CLOUDS.CLOUD_TEXTURE_URL);

    // Generate Static Cloud Definitions with CLUSTERING
    const staticCloudDefs = useMemo(() => {
        if (!CLOUD_ENABLED) return [];

        const defs: any[] = [];
        let seedCounter = 0;

        CLOUD_LAYERS.forEach((layer: CloudLayerConfig, index: number) => {
            const layerCount = Math.min(layer.count, 500);
            if (layerCount === 0) return;

            // Get wind settings for this layer (fallback to index 0 or default if mismatch)
            const wind = WIND_LAYERS[index] || WIND_LAYERS[0] || { speed: 0, direction: 0 };
            const speed = WIND_ENABLED ? wind.speed : 0;
            const direction = wind.direction; // 0-360

            // Create cluster centers (fewer centers = more grouped clouds)
            const numClusters = Math.max(3, Math.floor(layerCount / 15)); // ~15 clouds per cluster
            const clusterCenters: { x: number; y: number; alt: number }[] = [];

            for (let c = 0; c < numClusters; c++) {
                clusterCenters.push({
                    x: (Math.random() - 0.5) * 100,
                    y: (Math.random() - 0.5) * 80,
                    alt: layer.minAlt + Math.random() * (layer.maxAlt - layer.minAlt)
                });
            }

            // Distribute clouds around cluster centers
            for (let i = 0; i < layerCount; i++) {
                // Pick a random cluster center
                const cluster = clusterCenters[Math.floor(Math.random() * numClusters)];

                // Offset from cluster center (Gaussian-like distribution using Box-Muller)
                const spreadX = 15; // Cluster spread in X
                const spreadY = 12; // Cluster spread in Y
                const spreadAlt = (layer.maxAlt - layer.minAlt) * 0.3; // Vertical spread within cluster

                // Simple approximation of Gaussian using sum of randoms
                const randX = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2;
                const randY = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2;
                const randAlt = ((Math.random() + Math.random()) / 2 - 0.5) * 2;

                const x = cluster.x + randX * spreadX;
                const y = cluster.y + randY * spreadY;
                const baseAltKm = Math.max(layer.minAlt, Math.min(layer.maxAlt,
                    cluster.alt + randAlt * spreadAlt
                ));

                const sizeBase = layer.minSize + Math.random() * (layer.maxSize - layer.minSize);

                defs.push({
                    key: `cloud-${seedCounter++}`,
                    baseX: x,
                    baseY: y,
                    baseAltKm: baseAltKm,
                    sizeBase: sizeBase,
                    speed: speed,
                    direction: direction,
                    opacity: layer.opacity
                });
            }
        });

        return defs;
    }, [CLOUD_ENABLED, WIND_ENABLED, CLOUD_LAYERS, WIND_LAYERS]);

    if (!CLOUD_ENABLED || !texture) return null;

    return (
        <group>
            {staticCloudDefs.map((def) => {
                const currentAltKm = def.baseAltKm * GLOBAL_HEIGHT_SCALAR + GLOBAL_HEIGHT_OFFSET;
                const z = (currentAltKm * 10) * (exaggeration / 100);
                const scale = def.sizeBase * 0.1;

                return (
                    <BillboardCloud
                        key={def.key}
                        position={[def.baseX, def.baseY, z]}
                        speed={def.speed}
                        direction={def.direction}
                        scale={scale}
                        opacity={def.opacity}
                        texture={texture}
                    />
                );
            })}
        </group>
    );
};
