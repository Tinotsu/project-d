import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import {
  calibrateFloor,
  floorLane,
  projectFloorPoint,
  projectFoot,
  type Homography,
  type Point,
} from "./floor.ts";
import "./style.css";

const video = document.querySelector<HTMLVideoElement>("#camera")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const context = canvas.getContext("2d")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const recalibrateButton = document.querySelector<HTMLButtonElement>("#recalibrate")!;
const verticalToggle = document.querySelector<HTMLInputElement>("#vertical")!;
const mirrorToggle = document.querySelector<HTMLInputElement>("#mirror")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const cornerPrompt = document.querySelector<HTMLElement>("#corner-prompt")!;
const hint = document.querySelector<HTMLElement>("#hint")!;
const status = document.querySelector<HTMLElement>("#status")!;
const setupTitle = document.querySelector<HTMLElement>("#setup-title")!;
const setupCopy = document.querySelector<HTMLElement>("#setup-copy")!;
const stepMarkers = [...document.querySelectorAll<HTMLElement>(".steps span")];
const leftLane = document.querySelector<HTMLElement>("#left-lane")!;
const rightLane = document.querySelector<HTMLElement>("#right-lane")!;
const leftPosition = document.querySelector<HTMLElement>("#left-position")!;
const rightPosition = document.querySelector<HTMLElement>("#right-position")!;

const cornerNames = ["A · FAR LEFT", "B · FAR RIGHT", "C · NEAR RIGHT", "D · NEAR LEFT"];
const footLandmarks = {
  left: [27, 29, 31],
  right: [28, 30, 32],
} as const;
const footColors = { left: "#34d9ff", right: "#ff3b9d" };

let poseLandmarker: PoseLandmarker;
let drawingUtils: DrawingUtils;
let corners: Point[] = [];
let floorTransform: Homography | undefined;
let lastVideoTime = -1;
let animationFrame = 0;

function setStatus(message: string, active = false): void {
  if (status.querySelector("span")!.textContent === message && status.classList.contains("active") === active) return;
  status.querySelector("span")!.textContent = message;
  status.classList.toggle("active", active);
}

function beginCalibration(): void {
  corners = [];
  floorTransform = undefined;
  canvas.classList.add("calibrating");
  recalibrateButton.disabled = true;
  cornerPrompt.hidden = false;
  cornerPrompt.textContent = `CLICK ${cornerNames[0]}`;
  setupTitle.textContent = "Mark the four floor corners";
  setupCopy.textContent = "Click clockwise: far left, far right, near right, near left.";
  hint.textContent = "Click corner A: the far-left edge of your play area.";
  stepMarkers.forEach((marker, index) => marker.classList.toggle("active", index <= 1));
}

function drawFloor(lanes: Set<number>): void {
  if (!floorTransform) return;

  for (let lane = 0; lane < 4; lane++) {
    const start = lane / 4;
    const end = (lane + 1) / 4;
    const points = [
      projectFloorPoint({ x: start, y: 0 }, floorTransform),
      projectFloorPoint({ x: end, y: 0 }, floorTransform),
      projectFloorPoint({ x: end, y: 1 }, floorTransform),
      projectFloorPoint({ x: start, y: 1 }, floorTransform),
    ];
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.fillStyle = lanes.has(lane + 1) ? "rgba(255, 230, 64, .24)" : "rgba(10, 13, 19, .18)";
    context.strokeStyle = lanes.has(lane + 1) ? "#ffe640" : "rgba(255, 255, 255, .55)";
    context.lineWidth = lanes.has(lane + 1) ? 4 : 2;
    context.fill();
    context.stroke();
  }
}

function drawCalibrationPoints(): void {
  corners.forEach((point, index) => {
    const x = mirrorToggle.checked ? canvas.width - point.x : point.x;
    context.beginPath();
    context.arc(x, point.y, 12, 0, Math.PI * 2);
    context.fillStyle = "#ffe640";
    context.fill();
    context.fillStyle = "#08090d";
    context.font = "700 13px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String.fromCharCode(65 + index), x, point.y + 1);
  });
}

function readFoot(
  landmarks: NormalizedLandmark[],
  side: "left" | "right",
): [Point, Point, Point] | null {
  const points = footLandmarks[side].map((index) => landmarks[index]);
  if (points.some((point) => (point.visibility ?? 1) < 0.5)) return null;

  const pixels = points.map((point) => ({ x: point.x * canvas.width, y: point.y * canvas.height })) as [
    Point,
    Point,
    Point,
  ];
  context.beginPath();
  pixels.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
  context.fillStyle = `${footColors[side]}55`;
  context.strokeStyle = footColors[side];
  context.lineWidth = 4;
  context.fill();
  context.stroke();
  pixels.forEach((point) => {
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fillStyle = footColors[side];
    context.fill();
  });
  return pixels;
}

function showFoot(side: "left" | "right", point: Point | null): number | null {
  const lane = point ? floorLane(point) : null;
  const laneElement = side === "left" ? leftLane : rightLane;
  const positionElement = side === "left" ? leftPosition : rightPosition;
  laneElement.textContent = lane ? `LANE ${lane}` : point ? "OUTSIDE" : "—";
  positionElement.textContent = point ? `x ${point.x.toFixed(2)}   y ${point.y.toFixed(2)}` : "x —   y —";
  return lane;
}

