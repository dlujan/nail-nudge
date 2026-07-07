import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";

const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const alertEl = document.querySelector<HTMLParagraphElement>("#alert")!;
const alertSound = document.querySelector<HTMLAudioElement>("#alert-sound")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-button")!;
const sensitivitySlider =
  document.querySelector<HTMLInputElement>("#sensitivity")!;
const soundEnabledCheckbox =
  document.querySelector<HTMLInputElement>("#sound-enabled")!;

if (!video || !canvas || !statusEl || !alertEl) {
  throw new Error("Missing required DOM elements");
}

const ctx = canvas.getContext("2d")!;

if (!ctx) {
  throw new Error("Could not get canvas context");
}

let store: Awaited<ReturnType<typeof load>> | null = null;

let handLandmarker: HandLandmarker | null = null;
let faceLandmarker: FaceLandmarker | null = null;
let running = false;
let lastVideoTime = -1;
let paused = false;
let soundEnabled = true;

let loopTimer: number | null = null;
const LOOP_INTERVAL_MS = 100;

let alertTimeout: number | null = null;

let handNearMouthStartedAt: number | null = null;
let lastNotificationAt = 0;

let handNearMouthLimitMs = 2000;
let notificationCooldownMs = 10000;

async function setupCamera(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera API is not available. Check Tauri devUrl and macOS camera permissions."
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 640,
      height: 480,
    },
    audio: false,
  });

  video.srcObject = stream;

  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

async function setupStore(): Promise<void> {
  store = await load("settings.json", {
    defaults: {},
    autoSave: true,
  });
}

async function setupNotifications(): Promise<void> {
  try {
    let permissionGranted = await isPermissionGranted();

    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }

    console.log("Notifications allowed:", permissionGranted);
  } catch (error) {
    console.error("Notification permission setup failed:", error);
  }
}

async function setupHandTracking(): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

async function setupFaceTracking(): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

async function loadSettings(): Promise<void> {
  if (!store) return;

  const savedSensitivity = await store.get<number>("sensitivity");
  const sensitivity = savedSensitivity ?? 2;

  sensitivitySlider.value = sensitivity.toString();
  updateSensitivity(sensitivity);

  const savedSoundEnabled = await store!.get<boolean>("soundEnabled");

  soundEnabled = savedSoundEnabled ?? true;
  soundEnabledCheckbox.checked = soundEnabled;
}

function isFingerNearMouth(
  handLandmarks: { x: number; y: number }[],
  mouthCenter: { x: number; y: number } | null
): boolean {
  if (!mouthCenter) return false;

  const fingerTipIndexes = [4, 8, 12, 16, 20];
  const threshold = 0.09;

  return fingerTipIndexes.some((index) => {
    const point = handLandmarks[index];
    if (!point) return false;

    const dx = point.x - mouthCenter.x;
    const dy = point.y - mouthCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance < threshold;
  });
}

function playAlertSound(): void {
  if (!soundEnabled) {
    return;
  }

  alertSound.currentTime = 0;

  alertSound.play().catch((error) => {
    console.warn("Alert sound failed:", error);
  });
}

function showAlert(message: string): void {
  alertEl.textContent = message;

  if (alertTimeout !== null) {
    clearTimeout(alertTimeout);
  }

  alertTimeout = window.setTimeout(() => {
    alertEl.textContent = "";
    alertTimeout = null;
  }, 3000);
}

function getRandomString(strings: string[]): string {
  return strings[Math.floor(Math.random() * strings.length)];
}

async function notifyUser(): Promise<void> {
  try {
    let permissionGranted = await isPermissionGranted();

    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }

    if (!permissionGranted) {
      console.log("Notification permission not granted");
      return;
    }

    const message = getRandomString([
      "✋ Hands away from your mouth!",
      "🚫 Leave those fingers alone!",
      "😵 Take it easy on those nails!",
      "😢 Your nails right now.",
      "👏 Give those fingers a break!",
    ]);

    sendNotification({
      title: message,
    });
    playAlertSound();
    showAlert(message);
  } catch (error) {
    console.error("Notification failed:", error);
  }
}

