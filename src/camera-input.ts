import {
  calibrateFloor,
  floorLane,
  projectFloorPoint,
  projectFoot,
  type Homography,
  type Point,
} from "./floor.ts";
import {
  FootPoseDetector,
  InputActionState,
  JumpDetector,
  type InputAction,
  type InputFrame,
  type Keypoint,
} from "./foot-pose.ts";
import {
  loadCalibrationSettings,
  type CalibrationSettings,
} from "./calibration-settings.ts";

const cornerNames = ["A · FAR LEFT", "B · FAR RIGHT", "C · NEAR RIGHT", "D · NEAR LEFT"];
const footColors = { left: "#35dcff", right: "#ff4fa2" };

export type CameraSnapshot = {
  status: string;
  hint: string;
  active: boolean;
  starting: boolean;
  started: boolean;
  calibrated: boolean;
  calibrating: boolean;
  cornerPrompt?: string;
  leftLane: number | null;
  rightLane: number | null;
  leftPosition: Point | null;
  rightPosition: Point | null;
  jumping: boolean;
};

export const initialCameraSnapshot: CameraSnapshot = {
  status: "Camera not started",
  hint: "Keep your lower legs, both feet, and the play floor in frame.",
  active: false,
  starting: false,
  started: false,
  calibrated: false,
  calibrating: false,
  leftLane: null,
  rightLane: null,
  leftPosition: null,
  rightPosition: null,
  jumping: false,
};

export class CameraInput {
  private detector?: FootPoseDetector;
  private stream?: MediaStream;
  private video?: HTMLVideoElement;
  private canvas?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D;
  private frame = 0;
  private renderGeneration = 0;
  private transform?: Homography;
  private corners: Point[] = [];
  private settings = loadCalibrationSettings();
  private jumpDetector = new JumpDetector(this.settings);
  private inputActions = new InputActionState(this.settings);
  private snapshot = initialCameraSnapshot;
  private onSnapshot?: (snapshot: CameraSnapshot) => void;
  private onFrame?: (frame: InputFrame) => void;

  attach(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    onSnapshot: (snapshot: CameraSnapshot) => void,
    onFrame: (frame: InputFrame) => void,
  ): void {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext("2d")!;
    this.onSnapshot = onSnapshot;
    this.onFrame = onFrame;
    onSnapshot(this.snapshot);
    if (this.stream) void this.connectVideo();
  }

  detach(): void {
    if (this.video && this.frame) this.video.cancelVideoFrameCallback(this.frame);
    this.frame = 0;
    this.renderGeneration++;
    this.video = undefined;
    this.canvas = undefined;
    this.context = undefined;
    this.onSnapshot = undefined;
    this.onFrame = undefined;
  }

