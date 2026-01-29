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
    const spriteRef = useRef<THREE.Sprite>(null);

    useFrame((state, delta) => {
        if (spriteRef.current) {
            // Move from East (+X) to West (-X)
            const moveSpeed = speed * delta * 0.2;
            spriteRef.current.position.x -= moveSpeed;

            // Wrap around
            if (spriteRef.current.position.x < -60) {
                spriteRef.current.position.x = 60;
            }
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
    speed: number;
    color: string;
}

interface CloudConfigProps {
    enabled: boolean;
    globalHeightOffset: number;
    globalHeightScalar: number;
    layers: CloudLayerConfig[];
}

interface CloudsProps {
    exaggeration: number;
    cloudConfig?: CloudConfigProps;
}

export const Clouds: React.FC<CloudsProps> = ({ exaggeration, cloudConfig }) => {
    // Determine config values - use prop if provided, otherwise use TERRAIN_CONFIG
    const ENABLED = cloudConfig?.enabled ?? TERRAIN_CONFIG.CLOUDS.ENABLED;
    const GLOBAL_HEIGHT_OFFSET = cloudConfig?.globalHeightOffset ?? TERRAIN_CONFIG.CLOUDS.GLOBAL_HEIGHT_OFFSET;
    const GLOBAL_HEIGHT_SCALAR = cloudConfig?.globalHeightScalar ?? TERRAIN_CONFIG.CLOUDS.GLOBAL_HEIGHT_SCALAR;
    const LAYERS: CloudLayerConfig[] = cloudConfig?.layers ?? TERRAIN_CONFIG.CLOUDS.LAYERS;

    // Load cloud texture
    const texture = useLoader(THREE.TextureLoader, '/cloud/cloud.png');

    // Generate Static Cloud Definitions with CLUSTERING
    const staticCloudDefs = useMemo(() => {
        if (!ENABLED) return [];

        const defs: any[] = [];
        let seedCounter = 0;

        LAYERS.forEach((layer: CloudLayerConfig) => {
            const layerCount = Math.min(layer.count, 500);
            if (layerCount === 0) return;

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
                    speed: layer.speed,
                    opacity: layer.opacity
                });
            }
        });

        return defs;
    }, [ENABLED, LAYERS.length, ...LAYERS.map((l: CloudLayerConfig) => l.count)]);

    if (!ENABLED || !texture) return null;

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
                        scale={scale}
                        opacity={def.opacity}
                        texture={texture}
                    />
                );
            })}
        </group>
    );
};