function updateSensitivity(level: number): void {
  switch (level) {
    case 1:
      handNearMouthLimitMs = 4000;
      notificationCooldownMs = 20000;
      break;

    case 2:
      handNearMouthLimitMs = 2000;
      notificationCooldownMs = 10000;
      break;

    case 3:
      handNearMouthLimitMs = 750;
      notificationCooldownMs = 5000;
      break;
  }
}

function handleHandNearMouth(handNearMouth: boolean): void {
  const now = Date.now();

  if (!handNearMouth) {
    handNearMouthStartedAt = null;
    statusEl.textContent = "Watching...";
    return;
  }

  statusEl.textContent = "Hand near mouth 👀";

  if (handNearMouthStartedAt === null) {
    handNearMouthStartedAt = now;
    return;
  }

  const duration = now - handNearMouthStartedAt;
  const cooldownPassed = now - lastNotificationAt > notificationCooldownMs;

  if (duration >= handNearMouthLimitMs && cooldownPassed) {
    lastNotificationAt = now;
    void notifyUser();
  }
}

async function startWatching(): Promise<void> {
  if (running) return;

  statusEl.textContent = "Starting...";

  await setupNotifications();

  statusEl.textContent = "Starting camera...";
  await setupCamera();

  statusEl.textContent = "Loading hand tracker...";
  await setupHandTracking();

  statusEl.textContent = "Loading face tracker...";
  await setupFaceTracking();

  running = true;
  statusEl.textContent = "Watching...";

  startLoop();
}

function getMouthCenter(faceLandmarks: { x: number; y: number }[]) {
  const upperLip = faceLandmarks[13];
  const lowerLip = faceLandmarks[14];

  if (!upperLip || !lowerLip) return null;

  return {
    x: (upperLip.x + lowerLip.x) / 2,
    y: (upperLip.y + lowerLip.y) / 2,
  };
}

function startLoop(): void {
  if (loopTimer !== null) return;

  loopTimer = window.setInterval(() => {
    loop();
  }, LOOP_INTERVAL_MS);
}

function loop(): void {
  if (!running || !handLandmarker || !faceLandmarker) return;

  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return;
  }

  if (paused) {
    statusEl.textContent = "Paused";
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const now = performance.now();

    const faceResults = faceLandmarker.detectForVideo(video, now);

    const mouthCenter = faceResults.faceLandmarks?.[0]
      ? getMouthCenter(faceResults.faceLandmarks[0])
      : null;

    if (mouthCenter) {
      ctx.beginPath();
      ctx.arc(
        mouthCenter.x * canvas.width,
        mouthCenter.y * canvas.height,
        20,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    const handResults = handLandmarker.detectForVideo(video, now);
    const drawingUtils = new DrawingUtils(ctx);

    if (handResults.landmarks.length > 0) {
      let handNearMouth = false;

      for (const landmarks of handResults.landmarks) {
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS);
        drawingUtils.drawLandmarks(landmarks);

        if (isFingerNearMouth(landmarks, mouthCenter)) {
          handNearMouth = true;
        }
      }

      handleHandNearMouth(handNearMouth);
    } else {
      handleHandNearMouth(false);
      statusEl.textContent = mouthCenter
        ? "No hand detected"
        : "No face detected";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  (async () => {
    try {
      await setupStore();
      await loadSettings();
      await startWatching();
    } catch (error) {
      console.error("Auto-start failed:", error);
      statusEl.textContent = "Click Start Watching to begin.";
    }
  })();
});

pauseButton.addEventListener("click", () => {
  paused = !paused;

  handNearMouthStartedAt = null;

  statusEl.textContent = paused ? "Paused" : "Watching...";
  pauseButton.textContent = paused ? "Resume" : "Pause";
});
sensitivitySlider.addEventListener("input", async () => {
  const value = Number(sensitivitySlider.value);
  updateSensitivity(value);
  if (store) {
    await store.set("sensitivity", value);
  }
});
soundEnabledCheckbox.addEventListener("change", async () => {
  soundEnabled = soundEnabledCheckbox.checked;

  await store!.set("soundEnabled", soundEnabled);
});

listen("pause-watching", () => {
  paused = true;
  handNearMouthStartedAt = null;
  statusEl.textContent = "Paused";
});

listen("resume-watching", () => {
  paused = false;
  statusEl.textContent = "Watching...";
});
