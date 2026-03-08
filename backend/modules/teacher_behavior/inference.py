import cv2
import joblib
import numpy as np
import pandas as pd
import math
from collections import deque
from ultralytics import YOLO
import os
import torch
from torchvision import transforms as T
from PIL import Image
from scipy.spatial.distance import cosine
from modules.teacher_behavior.osnet import osnet_x0_25

# ── CONFIG ────────────────────────────────────────────────────────────────────

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))

# For robustness when running from different CWDs
def get_resource_path(relative_path, base_path=BASE_DIR):
    return os.path.join(base_path, relative_path)

MODEL_PATH = os.path.join(BASE_DIR, "models", "teacher_behavior_rf_model.pkl")

# Camera sources
CAM1_SOURCE = os.path.join(BASE_DIR, "Test1.mp4")    # Front view (stage)
CAM2_SOURCE = os.path.join(BASE_DIR, "actual interactive.mp4")   # Back/aisle view

# Frames teacher must be absent from CAM1 before switching to CAM2
CAM_SWITCH_THRESHOLD = 15

# Aspect ratio filter for Camera 2 (height/width > this = standing person)
CAM2_ASPECT_RATIO_MIN = 1.5

# ── LABEL MAPPING ─────────────────────────────────────────────────────────────
FINE_TO_COARSE = {
    "Pointing":       "LECTURING",
    "Beat (Talking)": "LECTURING",
    "Descriptive":    "LECTURING",
    "Writing":        "PASSIVE",
    "Normal":         "PASSIVE",
    "Interactive":    "INTERACTIVE",
}

COARSE_COLORS = {
    "LECTURING":   (0, 255, 255),
    "INTERACTIVE": (0, 255, 0),
    "PASSIVE":     (180, 180, 180),
}

# Feature column order must match training exactly
FEATURE_COLS = [
    "Mean_Hand_Speed",
    "Max_Hand_Speed",
    "Mean_Arm_Extension",
    "Max_Arm_Extension",
    "Distance_From_Boundary",
    "Mean_Shoulder_Width",
    "Percentage_Hands_Raised",
]

# ── MODELS ────────────────────────────────────────────────────────────────────
print("Loading YOLOv8-Pose model...")
yolo_pt = "yolov8n-pose.pt"
if not os.path.exists(yolo_pt):
    # Try sibling directory or common location
    yolo_pt = os.path.join(os.path.dirname(os.path.dirname(BASE_DIR)), "yolov8n-pose.pt")
    if not os.path.exists(yolo_pt):
        yolo_pt = os.path.join(os.path.dirname(BASE_DIR), "engagement", "yolov8n-pose.pt")
    if not os.path.exists(yolo_pt):
        yolo_pt = "yolov8n-pose.pt" # Fallback to default name for auto-download
pose_model = YOLO(yolo_pt)

print("Loading OSNet Re-ID model...")
device = 'cuda' if torch.cuda.is_available() else 'cpu'
reid_extractor = osnet_x0_25(num_classes=1000, pretrained=True)
reid_extractor.eval()
reid_extractor.to(device)

# Standard ImageNet Transforms for OSNet
reid_transform = T.Compose([
    T.Resize((256, 128)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])
print(f"✅ OSNet loaded on {device}")

print(f"Loading Teacher RF Model from {MODEL_PATH}...")
try:
    rf_model = joblib.load(MODEL_PATH)
    print("✅ RF Model loaded.")
except FileNotFoundError:
    print(f"⚠️  RF Model not found at {MODEL_PATH}.")
    rf_model = None

# ── GLOBAL STATE ──────────────────────────────────────────────────────────────
current_stats = {
    "behavior":      "Initializing...",
    "fine_label":    "Unknown",
    "hand_speed":    0.0,
    "mobility":      0.0,
    "orientation":   0.0,
    "camera_source": "CAM1",
}


def get_latest_stats() -> dict:
    return current_stats


# ── MATH HELPERS ──────────────────────────────────────────────────────────────
def _dist(a, b) -> float:
    return math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)


