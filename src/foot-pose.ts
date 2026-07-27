import * as ort from "onnxruntime-web/webgpu";

const modelSize = 640;
const outputRowSize = 24;

export type Keypoint = { x: number; y: number; confidence: number };
export type FootPose = {
  score: number;
  left: [Keypoint, Keypoint, Keypoint];
  right: [Keypoint, Keypoint, Keypoint];
};
export type InputFrame = {
  capturedAt: DOMHighResTimeStamp;
  leftLane?: number | null;
  rightLane?: number | null;
  leftPoints: number[] | null;
  rightPoints: number[] | null;
};

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
    this.context.fillStyle = "#929292";
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
