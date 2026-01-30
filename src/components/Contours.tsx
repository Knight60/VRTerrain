import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Text, Line } from '@react-three/drei';
import { TERRAIN_CONFIG } from '../config';
import { calculateBoundsDimensions } from '../utils/terrain';

interface ContoursProps {
    terrainData: {
        width: number;
        height: number;
        data: Float32Array;
        minHeight: number;
        maxHeight: number;
    };
    exaggeration: number;
}

// Marching squares algorithm to extract contour lines
const extractContourLines = (
    data: Float32Array,
    width: number,
    height: number,
    targetHeight: number
): [number, number][][] => {
    const lines: [number, number][][] = [];

    // Helper to interpolate position along an edge
    const interpolate = (
        x1: number, y1: number, v1: number,
        x2: number, y2: number, v2: number,
        target: number
    ): [number, number] => {
        if (Math.abs(v2 - v1) < 0.0001) {
            return [(x1 + x2) / 2, (y1 + y2) / 2];
        }
        const t = (target - v1) / (v2 - v1);
        return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };

    // Scan each cell
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            // Get corner values (counter-clockwise from bottom-left)
            const v00 = data[y * width + x];           // bottom-left
            const v10 = data[y * width + (x + 1)];     // bottom-right
            const v11 = data[(y + 1) * width + (x + 1)]; // top-right
            const v01 = data[(y + 1) * width + x];     // top-left

            // Calculate case based on which corners are above threshold
            let caseIndex = 0;
            if (v00 >= targetHeight) caseIndex |= 1;
            if (v10 >= targetHeight) caseIndex |= 2;
            if (v11 >= targetHeight) caseIndex |= 4;
            if (v01 >= targetHeight) caseIndex |= 8;

            // Skip if all corners are same side
            if (caseIndex === 0 || caseIndex === 15) continue;

            // Calculate edge intersection points
            const edges: { [key: string]: [number, number] } = {};

            // Bottom edge (between v00 and v10)
            if ((v00 >= targetHeight) !== (v10 >= targetHeight)) {
                edges['bottom'] = interpolate(x, y, v00, x + 1, y, v10, targetHeight);
            }
            // Right edge (between v10 and v11)
            if ((v10 >= targetHeight) !== (v11 >= targetHeight)) {
                edges['right'] = interpolate(x + 1, y, v10, x + 1, y + 1, v11, targetHeight);
            }
            // Top edge (between v11 and v01)
            if ((v11 >= targetHeight) !== (v01 >= targetHeight)) {
                edges['top'] = interpolate(x + 1, y + 1, v11, x, y + 1, v01, targetHeight);
            }
            // Left edge (between v01 and v00)
            if ((v01 >= targetHeight) !== (v00 >= targetHeight)) {
                edges['left'] = interpolate(x, y + 1, v01, x, y, v00, targetHeight);
            }

            // Connect edges based on case
            const edgeKeys = Object.keys(edges);
            if (edgeKeys.length >= 2) {
                // Simple connection for non-ambiguous cases
                if (edgeKeys.length === 2) {
                    lines.push([edges[edgeKeys[0]], edges[edgeKeys[1]]]);
                } else if (edgeKeys.length === 4) {
                    // Saddle point - use average to determine
                    const avg = (v00 + v10 + v11 + v01) / 4;
                    if (avg >= targetHeight) {
                        lines.push([edges['bottom'], edges['left']]);
                        lines.push([edges['top'], edges['right']]);
                    } else {
                        lines.push([edges['bottom'], edges['right']]);
                        lines.push([edges['top'], edges['left']]);
                    }
                }
            }
        }
    }

    return lines;
};

