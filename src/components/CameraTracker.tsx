import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';

interface CameraTrackerProps {
    onRotationChange: (angle: number) => void;
}

export const CameraTracker: React.FC<CameraTrackerProps> = ({ onRotationChange }) => {
    const { camera } = useThree();

    useFrame(() => {
        // Calculate angle from camera position (looking at origin)
        const angle = Math.atan2(camera.position.x, camera.position.z);
        const degrees = (angle * 180 / Math.PI);
        onRotationChange(-degrees); // Negative because we want compass to counter-rotate
    });

    return null;
};
