#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def yolo_pose_line(annotation: dict, width: int, height: int, padding: float) -> str | None:
    keypoints = annotation["keypoints"][-18:]
    if len(keypoints) != 18:
        raise ValueError("CMU annotation must contain six foot keypoints")

    visible = [(keypoints[i], keypoints[i + 1]) for i in range(0, 18, 3) if keypoints[i + 2] > 0]
    if not visible:
        return None

    xs, ys = zip(*visible)
    if min(xs) == max(xs) or min(ys) == max(ys):
        return None
    x_pad = (max(xs) - min(xs)) * padding
    y_pad = (max(ys) - min(ys)) * padding
    xmin, xmax = max(0, min(xs) - x_pad), min(width, max(xs) + x_pad)
    ymin, ymax = max(0, min(ys) - y_pad), min(height, max(ys) + y_pad)
    box = [(xmin + xmax) / 2 / width, (ymin + ymax) / 2 / height, (xmax - xmin) / width, (ymax - ymin) / height]
    points = [value for i in range(0, 18, 3) for value in (keypoints[i] / width, keypoints[i + 1] / height, keypoints[i + 2])]
    return " ".join(["0", *(f"{value:.6f}" for value in box + points)])


def convert(annotation_path: Path, dataset_root: Path, split: str, padding: float = 0.1) -> tuple[int, int]:
    data = json.loads(annotation_path.read_text())
    images = {image["id"]: image for image in data["images"]}
    labels: dict[str, list[str]] = defaultdict(list)

    for annotation in data["annotations"]:
        image = images[annotation["image_id"]]
        line = yolo_pose_line(annotation, image["width"], image["height"], padding)
        if line:
            labels[image["file_name"]].append(line)

    label_dir = dataset_root / "labels" / split
    label_dir.mkdir(parents=True, exist_ok=True)
    for file_name, lines in labels.items():
        (label_dir / Path(file_name).with_suffix(".txt").name).write_text("\n".join(lines) + "\n")
    (dataset_root / f"{split}.txt").write_text(
        "\n".join(f"./images/{split}/{file_name}" for file_name in labels) + "\n"
    )
    config = (Path(__file__).parents[1] / "training/foot-pose.yaml").read_text()
    (dataset_root / "foot-pose.yaml").write_text(config.replace("path: .", f"path: {json.dumps(str(dataset_root.resolve()))}"))
    return len(labels), sum(map(len, labels.values()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert CMU foot keypoints to Ultralytics YOLO Pose labels")
    parser.add_argument("annotations", type=Path)
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("split", choices=("train2017", "val2017"))
    parser.add_argument("--padding", type=float, default=0.1, help="box padding per side (default: 0.1)")
    args = parser.parse_args()
    image_count, pose_count = convert(args.annotations, args.dataset_root, args.split, args.padding)
    print(f"Wrote {pose_count} poses across {image_count} images")