export const Contours: React.FC<ContoursProps> = ({ terrainData, exaggeration }) => {
    const { ENABLED, INTERVAL, LINE_COLOR, LINE_WIDTH, LINE_OPACITY, SHOW_LABELS, LABEL_COLOR, LABEL_SIZE, MAJOR_INTERVAL, MAJOR_LINE_WIDTH } = TERRAIN_CONFIG.CONTOURS;

    const contourData = useMemo(() => {
        if (!ENABLED || !terrainData) return { lines: [], labels: [], minHeight: 0, unitsPerMeter: 1 };

        const { width, height, data, minHeight, maxHeight } = terrainData;
        const allLines: { elevation: number; segments: [number, number][][]; isMajor: boolean }[] = [];
        const labels: { position: [number, number, number]; text: string }[] = [];

        // Calculate terrain dimensions in meters (EPSG:3857)
        const dimensions = calculateBoundsDimensions(TERRAIN_CONFIG.BOUNDS);
        // Scale factor: terrain is normalized to 100 units, but real size is in meters
        const unitsPerMeter = 100 / dimensions.width;

        // Calculate contour elevations
        const startElev = Math.ceil(minHeight / INTERVAL) * INTERVAL;
        const endElev = Math.floor(maxHeight / INTERVAL) * INTERVAL;

        // Scale factors to map grid coordinates to world coordinates
        // Terrain is 100x100 units centered at origin
        // PlaneGeometry has Y from +50 (row 0) to -50 (row height-1)
        const scaleX = 100 / (width - 1);
        const scaleY = 100 / (height - 1);

        // Calculate height multiplier:
        // - unitsPerMeter converts meters to display units
        // - exaggeration/100 applies vertical exaggeration
        const heightMultiplier = unitsPerMeter * (exaggeration / 100);

        for (let elev = startElev; elev <= endElev; elev += INTERVAL) {
            const segments = extractContourLines(data, width, height, elev);
            if (segments.length > 0) {
                const isMajor = elev % MAJOR_INTERVAL === 0;

                // Transform segments to world coordinates
                // X: 0 -> -50, width-1 -> 50
                // Y: 0 -> 50 (top), height-1 -> -50 (bottom) - flip Y!
                const worldSegments = segments.map(seg =>
                    seg.map(([x, y]) => [
                        x * scaleX - 50,
                        50 - y * scaleY  // Flip Y axis
                    ] as [number, number])
                );

                allLines.push({ elevation: elev, segments: worldSegments, isMajor });

                // Add label for major contours
                if (isMajor && SHOW_LABELS && worldSegments.length > 0) {
                    // Find a good position for label (middle of a segment)
                    const midSegment = worldSegments[Math.floor(worldSegments.length / 2)];
                    if (midSegment && midSegment.length >= 2) {
                        const midPoint = [
                            (midSegment[0][0] + midSegment[1][0]) / 2,
                            (midSegment[0][1] + midSegment[1][1]) / 2
                        ];
                        // Z position: (height in meters) * unitsPerMeter * exaggeration
                        const z = ((elev - minHeight) * heightMultiplier) + 0.2;
                        labels.push({
                            position: [midPoint[0], midPoint[1], z],
                            text: `${elev}m`
                        });
                    }
                }
            }
        }

        return { lines: allLines, labels, minHeight, unitsPerMeter };
    }, [terrainData, ENABLED, INTERVAL, MAJOR_INTERVAL, SHOW_LABELS, exaggeration]);

    if (!ENABLED || !terrainData) return null;

    // Get scale factors from contour data
    const { minHeight, unitsPerMeter } = contourData;
    // Height multiplier: unitsPerMeter * exaggeration
    const heightMultiplier = unitsPerMeter * (exaggeration / 100);

    // Batch all contour lines into merged geometries for performance
    const { normalGeometry, majorGeometry } = useMemo(() => {
        const normalPoints: number[] = [];
        const majorPoints: number[] = [];

        contourData.lines.forEach((contour) => {
            const z = ((contour.elevation - minHeight) * heightMultiplier) + 0.1;
            const targetArray = contour.isMajor ? majorPoints : normalPoints;

            contour.segments.forEach((segment) => {
                if (segment.length < 2) return;

                // For LineSegments, we need pairs of points
                for (let i = 0; i < segment.length - 1; i++) {
                    const [x1, y1] = segment[i];
                    const [x2, y2] = segment[i + 1];
                    // Add both endpoints for each line segment
                    targetArray.push(x1, y1, z);
                    targetArray.push(x2, y2, z);
                }
            });
        });

        const normalGeo = new THREE.BufferGeometry();
        if (normalPoints.length > 0) {
            normalGeo.setAttribute('position', new THREE.Float32BufferAttribute(normalPoints, 3));
        }

        const majorGeo = new THREE.BufferGeometry();
        if (majorPoints.length > 0) {
            majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorPoints, 3));
        }

        return { normalGeometry: normalGeo, majorGeometry: majorGeo };
    }, [contourData, minHeight, heightMultiplier]);

    return (
        <group>
            {/* Normal Contour Lines - single batched geometry */}
            {normalGeometry.attributes.position && (
                <lineSegments geometry={normalGeometry}>
                    <lineBasicMaterial
                        color={LINE_COLOR}
                        transparent
                        opacity={LINE_OPACITY}
                        linewidth={LINE_WIDTH}
                    />
                </lineSegments>
            )}

            {/* Major Contour Lines - single batched geometry */}
            {majorGeometry.attributes.position && (
                <lineSegments geometry={majorGeometry}>
                    <lineBasicMaterial
                        color={LINE_COLOR}
                        transparent
                        opacity={LINE_OPACITY}
                        linewidth={MAJOR_LINE_WIDTH}
                    />
                </lineSegments>
            )}

            {/* Labels - only for major contours, limited count for performance */}
            {SHOW_LABELS && contourData.labels.slice(0, 20).map((label, idx) => (
                <Text
                    key={`label-${idx}`}
                    position={label.position}
                    fontSize={LABEL_SIZE}
                    color={LABEL_COLOR}
                    anchorX="center"
                    anchorY="middle"
                    rotation={[-Math.PI / 2, 0, 0]}
                    outlineWidth={0.05}
                    outlineColor="#ffffff"
                >
                    {label.text}
                </Text>
            ))}
        </group>
    );
};