def _midpoint(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _flush_buffers(*bufs):
    """Clear all sliding window buffers on camera switch."""
    for buf in bufs:
        buf.clear()


# ── DEEP RE-ID HELPERS ────────────────────────────────────────────────────────
def _extract_embedding(frame, box):
    """Crop the bounding box and extract 512-d OSNet feature vector."""
    x1, y1, x2, y2 = [max(0, int(v)) for v in box]
    
    # Prevent empty crops if box is out of bounds
    if x2 <= x1 or y2 <= y1 or y1 >= frame.shape[0] or x1 >= frame.shape[1]:
        return None
        
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
        
    # Convert BGR (OpenCV) to RGB (PIL)
    crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(crop_rgb)
    
    # Apply transforms and add batch dimension
    input_tensor = reid_transform(pil_img).unsqueeze(0).to(device)
    
    with torch.no_grad():
        features = reid_extractor(input_tensor)
        
    return features[0].cpu().numpy()



# ── CAMERA 2: TEACHER ISOLATION ───────────────────────────────────────────────
def _find_teacher_cam2(frame, boxes, track_ids, motion_scores: dict,
                       teacher_sig: dict) -> int:
    """
    In Camera 2, identify the teacher by combining:
    1. Appearance Cosine Similarity (Deep Re-ID)
    2. Motion score fallback for ties
    """
    if boxes is None or len(boxes) == 0 or track_ids is None or len(track_ids) == 0 or "appearance_embedding" not in teacher_sig:
        return -1

    best_idx   = -1
    best_score = -9999.0

    target_emb = teacher_sig["appearance_embedding"]

    for i, tid in enumerate(track_ids):
        # 1. Aspect Ratio Filter (Reject sitting students)
        x1, y1, x2, y2 = boxes[i]
        h = y2 - y1
        w_box = x2 - x1
        aspect_ratio = h / w_box if w_box > 0 else 0
        
        # Using a slightly relaxed ratio of 1.3 to be safe
        if aspect_ratio < 1.3:
            continue 

        # 2. Extract OSNet Deep Appearance
        candidate_emb = _extract_embedding(frame, boxes[i])
        if candidate_emb is None:
            continue
            
        # Cosine distance is 0 for identical, 1 for orthogonal, 2 for opposite
        # We convert to a similarity score where 1.0 is perfect match
        sim = 1.0 - cosine(target_emb, candidate_emb)
        print(f"[Deep Re-ID] Candidate ID {tid} -> Cosine Similarity: {sim:.4f}, AR: {aspect_ratio:.2f}")

        # 3. Reject completely if appearance is heavily mismatched
        if sim < 0.70:
            continue

        # 4. Tie-breaking Motion Score (Bounded so it never overpowers Re-ID)
        # Cap motion at 5.0 so 0.65 sim easily beats 0.60 sim regardless of motion
        motion = min(motion_scores.get(int(tid), 0.0), 5.0)
        combined = (sim * 100.0) + motion

        if combined > best_score:
            best_score = combined
            best_idx   = i

    return best_idx




# ── STREAMING INFERENCE GENERATOR ─────────────────────────────────────────────
def run_teacher_inference():
    """
    Dual-camera MJPEG streaming generator.
    State machine:
      CAM1 → (absent N frames) → CAM2 → (teacher back in CAM1) → CAM1
    """
    from modules.teacher_behavior import api as _api

    # ── Open Camera 1 ──────────────────────────────────────────────────────
    cap1 = cv2.VideoCapture(CAM1_SOURCE)
    cap2 = None  # Opened lazily when we switch

    if not cap1.isOpened():
        print(f"⚠️  Cannot open CAM1: {CAM1_SOURCE}")
        return

    # ── State ──────────────────────────────────────────────────────────────
    camera_state    = "CAM1"   # "CAM1" | "CAM2"
    absent_frames   = 0        # Frames teacher not seen in CAM1

    # Teacher unique biometric signature (captured from Camera 1 on first detection)
    # Used to match the same person in Camera 2
    teacher_sig: dict = {}     # {"bbox_ratio": h/w, "shoulder_w_norm": sw/frame_w}
    cam1_teacher_tid: int = -1 # Track ID locked in CAM1
    auto_reg_frames: int = 0   # Counter to wait for teacher to stand still before locking

    # CAM2: keyed by stable YOLO track_id
    cam2_motion: dict = {}          # {track_id: EMA velocity}
    cam2_prev_centers: dict = {}    # {track_id: (cx, cy)}
    cam2_locked_tid: int = -1       # Once locked, only track this ID
    cam2_absent_frames: int = 0     # Frames the locked teacher not seen in CAM2
    EMA_ALPHA = 0.8                 # Motion decay (lower = quicker forgetting)
    CAM2_SWITCH_BACK = 20          # Frames teacher absent in CAM2 before returning to CAM1

    # 30-frame sliding windows (shared across both cameras)
    buf_hand_speed   = deque(maxlen=30)
    buf_arm_ext      = deque(maxlen=30)
    buf_shoulder_w   = deque(maxlen=30)
    buf_hands_raised = deque(maxlen=30)
    buf_y_centers    = deque(maxlen=30)
    prev_l_wrist = prev_r_wrist = None

    prev_boundary_y = None  # Track boundary changes to flush stale buffers

    while True:
        boundary_y = _api.BOUNDARY_Y

        # If teacher moved the boundary line, flush all stale feature buffers
        if boundary_y != prev_boundary_y and prev_boundary_y is not None:
            _flush_buffers(buf_hand_speed, buf_arm_ext, buf_shoulder_w,
                           buf_hands_raised, buf_y_centers)
            prev_l_wrist = prev_r_wrist = None
        prev_boundary_y = boundary_y

        # ── Select active capture ───────────────────────────────────────────
        if camera_state == "CAM1":
            cap = cap1
        else:
            cap = cap2

        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        # ── Crop Camera 2 to top half only (video has stacked dual-cam view) ──
        if camera_state == "CAM2":
            half_h = frame.shape[0] // 2
            frame = frame[:half_h, :]

        h, w = frame.shape[:2]

        # ══════════════════════════════════════════════════════════════════
        # CAMERA 1 BRANCH
        # ══════════════════════════════════════════════════════════════════
        if camera_state == "CAM1":
            current_stats["camera_source"] = "CAM1"

            if boundary_y is None:
                cv2.putText(frame, "Please set Teacher Boundary in settings ->", (10, 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                ret, buf = cv2.imencode('.jpg', frame)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n'
                       + buf.tobytes() + b'\r\n')
                continue

            if not getattr(_api, "TEACHER_REGISTERED", False):
                cv2.line(frame, (0, boundary_y), (w, boundary_y), (0, 0, 255), 2)
                cv2.putText(frame, f"Boundary: y={boundary_y}", (10, boundary_y - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
                
                if auto_reg_frames == 0:
                    msg = "Waiting for teacher to stand at podium..."
                    color = (0, 165, 255) # Orange
                else:
                    frames_left = 15 - auto_reg_frames
                    msg = f"Teacher detected! Locking identity in: {frames_left} frames"
                    color = (0, 255, 255) # Yellow
                    
                cv2.putText(frame, msg, (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)


            # Draw boundary line
            cv2.line(frame, (0, boundary_y), (w, boundary_y), (0, 0, 255), 2)
            cv2.putText(frame, f"Boundary: y={boundary_y}", (10, boundary_y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)


            # CAM1 label
            cv2.putText(frame, "CAM 1 - FRONT", (w - 180, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 200, 255), 2)

            # YOLO tracking (persist=True gives stable IDs via ByteTrack)
            results = pose_model.track(frame, classes=[0], persist=True, verbose=False)[0]

            teacher_found = False

            if results.boxes is not None and results.keypoints is not None:
                boxes = results.boxes.xyxy.cpu().numpy()
                kpts  = results.keypoints.xy.cpu().numpy()

                for i in range(len(boxes)):
                    x1, y1, x2, y2 = boxes[i].astype(int)
                    y_center = (y1 + y2) // 2

                    if y_center > boundary_y:
                        continue  # Below boundary → student

                    tid_raw = results.boxes.id
                    tid = int(tid_raw[i].item()) if tid_raw is not None else -1
                    if tid == -1: continue

                    if not getattr(_api, "TEACHER_REGISTERED", False):
                        if cam1_teacher_tid == -1:
                            cam1_teacher_tid = tid
                        
                        if tid == cam1_teacher_tid:
                            auto_reg_frames += 1
                            if auto_reg_frames >= 15:
                                emb = _extract_embedding(frame, boxes[i])
                                if emb is not None:
                                    teacher_sig.update({"appearance_embedding": emb})
                                    _api.TEACHER_REGISTERED = True
                                    print(f"✅ Teacher auto-registered: {tid}", flush=True)
                        else:
                            auto_reg_frames = 0
                            continue
                        
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 255), 2)
                        cv2.putText(frame, f"LOCKING: {auto_reg_frames}/15", (x1, y1 - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                        teacher_found = True
                        absent_frames = 0
                        break
                    
                    else:
                        if cam1_teacher_tid == -1:
                            emb = _extract_embedding(frame, boxes[i])
                            if emb is not None:
                                sim = 1.0 - cosine(teacher_sig["appearance_embedding"], emb)
                                if sim >= 0.70:
                                    cam1_teacher_tid = tid
                                    print(f"♻️ Re-acquired teacher in CAM1 via Re-ID: {tid}", flush=True)
                        
                        if tid == cam1_teacher_tid:
                            teacher_found = True
                            absent_frames = 0
                            kp = kpts[i]

                            if len(kp) > 10:
                                L_sh, R_sh = kp[5], kp[6]   # shoulders
                                L_wr, R_wr = kp[9], kp[10]  # wrists

                                sw = _dist(L_sh, R_sh) if (L_sh[0] != 0 and R_sh[0] != 0) else 0
                                buf_shoulder_w.append(sw)

                                avg_sh_y = (L_sh[1] + R_sh[1]) / 2 if L_sh[1] != 0 else 0
                                is_raised = 0
                                if avg_sh_y != 0:
                                    is_raised = 1 if (L_wr[1] < avg_sh_y and L_wr[1] != 0) or \
                                                     (R_wr[1] < avg_sh_y and R_wr[1] != 0) else 0
                                buf_hands_raised.append(is_raised)

                                ext_l = _dist(L_sh, L_wr) if L_wr[0] != 0 else 0
                                ext_r = _dist(R_sh, R_wr) if R_wr[0] != 0 else 0
                                buf_arm_ext.append(max(ext_l, ext_r))

                                if prev_l_wrist is not None:
                                    vel_l = _dist(prev_l_wrist, L_wr) if L_wr[0] != 0 else 0
                                    vel_r = _dist(prev_r_wrist, R_wr) if R_wr[0] != 0 else 0
                                    buf_hand_speed.append(max(vel_l, vel_r))
                                else:
                                    buf_hand_speed.append(0)

                                prev_l_wrist, prev_r_wrist = L_wr, R_wr
                                buf_y_centers.append(y_center)

                            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                            cv2.putText(frame, "TEACHER", (x1, y1 - 10),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                            break  # Only track first person above boundary

            if not getattr(_api, "TEACHER_REGISTERED", False) and not teacher_found:
                # Reset countdown if person disappears before completing registration
                auto_reg_frames = 0
                cam1_teacher_tid = -1

            if not teacher_found and getattr(_api, "TEACHER_REGISTERED", False):
                absent_frames += 1
                buf_hand_speed.append(0)
                buf_arm_ext.append(0)
                buf_shoulder_w.append(0)
                buf_hands_raised.append(0)
                buf_y_centers.append(boundary_y)

                # ── Trigger handoff to Camera 2 ─────────────────────────────
                if absent_frames >= CAM_SWITCH_THRESHOLD:
                    print("📷 Teacher crossed boundary — switching to CAM2", flush=True)
                    camera_state  = "CAM2"
                    absent_frames = 0
                    cam1_teacher_tid = -1
                    cam2_motion.clear()
                    cam2_prev_centers.clear()

                cam2_locked_tid = -1
                _flush_buffers(buf_hand_speed, buf_arm_ext, buf_shoulder_w,
                               buf_hands_raised, buf_y_centers)
                prev_l_wrist = prev_r_wrist = None

                # Open Camera 2 lazily
                if cap2 is None or not cap2.isOpened():
                    cap2 = cv2.VideoCapture(CAM2_SOURCE)
                    if not cap2.isOpened():
                        print(f"⚠️  Cannot open CAM2: {CAM2_SOURCE} — staying on CAM1")
                        camera_state  = "CAM1"
                        absent_frames = 0

        # ══════════════════════════════════════════════════════════════════
        # CAMERA 2 BRANCH
        # ══════════════════════════════════════════════════════════════════
        else:
            current_stats["camera_source"] = "CAM2"

            # CAM2 label (no boundary line)
            cv2.putText(frame, "CAM 2 - BACK/AISLE", (w - 240, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (50, 255, 150), 2)

            # YOLO tracking on Camera 2
            results = pose_model.track(frame, classes=[0], persist=True, verbose=False)[0]

            teacher_found = False
            teacher_idx = -1 # Initialize teacher_idx for this scope

            if results.boxes is not None and results.keypoints is not None:
                boxes     = results.boxes.xyxy.cpu().numpy()
                kpts      = results.keypoints.xy.cpu().numpy()
                track_ids_raw = results.boxes.id
                track_ids = track_ids_raw.cpu().numpy().astype(int) if track_ids_raw is not None else list(range(len(boxes)))

                # Update EMA motion scores keyed on stable track ID
                for i, tid in enumerate(track_ids):
                    tid = int(tid)
                    x1, y1, x2, y2 = boxes[i].astype(int)
                    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                    if tid in cam2_prev_centers:
                        px, py = cam2_prev_centers[tid]
                        step_v = math.sqrt((cx - px) ** 2 + (cy - py) ** 2)
                        # EMA: new = alpha * old + (1-alpha) * step — gives recent motion priority
                        old = cam2_motion.get(tid, 0.0)
                        cam2_motion[tid] = EMA_ALPHA * old + (1 - EMA_ALPHA) * step_v
                    cam2_prev_centers[tid] = (cx, cy)

                # If we already have a locked ID for this cam, use it directly
                current_tids = [int(t) for t in track_ids]

                if cam2_locked_tid >= 0 and cam2_locked_tid in current_tids:
                    teacher_idx = current_tids.index(cam2_locked_tid)
                    cam2_absent_frames = 0  # Teacher still visible — reset counter
                elif cam2_locked_tid >= 0:
                    # Locked teacher not found this frame — increment absence counter
                    # DO NOT re-select another person — wait or switch back
                    cam2_absent_frames += 1
                    teacher_idx = -1
                else:
                    # No lock yet — run initial biometric + motion selection
                    idx = _find_teacher_cam2(frame, boxes, track_ids, cam2_motion, teacher_sig)
                    if idx >= 0:
                        cam2_locked_tid = int(track_ids[idx])
                        print(f"✅ Handoff successful: Locked onto CAM2 ID {cam2_locked_tid}", flush=True)
                        cam2_absent_frames = 0
                        teacher_idx = idx # Assign teacher_idx here

                if teacher_idx >= 0:
                    teacher_found = True
                    x1, y1, x2, y2 = boxes[teacher_idx].astype(int)
                    y_center = (y1 + y2) // 2
                    kp = kpts[teacher_idx]

                    cv2.rectangle(frame, (x1, y1), (x2, y2), (50, 255, 150), 2)
                    cv2.putText(frame, "TEACHER (CAM2)", (x1, y1 - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (50, 255, 150), 2)

                    if len(kp) > 10:
                        L_sh, R_sh = kp[5], kp[6]
                        L_wr, R_wr = kp[9], kp[10]

                        sw = _dist(L_sh, R_sh) if (L_sh[0] != 0 and R_sh[0] != 0) else 0
                        buf_shoulder_w.append(sw)

                        avg_sh_y = (L_sh[1] + R_sh[1]) / 2 if L_sh[1] != 0 else 0
                        is_raised = 0
                        if avg_sh_y != 0:
                            is_raised = 1 if (L_wr[1] < avg_sh_y and L_wr[1] != 0) or \
                                             (R_wr[1] < avg_sh_y and R_wr[1] != 0) else 0
                        buf_hands_raised.append(is_raised)

                        ext_l = _dist(L_sh, L_wr) if L_wr[0] != 0 else 0
                        ext_r = _dist(R_sh, R_wr) if R_wr[0] != 0 else 0
                        buf_arm_ext.append(max(ext_l, ext_r))

                        if prev_l_wrist is not None:
                            vel_l = _dist(prev_l_wrist, L_wr) if L_wr[0] != 0 else 0
                            vel_r = _dist(prev_r_wrist, R_wr) if R_wr[0] != 0 else 0
                            buf_hand_speed.append(max(vel_l, vel_r))
                        else:
                            buf_hand_speed.append(0)

                        prev_l_wrist, prev_r_wrist = L_wr, R_wr
                        buf_y_centers.append(y_center)

            if not teacher_found:
                cam2_absent_frames += 1  # Always count up when teacher not visible
                buf_hand_speed.append(0)
                buf_arm_ext.append(0)
                buf_shoulder_w.append(0)
                buf_hands_raised.append(0)
                if boundary_y is not None:
                    buf_y_centers.append(boundary_y)
                else:
                    buf_y_centers.append(h // 2)

            # ── Switch back to CAM1 when teacher is absent from CAM2 ────
            # Triggered either by absence counter OR by CAM1 detecting teacher
            should_return = cam2_absent_frames >= CAM2_SWITCH_BACK

            if not should_return and boundary_y is not None and cam2_absent_frames > 5:
                # Also actively probe CAM1 if teacher has been gone > 5 frames
                ok1, frame1 = cap1.read()
                if ok1:
                    probe = pose_model(frame1, classes=[0], verbose=False)[0]
                    if probe.boxes is not None:
                        for box in probe.boxes.xyxy.cpu().numpy():
                            _, y1_, _, y2_ = box.astype(int)
                            if (y1_ + y2_) // 2 < boundary_y:
                                should_return = True
                                break
                else:
                    cap1.set(cv2.CAP_PROP_POS_FRAMES, 0)

            if should_return:
                print(f"📷 Teacher left CAM2 (absent {cam2_absent_frames} frames) — switching to CAM1", flush=True)
                camera_state = "CAM1"
                cam2_absent_frames = 0
                cam2_motion.clear()
                cam2_prev_centers.clear()
                cam2_locked_tid = -1
                _flush_buffers(buf_hand_speed, buf_arm_ext,
                               buf_shoulder_w, buf_hands_raised,
                               buf_y_centers)
                prev_l_wrist = prev_r_wrist = None

        # ══════════════════════════════════════════════════════════════════
        # PREDICT (shared — runs after either camera branch)
        # ══════════════════════════════════════════════════════════════════

        # Immediately clear stale status when teacher is not in frame
        if not teacher_found:
            current_stats["behavior"] = "NOT DETECTED"

        if len(buf_hand_speed) == 30 and rf_model is not None:
            speeds  = list(buf_hand_speed)
            exts    = list(buf_arm_ext)
            sw_vals = [s for s in buf_shoulder_w if s > 0]

            mean_sw  = float(np.mean(sw_vals)) if sw_vals else 1.0
            speeds_n = [v / mean_sw for v in speeds]
            exts_n   = [v / mean_sw for v in exts]

            bnd_y = boundary_y if boundary_y is not None else (h // 2)

            live_df = pd.DataFrame([{
                "Mean_Hand_Speed":         round(float(np.mean(speeds_n)), 4),
                "Max_Hand_Speed":          round(float(np.max(speeds_n)),  4),
                "Mean_Arm_Extension":      round(float(np.mean(exts_n)),   4),
                "Max_Arm_Extension":       round(float(np.max(exts_n)),    4),
                "Distance_From_Boundary":  round(bnd_y - float(np.mean(list(buf_y_centers))), 2),
                "Mean_Shoulder_Width":     round(mean_sw, 2),
                "Percentage_Hands_Raised": round(float(np.mean(list(buf_hands_raised))), 4),
            }])[FEATURE_COLS]

            fine_label = rf_model.predict(live_df)[0]
            coarse     = FINE_TO_COARSE.get(fine_label, "PASSIVE")

            current_stats["behavior"]    = coarse
            current_stats["fine_label"]  = fine_label
            current_stats["hand_speed"]  = float(live_df["Mean_Hand_Speed"].iloc[0])
            current_stats["mobility"]    = float(live_df["Distance_From_Boundary"].iloc[0])
            current_stats["orientation"] = float(live_df["Mean_Shoulder_Width"].iloc[0])

            color = COARSE_COLORS.get(coarse, (255, 255, 255))
            cv2.putText(frame, f"{coarse}  [{fine_label}]", (10, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 2)

        ret, buf = cv2.imencode('.jpg', frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n'
               + buf.tobytes() + b'\r\n')