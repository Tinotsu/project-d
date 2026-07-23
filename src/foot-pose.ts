import * as ort from "onnxruntime-web/webgpu";
import { defaultCalibrationSettings, type CalibrationSettings } from "./calibration-settings.ts";

const modelSize = 640;
const outputRowSize = 24;

export type Keypoint = { x: number; y: number; confidence: number };
export type FootPose = {
  score: number;
  left: [Keypoint, Keypoint, Keypoint];
  right: [Keypoint, Keypoint, Keypoint];
};
export type InputAction =
  | { type: "LEFT_STEP" | "RIGHT_STEP"; lane: number }
  | { type: "LEFT_SLIDE" | "RIGHT_SLIDE"; lane: number; endLane: number; startedAt: DOMHighResTimeStamp }
  | { type: "JUMP"; lane?: never };
export type InputFrame = {
  capturedAt: DOMHighResTimeStamp;
  actions: InputAction[];
};

class FootContactState {
  private groundY?: number;
  private peakY?: number;
  private lifted = false;

  constructor(private readonly settings: CalibrationSettings) {}

  update(y: number | null): boolean {
    if (y === null) {
      this.reset();
      return false;
    }
    if (this.groundY === undefined) {
      this.groundY = y;
      return false;
    }
    if (!this.lifted && this.groundY - y > this.settings.stepLift) {
      this.lifted = true;
      this.peakY = y;
      return false;
    }
    if (this.lifted) this.peakY = Math.min(this.peakY!, y);
    if (this.lifted && (y > this.groundY - this.settings.stepLanding || y - this.peakY! > this.settings.stepDescent)) {
      this.lifted = false;
      this.groundY = y;
      this.peakY = undefined;
      return true;
    }
    if (!this.lifted) this.groundY = Math.max(this.groundY, y);
    return false;
  }

  reset(): void {
    this.groundY = this.peakY = undefined;
    this.lifted = false;
  }
}

export class InputActionState {
  private readonly leftContact: FootContactState;
  private readonly rightContact: FootContactState;
  private leftLane?: number;
  private rightLane?: number;
  private leftLaneAt = 0;
  private rightLaneAt = 0;
  private jumping = false;

  constructor(private readonly settings = defaultCalibrationSettings) {
    this.leftContact = new FootContactState(settings);
    this.rightContact = new FootContactState(settings);
  }

  update(leftLane: number | null, rightLane: number | null, leftY: number | null, rightY: number | null, jumping: boolean, capturedAt: DOMHighResTimeStamp): InputAction[] {
    const actions: InputAction[] = [];
    if (jumping && !this.jumping) actions.push({ type: "JUMP" });
    this.jumping = jumping;
    if (jumping) {
      this.leftContact.reset();
      this.rightContact.reset();
      return actions;
    }

    const leftStep = this.leftContact.update(leftY);
    const leftSlide = leftLane !== null && this.leftLane !== undefined
      && Math.abs(leftLane - this.leftLane) >= 2
      && capturedAt - this.leftLaneAt <= this.settings.responseTimeoutMs;
    if (leftSlide) {
      actions.push({ type: "LEFT_SLIDE", lane: this.leftLane!, endLane: this.leftLane! + Math.sign(leftLane! - this.leftLane!) * 2, startedAt: this.leftLaneAt });
      this.leftLane = leftLane!;
      this.leftLaneAt = capturedAt;
    } else if (leftStep && leftLane !== null) {
      actions.push({ type: "LEFT_STEP", lane: leftLane });
    }
    if (leftLane !== null && (this.leftLane === undefined || leftLane === this.leftLane || capturedAt - this.leftLaneAt > this.settings.responseTimeoutMs)) {
      this.leftLane = leftLane;
      this.leftLaneAt = capturedAt;
    }

    const rightStep = this.rightContact.update(rightY);
    const rightSlide = rightLane !== null && this.rightLane !== undefined
      && Math.abs(rightLane - this.rightLane) >= 2
      && capturedAt - this.rightLaneAt <= this.settings.responseTimeoutMs;
    if (rightSlide) {
      actions.push({ type: "RIGHT_SLIDE", lane: this.rightLane!, endLane: this.rightLane! + Math.sign(rightLane! - this.rightLane!) * 2, startedAt: this.rightLaneAt });
      this.rightLane = rightLane!;
      this.rightLaneAt = capturedAt;
    } else if (rightStep && rightLane !== null) {
      actions.push({ type: "RIGHT_STEP", lane: rightLane });
    }
    if (rightLane !== null && (this.rightLane === undefined || rightLane === this.rightLane || capturedAt - this.rightLaneAt > this.settings.responseTimeoutMs)) {
      this.rightLane = rightLane;
      this.rightLaneAt = capturedAt;
    }
    return actions;
  }

