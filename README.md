# Project D

A browser rhythm-game MVP inspired by DanceRush. A custom YOLO Pose model tracks each foot's big toe, small toe, and heel, then maps them onto a calibrated four-lane floor for scoring. The app includes gameplay, results, a level editor, and public level sharing.

Built with React, TypeScript, Three.js, Web Audio, and ONNX Runtime Web. Cloudflare Workers runs the API, Better Auth handles accounts, D1 stores accounts and levels, and R2 stores uploaded audio.

## Run locally

Requirements: Node.js 22.12+ and a browser with camera access. Python 3 is needed only for the converter and its tests.

```bash
npm install
cp .dev.vars.example .dev.vars
```

Set `BETTER_AUTH_SECRET` to at least 32 random characters in `.dev.vars`, then run:

```bash
npm run dev
```

Open the localhost URL printed by Vite. The command applies local D1 migrations automatically; the Worker API runs alongside Vite. Camera access requires localhost or HTTPS. The pose model is bundled and runs in the browser.

Local state is stored under `.wrangler/` and ignored by Git. Password-reset emails are [simulated locally](https://developers.cloudflare.com/email-service/local-development/sending/): follow the reset URL logged in the terminal.

## Play

1. Click **Play**, then **Start camera** and allow camera access.
2. Keep your lower legs, both feet, and the play floor in view.
3. Click the floor corners in order: **A** far left, **B** far right, **C** near right, **D** near left.
4. Click **Continue to level**.

The camera view is mirrored automatically. Click **Recalibrate** whenever the camera or play area moves. Calibration maps the floor to normalized coordinates; feet outside it have no lane. Missing or low-confidence detections also display `—`.

The bundled **Second Heaven** test chart runs silently because no recording is distributed.

## Create and share levels

Log in or create an account, then choose **Create a level**. Upload music, edit notes and timing, and use **Test level** to preview the playfield or **Play level** to try it with the camera. Changes autosave; **Save** also saves immediately.

New levels are private. **Publish** makes a level and its audio playable through **Public levels** without logging in. Owners can edit, delete, or make their levels private again.

The bundled data is split between [song metadata](public/levels/second-heaven/song.json) and the [test chart](public/levels/second-heaven/test.json). Note times are seconds from the start of the audio; playback uses the Web Audio clock, with a silent timer when audio is absent.

## Development

```bash
npm run test:all  # TypeScript and Python tests
npm run typecheck # Worker bindings and TypeScript
npm run build     # Typecheck and production build
```

- `src/app`: startup, routes, and navigation.
- `src/features`: camera, gameplay, editor, accounts, level library, and diagnostic screens.
- `src/domain`: chart types, calibration, note geometry, and deterministic scoring.
- `src/infrastructure` and `src/rendering`: audio/pose adapters and the Three.js playfield.
- `src/shared` and `src/styles`: reusable UI and styles.
- `worker` and `migrations`: authentication, level/audio APIs, and D1 schema.

## Cloudflare deployment

Authenticate and create the storage resources in your Cloudflare account:

```bash
npx wrangler login
npx wrangler d1 create project-d
npx wrangler r2 bucket create project-d-level-audio
```

Add the returned D1 `database_id` to the existing `DB` binding in [wrangler.jsonc](wrangler.jsonc) before applying remote migrations. Onboard a sender domain in [Cloudflare Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/), then configure the secrets and deploy:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put AUTH_EMAIL_FROM
npm run db:migrate:remote
npm run deploy
```

Use at least 32 random characters for `BETTER_AUTH_SECRET` and an address on the onboarded domain for `AUTH_EMAIL_FROM`.

## Optional: train the foot model

Download the [CMU foot annotations and corresponding COCO 2017 images](https://cmu-perceptual-computing-lab.github.io/foot_keypoint_dataset/). Place the images under `/path/to/foot-pose/images/train2017/` and `images/val2017/`, then convert both annotation splits:

```bash
python3 tools/foot_pose/convert_cmu.py person_keypoints_train2017_foot_v1.json /path/to/foot-pose train2017
python3 tools/foot_pose/convert_cmu.py person_keypoints_val2017_foot_v1.json /path/to/foot-pose val2017
```

The converter writes labels, image lists, and `foot-pose.yaml`. Train and export with Ultralytics:

```bash
python3 -m pip install ultralytics==8.4.98
yolo pose train data=/path/to/foot-pose/foot-pose.yaml model=yolo26n-pose.pt epochs=100 imgsz=640 batch=16 seed=0 deterministic=True
yolo export model=runs/pose/train/weights/best.pt format=onnx imgsz=640 simplify=True
```

Replace `public/models/foot-pose.onnx` with the export. Tracking accuracy depends on visibility, footwear, lighting, and camera angle.

## License

Project D declares `AGPL-3.0-only` in [package.json](package.json). CMU foot annotations are separately licensed under CC BY 4.0; COCO images retain their respective owners' copyrights. COCO images and the Second Heaven recording are not distributed here.
