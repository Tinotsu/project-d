# Project D

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

The browser app includes level selection, camera calibration, gameplay, results, and a chart editor for **Second Heaven**. The recording is not distributed with this repository; provide a copy you are licensed to use at `public/music/second-heaven.mp3`.

To create a production build:

```bash
npm run build
```

## Use

1. Select the test level and click **Start camera**.
2. Click the floor corners clockwise:
   - A: far left
   - B: far right
   - C: near right
   - D: near left
3. Move both feet across the calibrated floor and watch the lane readout.

Use **Recalibrate floor** whenever the camera or play area moves.

The camera requests a horizontal 16:9 stream and mirrors the video and overlay automatically.

## Pose framing

Only the lower legs, both feet, and play floor need to be visible. The custom model predicts the big toe, small toe, and heel for each foot. The highest-confidence pose is used, short detection gaps are held for 250 ms, and foot points are smoothed over time to reduce flicker.

## Train a feet-only pose model

The [CMU Human Foot Keypoint Dataset](https://cmu-perceptual-computing-lab.github.io/foot_keypoint_dataset/) can train a six-keypoint YOLO Pose model without new labels. Its annotations are CC BY 4.0 and use images from COCO, whose copyrights remain with their respective owners. Download the train/validation annotation JSON files and the corresponding COCO 2017 images, then arrange them as:

```text
foot-pose/
  images/train2017/*.jpg
  images/val2017/*.jpg
```

Convert both splits. The converter also writes `foot-pose.yaml` with the correct dataset path:

```bash
python3 tools/foot_pose/convert_cmu.py person_keypoints_train2017_foot_v1.json /path/to/foot-pose train2017
python3 tools/foot_pose/convert_cmu.py person_keypoints_val2017_foot_v1.json /path/to/foot-pose val2017
```

The generated image lists include only CMU-annotated COCO images. Train and export a small pose model with Ultralytics:

```bash
python3 -m pip install ultralytics==8.4.98
yolo pose train data=/path/to/foot-pose/foot-pose.yaml model=yolo26n-pose.pt epochs=100 imgsz=640 batch=16 seed=0 deterministic=True
yolo export model=runs/pose/train/weights/best.pt format=onnx imgsz=640 simplify=True
```

Copy the exported model to `public/models/foot-pose.onnx` to use new weights in the browser.

The bundled model was trained on 10,970 images and validated on 434 images. At epoch 100 it reached pose mAP50 0.5956 and pose mAP50–95 0.4051, with 0.6995 precision and 0.5668 recall. It has not been validated for medical or safety-critical use; occlusion, footwear, lighting, and camera angle can reduce accuracy.

## Floor coordinates

The four calibration clicks define a homography from camera pixels to normalized floor coordinates:

```text
(0, 0) ───────── (1, 0)
  L1    L2    L3    L4
(0, 1) ───────── (1, 1)
```

Feet outside this rectangle are reported as `OUTSIDE`.

## Test level data

Song metadata is shared in `public/levels/second-heaven/song.json`. The separate difficulty chart in `public/levels/second-heaven/test.json` contains the level settings, timing grid, playfield, notes, and visual-effect settings. Note times are seconds from the start of the decoded audio.

The game uses Web Audio's context clock for gameplay timing and Three.js for the playfield. Scoring is independent from rendering in `src/domain/scoring/rhythm-engine.ts`. The chart editor can capture the current audio time, edit notes and timing, and save the resulting level to a local SQLite database.

`npm run dev` starts Vite and the local storage server together. Level data is stored in `.local-data/project-d.sqlite`; uploaded music is stored as local objects under `.local-data/music/`. The complete `.local-data` directory is ignored by Git.

## Application structure

- `src/app` owns application startup, routes, navigation, and application-level screens.
- `src/domain` contains chart types, floor calibration, note geometry, and deterministic scoring.
- `src/features` groups camera, gameplay, level-library, editor, and diagnostic screens.
- `src/infrastructure` contains Web Audio and ONNX pose-detection adapters.
- `src/rendering` contains the Three.js playfield and procedural shader assets.
- `src/shared` contains reusable UI components; `src/styles` contains application styles.
- `tools/foot_pose` contains model-training conversion utilities and their Python tests.

## Test

Run all TypeScript and Python tests:

```bash
npm run test:all
```

## Current scope

The browser app includes camera capture, pose landmarks, calibration, lane detection, automatic mirroring, buffered frame scoring, a test chart, Web Audio synchronization, product screens, results, and chart editing. The camera model and Pixi game runtime are loaded only when their screens need them.

## License

Project D, including its Ultralytics YOLO model, is licensed under the [GNU Affero General Public License v3.0](LICENSE). The CMU foot annotations are licensed separately under CC BY 4.0. COCO images and the Second Heaven recording are not distributed by this project.
