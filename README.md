# FloorRush

A browser MVP for a DanceRush-style floor game. It tracks both feet with a custom YOLO Pose model, maps camera coordinates onto a calibrated floor, and reports which of four lanes each foot occupies.

## Pipeline

```text
Camera
  → YOLO feet-only pose model
  → big toe + small toe + heel landmarks
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

Open the localhost URL printed by Vite. Camera access requires localhost or HTTPS. The ONNX model and runtime are bundled with the app.

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

Only the lower legs, both feet, and play floor need to be visible. The custom model predicts the big toe, small toe, and heel for each foot. The highest-confidence pose is used, short detection gaps are held for 250 ms, and foot points are smoothed over time to reduce flicker.

## Train a feet-only pose model

The CMU Human Foot Keypoint Dataset can train a six-keypoint YOLO Pose model without new labels. Download its train/validation annotation JSON files and the corresponding COCO 2017 images, then arrange them as:

```text
foot-pose/
  images/train2017/*.jpg
  images/val2017/*.jpg
```

Convert both splits. The converter also writes `foot-pose.yaml` with the correct dataset path:

```bash
python3 scripts/convert_cmu_to_yolo_pose.py person_keypoints_train2017_foot_v1.json /path/to/foot-pose train2017
python3 scripts/convert_cmu_to_yolo_pose.py person_keypoints_val2017_foot_v1.json /path/to/foot-pose val2017
```

The generated image lists include only CMU-annotated COCO images. Train and export a small pose model with Ultralytics:

```bash
python3 -m pip install ultralytics
yolo pose train data=/path/to/foot-pose/foot-pose.yaml model=yolo26n-pose.pt epochs=100 imgsz=640
yolo export model=runs/pose/train/weights/best.pt format=onnx imgsz=640 simplify=True
```

Copy the exported model to `public/models/foot-pose.onnx` to use new weights in the browser.

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
