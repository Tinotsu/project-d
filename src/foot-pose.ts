import * as ort from "onnxruntime-web/webgpu";

const modelSize = 640;
const outputRowSize = 24;

export type Keypoint = { x: number; y: number; confidence: number };
export type FootPose = {
  score: number;
  left: [Keypoint, Keypoint, Keypoint];
  right: [Keypoint, Keypoint, Keypoint];
};
export type InputAction = {
  type: "LEFT_ENTER_LANE" | "RIGHT_ENTER_LANE" | "LEFT_STEP" | "RIGHT_STEP" | "JUMP" | "SLIDE_LEFT" | "SLIDE_RIGHT";
  lane?: number;
  foot?: "left" | "right";
};

class FootContactState {
  private groundY?: number;
  private peakY?: number;
  private lifted = false;

  update(y: number | null): boolean {
    if (y === null) {
      this.reset();
      return false;
    }
    if (this.groundY === undefined) {
      this.groundY = y;
      return false;
    }
    if (!this.lifted && this.groundY - y > 0.02) {
      this.lifted = true;
      this.peakY = y;
      return false;
    }
    if (this.lifted) this.peakY = Math.min(this.peakY!, y);
    if (this.lifted && (y > this.groundY - 0.012 || y - this.peakY! > 0.02)) {
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
  private leftLane: number | null = null;
  private rightLane: number | null = null;
  private readonly leftContact = new FootContactState();
  private readonly rightContact = new FootContactState();
  private jumping = false;

  update(leftLane: number | null, rightLane: number | null, leftY: number | null, rightY: number | null, jumping: boolean): InputAction[] {
    const actions: InputAction[] = [];
    if (jumping && !this.jumping) actions.push({ type: "JUMP" });
    this.jumping = jumping;
    if (jumping) {
      this.leftLane = leftLane;
      this.rightLane = rightLane;
      this.leftContact.reset();
      this.rightContact.reset();
      return actions;
    }

    for (const [side, lane, previous] of [
      ["LEFT", leftLane, this.leftLane],
      ["RIGHT", rightLane, this.rightLane],
    ] as const) {
      if (lane === null || lane === previous) continue;
      actions.push({ type: `${side}_ENTER_LANE`, lane });
      if (previous !== null) {
        actions.push({ type: lane < previous ? "SLIDE_LEFT" : "SLIDE_RIGHT", lane, foot: side === "LEFT" ? "left" : "right" });
      }
    }
    if (this.leftContact.update(leftY) && leftLane !== null) actions.push({ type: "LEFT_STEP", lane: leftLane });
    if (this.rightContact.update(rightY) && rightLane !== null) actions.push({ type: "RIGHT_STEP", lane: rightLane });
    this.leftLane = leftLane;
    this.rightLane = rightLane;
    return actions;
  }

  reset(): void {
    this.leftLane = this.rightLane = null;
    this.leftContact.reset();
    this.rightContact.reset();
    this.jumping = false;
  }
}

export class JumpDetector {
  private groundLeft?: number;
  private groundRight?: number;
  private peakLeft?: number;
  private peakRight?: number;
  private jumping = false;

  update(leftY: number, rightY: number): boolean {
    if (this.groundLeft === undefined || this.groundRight === undefined) {
      this.groundLeft = leftY;
      this.groundRight = rightY;
      return false;
    }

    if (!this.jumping && this.groundLeft - leftY > 0.035 && this.groundRight - rightY > 0.035) {
      this.jumping = true;
      this.peakLeft = leftY;
      this.peakRight = rightY;
    } else if (this.jumping) {
      this.peakLeft = Math.min(this.peakLeft!, leftY);
      this.peakRight = Math.min(this.peakRight!, rightY);
      if (
        (leftY > this.groundLeft - 0.015 && rightY > this.groundRight - 0.015)
        || (leftY - this.peakLeft > 0.025 && rightY - this.peakRight > 0.025)
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
