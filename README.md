# Terrain Viewer 3D

This project visualizes 3D terrain using SRTM data (via AWS Terrain Tiles) for a specific area in Thailand (Khao Yai region).

## Stack
- Vite
- React
- Three.js (@react-three/fiber)
- Tailwind CSS

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open your browser to the local URL (usually http://localhost:5173).

## Features
- Real-time fetching of terrain elevation data.
- "Unreal-like" lighting with Sky, Atmosphere, and Fog.
- Interactive Orbit Controls.
- Stylized vertex coloring based on height.
