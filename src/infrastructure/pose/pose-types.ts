export type Keypoint = {
  x: number;
  y: number;
  confidence: number;
};

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
