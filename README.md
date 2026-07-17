# FloorRush

A browser MVP for a DanceRush-style floor game. It tracks both feet with MediaPipe Pose, maps camera coordinates onto a calibrated floor, and reports which of four lanes each foot occupies.

## Pipeline

```text
Camera
  → MediaPipe Pose Landmarker
  → ankle + heel + toe landmarks
  → perspective transform
  → normalized floor coordinates
  → four floor lanes
```

## Run locally

Requirements: Node.js and a browser with camera access.

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite. Camera access requires localhost or HTTPS. An internet connection is currently required to download the MediaPipe WASM runtime and pose model.

To create a production build:

```bash
npm run build
```

## Use

1. Choose the camera options before starting.
2. Click **Start camera** and allow camera access.
3. Click the floor corners clockwise:
   - A: far left
   - B: far right
   - C: near right
   - D: near left
4. Move both feet across the calibrated floor and watch the lane readout.

Use **Recalibrate floor** whenever the camera or play area moves.

## Camera options

- **Vertical camera** is enabled by default and requests a 9:16 stream. Some browsers or cameras may crop a landscape sensor to satisfy this request, which can look zoomed. Disable it for an uncropped landscape request.
- **Mirror view** flips the camera and overlay together. Changing it while the camera is active resets floor calibration.

## Pose framing

MediaPipe Pose is a full-body detector, not a feet-only detector. For reliable initialization, keep the head, shoulders, hips, knees, and both feet visible together. A lower-leg-only crop will usually return no pose, even when the feet are clear.

The current model is MediaPipe Pose Landmarker Full. Each foot position is calculated from its ankle, heel, and toe landmarks. Short detection gaps are held for 250 ms, and foot points are smoothed over time to reduce flicker.

## Floor coordinates

The four calibration clicks define a homography from camera pixels to normalized floor coordinates:

```text
(0, 0) ───────── (1, 0)
  L1    L2    L3    L4
(0, 1) ───────── (1, 1)
```

Feet outside this rectangle are reported as `OUTSIDE`.

## Current scope

This MVP includes camera capture, pose landmarks, calibration, lane detection, mirroring, portrait/landscape requests, and temporal smoothing. It does not yet include step/contact detection, scoring, music synchronization, or jump detection.