function render(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  const occupiedLanes = new Set<number>();
  context.save();
  if (mirrorToggle.checked) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }

  if (poseLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    const landmarks = result.landmarks[0];
    if (landmarks) {
      drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: "rgba(255,255,255,.45)",
        lineWidth: 2,
      });
      const left = readFoot(landmarks, "left");
      const right = readFoot(landmarks, "right");
      const leftFloor = left && floorTransform ? projectFoot(left, floorTransform) : null;
      const rightFloor = right && floorTransform ? projectFoot(right, floorTransform) : null;
      const leftZone = showFoot("left", leftFloor);
      const rightZone = showFoot("right", rightFloor);
      if (leftZone) occupiedLanes.add(leftZone);
      if (rightZone) occupiedLanes.add(rightZone);
      if (left && right) {
        setStatus("Tracking feet", true);
      } else {
        setStatus("Feet not visible");
        setupTitle.textContent = "Keep both feet in frame";
        setupCopy.textContent = "Step back until your hips, knees, and both feet are visible.";
      }
    } else {
      showFoot("left", null);
      showFoot("right", null);
      setStatus("No full pose in view");
      setupTitle.textContent = "Move back from the camera";
      setupCopy.textContent = "MediaPipe needs your hips, knees, and feet visible together to find a pose.";
    }
  }

  drawFloor(occupiedLanes);
  context.restore();
  drawCalibrationPoints();
  animationFrame = requestAnimationFrame(render);
}

canvas.addEventListener("click", (event) => {
  if (!canvas.classList.contains("calibrating") || corners.length >= 4) return;
  const bounds = canvas.getBoundingClientRect();
  const sourceAspect = canvas.width / canvas.height;
  const boundsAspect = bounds.width / bounds.height;
  const displayWidth = sourceAspect > boundsAspect ? bounds.width : bounds.height * sourceAspect;
  const displayHeight = sourceAspect > boundsAspect ? bounds.width / sourceAspect : bounds.height;
  const displayX = event.clientX - bounds.left - (bounds.width - displayWidth) / 2;
  const displayY = event.clientY - bounds.top - (bounds.height - displayHeight) / 2;
  if (displayX < 0 || displayX > displayWidth || displayY < 0 || displayY > displayHeight) return;
  const x = (displayX / displayWidth) * canvas.width;
  corners.push({
    x: mirrorToggle.checked ? canvas.width - x : x,
    y: (displayY / displayHeight) * canvas.height,
  });

  if (corners.length < 4) {
    cornerPrompt.textContent = `CLICK ${cornerNames[corners.length]}`;
    hint.textContent = `Click corner ${String.fromCharCode(65 + corners.length)}: ${cornerNames[corners.length].split(" · ")[1].toLowerCase()}.`;
    return;
  }

  try {
    floorTransform = calibrateFloor(corners as [Point, Point, Point, Point]);
    canvas.classList.remove("calibrating");
    cornerPrompt.hidden = true;
    recalibrateButton.disabled = false;
    setupTitle.textContent = "Floor tracking is live";
    setupCopy.textContent = "Move each foot across the floor to check all four lanes.";
    hint.textContent = "Calibration complete. Blue and pink markers show the tracked feet.";
    stepMarkers.forEach((marker) => marker.classList.add("active"));
    setStatus("Tracking live", true);
  } catch (error) {
    beginCalibration();
    setupCopy.textContent = error instanceof Error ? error.message : "Please mark the floor again.";
  }
});

recalibrateButton.addEventListener("click", beginCalibration);

mirrorToggle.addEventListener("change", () => {
  stage.classList.toggle("mirrored", mirrorToggle.checked);
  if (video.srcObject) {
    beginCalibration();
    setStatus("Choose floor corners");
  }
});

verticalToggle.addEventListener("change", () => {
  stage.style.aspectRatio = verticalToggle.checked
    ? "9 / 16"
    : video.videoWidth
      ? `${video.videoWidth} / ${video.videoHeight}`
      : "16 / 9";
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  setStatus("Loading pose model…");
  setupTitle.textContent = "Starting pose tracking";
  setupCopy.textContent = "Allow camera access when your browser asks.";

  try {
    const [vision, stream] = await Promise.all([
      FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"),
      navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          frameRate: { ideal: 30 },
          resizeMode: "none",
        } as MediaTrackConstraints & { resizeMode: string },
        audio: false,
      }),
    ]);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    video.srcObject = stream;
    await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    stage.style.aspectRatio = verticalToggle.checked ? "9 / 16" : `${video.videoWidth} / ${video.videoHeight}`;
    drawingUtils = new DrawingUtils(context);
    emptyState.hidden = true;
    startButton.hidden = true;
    beginCalibration();
    setStatus("Choose floor corners");
    cancelAnimationFrame(animationFrame);
    render();
  } catch (error) {
    startButton.disabled = false;
    setStatus("Could not start camera");
    setupTitle.textContent = "Camera unavailable";
    setupCopy.textContent = error instanceof Error ? error.message : "Check browser camera permissions and try again.";
  }
});
