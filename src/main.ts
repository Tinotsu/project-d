import {
  calibrateFloor,
  floorLane,
  projectFloorPoint,
  projectFoot,
  type Homography,
  type Point,
} from "./floor.ts";
import { FootPoseDetector, InputActionState, JumpDetector, type InputAction, type Keypoint } from "./foot-pose.ts";
import "./style.css";

const video = document.querySelector<HTMLVideoElement>("#camera")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const context = canvas.getContext("2d")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const recalibrateButton = document.querySelector<HTMLButtonElement>("#recalibrate")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const cornerPrompt = document.querySelector<HTMLElement>("#corner-prompt")!;
const hint = document.querySelector<HTMLElement>("#hint")!;
const status = document.querySelector<HTMLElement>("#status")!;
const leftLane = document.querySelector<HTMLElement>("#left-lane")!;
const rightLane = document.querySelector<HTMLElement>("#right-lane")!;
const leftPosition = document.querySelector<HTMLElement>("#left-position")!;
const rightPosition = document.querySelector<HTMLElement>("#right-position")!;
const jumpStatus = document.querySelector<HTMLElement>("#jump-status")!;
const eventLog = document.querySelector<HTMLElement>("#event-log")!;

const cornerNames = ["A · FAR LEFT", "B · FAR RIGHT", "C · NEAR RIGHT", "D · NEAR LEFT"];
const footColors = { left: "#34d9ff", right: "#ff3b9d" };

let poseDetector: FootPoseDetector;
let corners: Point[] = [];
let floorTransform: Homography | undefined;
let lastVideoTime = -1;
let animationFrame = 0;
let smoothedFeet: Partial<Record<"left" | "right", [Point, Point, Point]>> = {};
const lastFootTime = { left: 0, right: 0 };
const jumpDetector = new JumpDetector();
const inputActions = new InputActionState();

function setStatus(message: string, active = false): void {
  if (status.querySelector("span")!.textContent === message && status.classList.contains("active") === active) return;
  status.querySelector("span")!.textContent = message;
  status.classList.toggle("active", active);
}

function beginCalibration(): void {
  corners = [];
  floorTransform = undefined;
  smoothedFeet = {};
  jumpDetector.reset();
  inputActions.reset();
  canvas.classList.add("calibrating");
  recalibrateButton.disabled = true;
  cornerPrompt.hidden = false;
  cornerPrompt.textContent = `CLICK ${cornerNames[0]}`;
  hint.textContent = "Click corner A: the far-left edge of your play area.";
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
    const x = canvas.width - point.x;
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
  points: [Keypoint, Keypoint, Keypoint] | null,
  side: "left" | "right",
): [Point, Point, Point] | null {
  const now = performance.now();
  let pixels = smoothedFeet[side];
  if (points?.every((point) => point.confidence >= 0.5)) {
    pixels = points.map((point, index) => {
      const previous = smoothedFeet[side]?.[index];
      return previous
        ? { x: previous.x + (point.x - previous.x) * 0.35, y: previous.y + (point.y - previous.y) * 0.35 }
        : point;
    }) as [Point, Point, Point];
    smoothedFeet[side] = pixels;
    lastFootTime[side] = now;
  }
  if (!pixels || now - lastFootTime[side] > 250) return null;

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

function showJump(jumping: boolean): void {
  jumpStatus.textContent = jumping ? "JUMP!" : "GROUNDED";
  jumpStatus.classList.toggle("active", jumping);
}

function showAction(action: InputAction): void {
  eventLog.querySelector(".event-empty")?.remove();
  const message = document.createElement("p");
  message.textContent = action.lane ? `${action.type} · LANE ${action.lane}` : action.type;
  eventLog.append(message);
  if (eventLog.children.length > 10) eventLog.firstElementChild?.remove();
  eventLog.scrollTop = eventLog.scrollHeight;
}

async function render(): Promise<void> {
  if (!poseDetector || video.readyState < 2 || video.currentTime === lastVideoTime) {
    animationFrame = requestAnimationFrame(render);
    return;
  }
  lastVideoTime = video.currentTime;
  const pose = await poseDetector.detect(video);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const occupiedLanes = new Set<number>();
  context.save();
  context.translate(canvas.width, 0);
  context.scale(-1, 1);

  {
    const left = readFoot(pose?.left ?? null, "left");
    const right = readFoot(pose?.right ?? null, "right");
    if (!left || !right) jumpDetector.reset();
    const jumping = left && right
      ? jumpDetector.update(
          left.reduce((sum, point) => sum + point.y, 0) / (left.length * canvas.height),
          right.reduce((sum, point) => sum + point.y, 0) / (right.length * canvas.height),
        )
      : false;
    showJump(jumping);
    if (left || right) {
      const leftFloor = left && floorTransform ? projectFoot(left, floorTransform) : null;
      const rightFloor = right && floorTransform ? projectFoot(right, floorTransform) : null;
      const leftZone = showFoot("left", leftFloor);
      const rightZone = showFoot("right", rightFloor);
      inputActions.update(leftZone, rightZone, jumping).forEach((action) => {
        window.dispatchEvent(new CustomEvent(action.type, { detail: action }));
        showAction(action);
      });
      if (leftZone) occupiedLanes.add(leftZone);
      if (rightZone) occupiedLanes.add(rightZone);
      if (left && right) {
        setStatus("Tracking feet", true);
      } else {
        setStatus("Feet not visible");
      }
    } else {
      inputActions.update(null, null, false);
      showFoot("left", null);
      showFoot("right", null);
      setStatus("No feet in view");
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
  const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
  corners.push({
    x: canvas.width - x,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
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
    hint.textContent = "Calibration complete. Blue and pink markers show the tracked feet.";
    setStatus("Tracking live", true);
  } catch (error) {
    beginCalibration();
    hint.textContent = error instanceof Error ? error.message : "Please mark the floor again.";
  }
});

recalibrateButton.addEventListener("click", beginCalibration);

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  setStatus("Loading pose model…");
  hint.textContent = "Allow camera access when your browser asks.";

  try {
    const [detector, stream] = await Promise.all([
      FootPoseDetector.create("/models/foot-pose.onnx"),
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30 } },
        audio: false,
      }),
    ]);
    poseDetector = detector;

    video.srcObject = stream;
    await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    emptyState.hidden = true;
    startButton.hidden = true;
    beginCalibration();
    setStatus("Choose floor corners");
    cancelAnimationFrame(animationFrame);
    render();
  } catch (error) {
    startButton.disabled = false;
    setStatus("Could not start camera");
    hint.textContent = error instanceof Error ? error.message : "Check browser camera permissions and try again.";
  }
});