  reset(): void {
    this.leftContact.reset();
    this.rightContact.reset();
    this.leftLane = this.rightLane = undefined;
    this.leftLaneAt = this.rightLaneAt = 0;
    this.jumping = false;
  }
}

export class JumpDetector {
  private groundLeft?: number;
  private groundRight?: number;
  private peakLeft?: number;
  private peakRight?: number;
  private jumping = false;

  constructor(private readonly settings = defaultCalibrationSettings) {}

  update(leftY: number, rightY: number): boolean {
    if (this.groundLeft === undefined || this.groundRight === undefined) {
      this.groundLeft = leftY;
      this.groundRight = rightY;
      return false;
    }

    if (!this.jumping && this.groundLeft - leftY > this.settings.jumpLift && this.groundRight - rightY > this.settings.jumpLift) {
      this.jumping = true;
      this.peakLeft = leftY;
      this.peakRight = rightY;
    } else if (this.jumping) {
      this.peakLeft = Math.min(this.peakLeft!, leftY);
      this.peakRight = Math.min(this.peakRight!, rightY);
      if (
        (leftY > this.groundLeft - this.settings.jumpLanding && rightY > this.groundRight - this.settings.jumpLanding)
        || (leftY - this.peakLeft > this.settings.jumpDescent && rightY - this.peakRight > this.settings.jumpDescent)
      ) {
        this.jumping = false;
        this.groundLeft = leftY;
        this.groundRight = rightY;
      }
    }

    if (!this.jumping) {
      this.groundLeft = Math.max(this.groundLeft, leftY);
      this.groundRight = Math.max(this.groundRight, rightY);
    }
    return this.jumping;
  }

  reset(): void {
    this.groundLeft = this.groundRight = this.peakLeft = this.peakRight = undefined;
    this.jumping = false;
  }
}

export function decodeFootPose(
  output: ArrayLike<number>,
  scale: number,
  paddingX: number,
  paddingY: number,
  minimumConfidence = 0.35,
): FootPose | null {
  let best = -1;
  for (let offset = 0; offset < output.length; offset += outputRowSize) {
    if (best < 0 || output[offset + 4] > output[best + 4]) best = offset;
  }
  if (best < 0 || output[best + 4] < minimumConfidence) return null;

  const points = Array.from({ length: 6 }, (_, index) => {
    const offset = best + 6 + index * 3;
    return {
      x: (output[offset] - paddingX) / scale,
      y: (output[offset + 1] - paddingY) / scale,
      confidence: output[offset + 2],
    };
  }) as [Keypoint, Keypoint, Keypoint, Keypoint, Keypoint, Keypoint];
  return { score: output[best + 4], left: points.slice(0, 3), right: points.slice(3) } as FootPose;
}

export class FootPoseDetector {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;

  private constructor(private readonly session: ort.InferenceSession) {
    this.canvas.width = modelSize;
    this.canvas.height = modelSize;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  static async create(modelPath: string): Promise<FootPoseDetector> {
    const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
    try {
      return new FootPoseDetector(await ort.InferenceSession.create(modelPath, { executionProviders: providers }));
    } catch (error) {
      if (providers.length === 1) throw error;
      return new FootPoseDetector(await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] }));
    }
  }

  async detect(video: HTMLVideoElement): Promise<FootPose | null> {
    const scale = Math.min(modelSize / video.videoWidth, modelSize / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    const paddingX = (modelSize - width) / 2;
    const paddingY = (modelSize - height) / 2;
    this.context.fillStyle = "rgb(114, 114, 114)";
    this.context.fillRect(0, 0, modelSize, modelSize);
    this.context.drawImage(video, paddingX, paddingY, width, height);

    const rgba = this.context.getImageData(0, 0, modelSize, modelSize).data;
    const planeSize = modelSize * modelSize;
    const input = new Float32Array(planeSize * 3);
    for (let pixel = 0; pixel < planeSize; pixel++) {
      input[pixel] = rgba[pixel * 4] / 255;
      input[planeSize + pixel] = rgba[pixel * 4 + 1] / 255;
      input[planeSize * 2 + pixel] = rgba[pixel * 4 + 2] / 255;
    }

    const results = await this.session.run({ images: new ort.Tensor("float32", input, [1, 3, modelSize, modelSize]) });
    return decodeFootPose(results.output0.data as Float32Array, scale, paddingX, paddingY);
  }
}
