import json
import tempfile
import unittest
from pathlib import Path

from tools.foot_pose.convert_cmu import convert, yolo_pose_line


class ConvertCmuToYoloPoseTest(unittest.TestCase):
    def test_skips_keypoints_that_cannot_form_a_box(self):
        self.assertIsNone(yolo_pose_line({"keypoints": [10, 20, 2] + [0, 0, 0] * 5}, 100, 50, 0.1))

    def test_converts_the_last_six_keypoints_and_builds_the_image_list(self):
        body_keypoints = [0, 0, 0] * 17
        foot_keypoints = [10, 20, 2, 20, 20, 2, 10, 30, 1, 70, 20, 2, 80, 20, 2, 80, 30, 1]
        annotations = {
            "images": [{"id": 1, "file_name": "000001.jpg", "width": 100, "height": 50}],
            "annotations": [{"image_id": 1, "keypoints": body_keypoints + foot_keypoints}],
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            annotation_path = root / "annotations.json"
            annotation_path.write_text(json.dumps(annotations))

            self.assertEqual(convert(annotation_path, root, "train2017"), (1, 1))
            label = (root / "labels/train2017/000001.txt").read_text().split()
            self.assertEqual(label[:5], ["0", "0.450000", "0.500000", "0.840000", "0.240000"])
            self.assertEqual(label[5:8], ["0.100000", "0.400000", "2.000000"])
            self.assertEqual((root / "train2017.txt").read_text(), "./images/train2017/000001.jpg\n")
            self.assertIn(f'path: "{root.resolve()}"', (root / "foot-pose.yaml").read_text())


if __name__ == "__main__":
    unittest.main()
