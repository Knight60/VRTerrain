import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fetchTerrainTile } from '../utils/terrain';

export const Terrain: React.FC = () => {
    const [terrainData, setTerrainData] = useState<{ width: number; height: number; data: Float32Array; minHeight: number; maxHeight: number } | null>(null);
    const meshRef = useRef<THREE.Mesh>(null);

    useEffect(() => {
        // Zoom 14 captures a bit more context, Zoom 15 is finer.
        fetchTerrainTile(15).then(setTerrainData).catch(console.error);
    }, []);

    const geometry = useMemo(() => {
        if (!terrainData) return null;
        const { width, height, data, minHeight, maxHeight } = terrainData;

        // Create plane with segments matching pixel count - 1
        const geo = new THREE.PlaneGeometry(100, 100, width - 1, height - 1);

        const count = geo.attributes.position.count;
        const arr = geo.attributes.position.array;
        const colors: number[] = [];

        const heightRange = maxHeight - minHeight || 1;

        for (let i = 0; i < count; i++) {
            // 3 floats per vertex (x, y, z)
            // We modify z (which corresponds to height before rotation)

            const rawHeight = data[i] || minHeight;
            const relativeHeight = rawHeight - minHeight;

            // Scale height: Adjust multiplier for desired vertical exaggeration
            // 100 units width approx 1km -> 1 unit = 10m
            // If height is in meters, and we want 1:1 scale:
            // relativeHeight (m) / 10 = units
            arr[i * 3 + 2] = relativeHeight * 0.15;

            // Vertex Colors
            const h = relativeHeight / heightRange;
            const color = new THREE.Color();

            // Thailand Tropical Palette
            // Low: Dark Green
            // Mid: Lush Green
            // High: Rocky/Brown

            if (h < 0.2) {
                color.setHSL(0.3, 0.6, 0.2); // Dark Green
            } else if (h < 0.6) {
                // Gradient from Green to Lighter Green
                color.setHSL(0.3, 0.5, 0.2 + h * 0.2);
            } else {
                // Rocky top
                color.setHSL(0.08, 0.3, 0.4 + h * 0.2);
            }

            colors.push(color.r, color.g, color.b);
        }

        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        return geo;
    }, [terrainData]);

    if (!geometry) return (
        <mesh>
            <boxGeometry args={[10, 1, 10]} />
            <meshStandardMaterial color="gray" wireframe />
        </mesh>
    );

    return (
        <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
            <meshStandardMaterial
                vertexColors
                roughness={0.8}
                metalness={0.1}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
};