  async start(): Promise<void> {
    if (!this.video || !this.canvas) return;
    this.setSnapshot({
      status: "Loading foot model…",
      hint: "Allow camera access when your browser asks.",
      starting: true,
    });

    try {
      const [detector, stream] = await Promise.all([
        FootPoseDetector.create("/models/foot-pose.onnx"),
        navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        }),
      ]);
      this.detector = detector;
      this.stream = stream;
      await this.connectVideo();
      this.beginCalibration();
    } catch (error) {
      this.setSnapshot({
        status: "Could not start camera",
        hint: error instanceof Error ? error.message : "Check camera permission and try again.",
        starting: false,
      });
    }
  }

  beginCalibration(): void {
    if (!this.stream) return;
    this.corners = [];
    this.transform = undefined;
    this.jumpDetector.reset();
    this.inputActions.reset();
    this.setSnapshot({
      status: "Mark four floor corners",
      hint: "Click the far-left corner of your play area.",
      active: false,
      starting: false,
      started: true,
      calibrated: false,
      calibrating: true,
      cornerPrompt: `CLICK ${cornerNames[0]}`,
      leftLane: null,
      rightLane: null,
      leftPosition: null,
      rightPosition: null,
      jumping: false,
    });
  }

  markCorner(clientX: number, clientY: number, bounds: DOMRect): void {
    if (!this.canvas || !this.snapshot.calibrating || this.corners.length >= 4) return;
    const x = ((clientX - bounds.left) / bounds.width) * this.canvas.width;
    this.corners.push({
      x: this.canvas.width - x,
      y: ((clientY - bounds.top) / bounds.height) * this.canvas.height,
    });

    if (this.corners.length < 4) {
      const corner = cornerNames[this.corners.length];
      this.setSnapshot({
        hint: `Click ${corner.split(" · ")[1].toLowerCase()}.`,
        cornerPrompt: `CLICK ${corner}`,
      });
      return;
    }

    try {
      this.transform = calibrateFloor(this.corners as [Point, Point, Point, Point]);
      this.setSnapshot({
        status: "Floor calibrated",
        hint: "Blue and pink markers show the detected feet.",
        active: true,
        calibrated: true,
        calibrating: false,
        cornerPrompt: undefined,
      });
    } catch (error) {
      this.beginCalibration();
      this.setSnapshot({ hint: error instanceof Error ? error.message : "Mark the floor again." });
    }
  }

  resetActions(): void {
    this.inputActions.reset();
    this.jumpDetector.reset();
  }

  setMovementSettings(settings: CalibrationSettings): void {
    this.settings = settings;
    this.jumpDetector = new JumpDetector(settings);
    this.inputActions = new InputActionState(settings);
  }

  destroy(): void {
    this.detach();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }

  private async connectVideo(): Promise<void> {
    if (!this.video || !this.canvas || !this.stream) return;
    this.video.srcObject = this.stream;
    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) => this.video!.addEventListener("loadedmetadata", () => resolve(), { once: true }));
    }
    await this.video.play();
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    if (this.frame) this.video.cancelVideoFrameCallback(this.frame);
    const generation = ++this.renderGeneration;
    this.frame = this.video.requestVideoFrameCallback((_, metadata) => void this.render(metadata, generation));
  }

  private async render(metadata: VideoFrameCallbackMetadata, generation: number): Promise<void> {
    if (!this.detector || !this.video || !this.canvas || !this.context) return;
    const video = this.video;
    const capturedAt = metadata.captureTime ?? metadata.presentationTime;
    const pose = await this.detector.detect(video);
    if (generation !== this.renderGeneration || video !== this.video || !this.canvas || !this.context) return;
    const occupiedLanes = new Set<number>();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.save();
    this.context.translate(this.canvas.width, 0);
    this.context.scale(-1, 1);

    const left = this.readFoot(pose?.left ?? null, "left");
    const right = this.readFoot(pose?.right ?? null, "right");
    if (!left || !right) this.jumpDetector.reset();
    const leftY = left ? left.reduce((sum, point) => sum + point.y, 0) / (left.length * this.canvas.height) : null;
    const rightY = right ? right.reduce((sum, point) => sum + point.y, 0) / (right.length * this.canvas.height) : null;
    const jumping = leftY !== null && rightY !== null ? this.jumpDetector.update(leftY, rightY) : false;
    const leftPosition = left && this.transform ? projectFoot(left, this.transform) : null;
    const rightPosition = right && this.transform ? projectFoot(right, this.transform) : null;
    const leftLane = leftPosition ? floorLane(leftPosition) : null;
    const rightLane = rightPosition ? floorLane(rightPosition) : null;

    let actions: InputAction[] = [];
    if (this.transform) {
      actions = this.inputActions.update(leftLane, rightLane, leftY, rightY, jumping);
      if (leftLane) occupiedLanes.add(leftLane);
      if (rightLane) occupiedLanes.add(rightLane);
      this.setSnapshot({
        status: left && right ? "Tracking both feet" : "Move both feet into view",
        active: Boolean(left && right),
        leftLane,
        rightLane,
        leftPosition,
        rightPosition,
        jumping,
      });
    } else {
      this.inputActions.reset();
    }
    this.onFrame?.({ capturedAt, actions });

    this.drawFloor(occupiedLanes);
    this.context.restore();
    this.drawCalibrationPoints();
    this.frame = video.requestVideoFrameCallback((_, nextMetadata) => void this.render(nextMetadata, generation));
  }

  private readFoot(
    points: [Keypoint, Keypoint, Keypoint] | null,
    side: "left" | "right",
  ): [Point, Point, Point] | null {
    if (!points?.every((point) => point.confidence >= this.settings.minimumFootConfidence) || !this.context) return null;

    this.context.beginPath();
    points.forEach((point, index) => index ? this.context!.lineTo(point.x, point.y) : this.context!.moveTo(point.x, point.y));
    this.context.closePath();
    this.context.fillStyle = `${footColors[side]}55`;
    this.context.strokeStyle = footColors[side];
    this.context.lineWidth = 4;
    this.context.fill();
    this.context.stroke();
    return points;
  }

  private drawFloor(occupiedLanes: Set<number>): void {
    if (!this.transform || !this.context) return;
    for (let lane = 0; lane < 4; lane++) {
      const start = lane / 4;
      const end = (lane + 1) / 4;
      const points = [
        projectFloorPoint({ x: start, y: 0 }, this.transform),
        projectFloorPoint({ x: end, y: 0 }, this.transform),
        projectFloorPoint({ x: end, y: 1 }, this.transform),
        projectFloorPoint({ x: start, y: 1 }, this.transform),
      ];
      this.context.beginPath();
      points.forEach((point, index) => index ? this.context!.lineTo(point.x, point.y) : this.context!.moveTo(point.x, point.y));
      this.context.closePath();
      this.context.fillStyle = occupiedLanes.has(lane + 1) ? "rgba(255, 230, 64, .24)" : "rgba(10, 13, 19, .18)";
      this.context.strokeStyle = occupiedLanes.has(lane + 1) ? "#ffe640" : "rgba(255, 255, 255, .55)";
      this.context.lineWidth = occupiedLanes.has(lane + 1) ? 4 : 2;
      this.context.fill();
      this.context.stroke();
    }
  }

  private drawCalibrationPoints(): void {
    if (!this.canvas || !this.context) return;
    this.corners.forEach((point, index) => {
      this.context!.beginPath();
      this.context!.arc(this.canvas!.width - point.x, point.y, 11, 0, Math.PI * 2);
      this.context!.fillStyle = "#ffe640";
      this.context!.fill();
      this.context!.fillStyle = "#08090d";
      this.context!.font = "700 12px sans-serif";
      this.context!.textAlign = "center";
      this.context!.textBaseline = "middle";
      this.context!.fillText(String.fromCharCode(65 + index), this.canvas!.width - point.x, point.y + 1);
    });
  }

  private setSnapshot(patch: Partial<CameraSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onSnapshot?.(this.snapshot);
  }
}
