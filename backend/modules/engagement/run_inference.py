import cv2
import numpy as np
import pandas as pd
import pickle
import time
from ultralytics import YOLO
from collections import deque, defaultdict
import threading

# Fix imports to work both as script and module
# Features are now extracted using YOLOv8-Pose directly in the inference worker



FPS = 25
WINDOW_SEC = 3
WINDOW_FRAMES = FPS * WINDOW_SEC
SKIP_POSE_FRAMES = 20
FRAME_STRIDE = 4  
SLEEP_FRAMES_THRESHOLD = 15
AWAY_FRAMES_THRESHOLD = 18
AWAY_PROB_THRESHOLD = 0.55
AWAY_EYE_DISTANCE_MAX = 0.12
ENABLE_CONTEXT_STATE = False

# Global stats shared with API
LATEST_STATS = {
    "total": 0,
    "engaged": 0,
    "off_task": 0,
    "context_dependent": 0,
    "decisive_total": 0,
    "active": 0
}
LATEST_GROUP_STATS = {
    "Front Row": {"engaged": 0, "off_task": 0, "context_dependent": 0, "decisive_total": 0, "total": 0},
    "Middle Row": {"engaged": 0, "off_task": 0, "context_dependent": 0, "decisive_total": 0, "total": 0},
    "Back Row": {"engaged": 0, "off_task": 0, "context_dependent": 0, "decisive_total": 0, "total": 0}
}
STATS_HISTORY = []
VISUALIZE_GROUPS = False
VISUAL_STYLE = "dots"  # Options: "dots", "boxes", "detailed"
ZONE_SPLITS = {"back": 0.33, "front": 0.66}
CLASS_ROI = {"x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0} # Relative to the 50% crop

STATE_ON_TASK = "on_task"
STATE_OFF_TASK = "off_task"
STATE_CONTEXT = "context_dependent"

STATE_COLORS = {
    STATE_ON_TASK: (0, 255, 0),
    STATE_OFF_TASK: (0, 0, 255),
    STATE_CONTEXT: (0, 215, 255),
}

STATE_TEXT = {
    STATE_ON_TASK: "On-Task",
    STATE_OFF_TASK: "Clearly Off-Task",
    STATE_CONTEXT: "Context-Dependent",
}

BEHAVIOR_TEXT = {
    0: "Listening",
    1: "Working",
    2: "Hand Raised",
    3: "Sleeping",
    4: "Turned Away",
}

def set_group_visualization(enabled: bool):
    global VISUALIZE_GROUPS
    VISUALIZE_GROUPS = enabled
    print(f"Group visualization set to: {VISUALIZE_GROUPS}")

def set_visual_style(style: str):
    global VISUAL_STYLE
    VISUAL_STYLE = style
    print(f"Visual style set to: {VISUAL_STYLE}")

def set_zone_boundaries(back_split: float, front_split: float):
    global ZONE_SPLITS
    ZONE_SPLITS["back"] = back_split
    ZONE_SPLITS["front"] = front_split
    print(f"Zone boundaries updated: {ZONE_SPLITS}")

def set_class_boundary(x1: float, y1: float, x2: float, y2: float):
    global CLASS_ROI
    CLASS_ROI["x1"] = min(x1, x2)
    CLASS_ROI["y1"] = min(y1, y2)
    CLASS_ROI["x2"] = max(x1, x2)
    CLASS_ROI["y2"] = max(y1, y2)
    print(f"Class boundary ROI updated: {CLASS_ROI}")


def get_engagement_state(label):
    if label in [0, 1, 2]:
        return STATE_ON_TASK
    if label == 3:
        return STATE_OFF_TASK
    if label == 4:
        return STATE_CONTEXT if ENABLE_CONTEXT_STATE else STATE_OFF_TASK
    return None


def get_behavior_text(label):
    return BEHAVIOR_TEXT.get(label, "Unknown")



import math
def calculate_angle(a, b, c):
    radians = math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(a[1] - b[1], a[0] - b[0])
    angle = np.abs(radians * 180.0 / math.pi)
    return 360 - angle if angle > 180.0 else angle

import os


def run_inference(video_path=None, show_video=False):
    print("Entered run_inference...", flush=True)
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    if video_path is None:
        video_path = os.path.join(BASE_DIR, "data", "1.mp4")

    print(f"Target Video Path: {video_path}", flush=True)

    import joblib
    model_path = os.path.join(BASE_DIR, "models", "classroom_behavior_model.pkl")
    print(f"Loading classroom behavior model from {model_path}...", flush=True)

    try:
        clf = joblib.load(model_path)
        print("Classroom behavior model loaded.", flush=True)
    except Exception as e:
        print(f"Failed to load model: {e}", flush=True)
        return

    # Load YOLOv8-Pose (aligned with training)
    yolo_pt = os.path.join(BASE_DIR, "yolov8n-pose.pt")
    if not os.path.exists(yolo_pt):
        # Fallback to absolute path in Dataset if local copy failed
        yolo_pt = r"c:\Users\chath\Desktop\Research\Dataset\yolov8n-pose.pt"
    
    print(f"Loading YOLOv8-Pose from {yolo_pt}...", flush=True)
    model = YOLO(yolo_pt)
    print("YOLOv8-Pose loaded.", flush=True)


    # Convert AVI to MP4 automatically for OpenCV compatibility
    if video_path.lower().endswith(".avi"):
        mp4_path = video_path[:-4] + ".mp4"
        tmp_mp4_path = mp4_path + ".tmp"
        if os.path.exists(mp4_path) and os.path.getsize(mp4_path) < 1024:
            try:
                os.remove(mp4_path)
            except OSError:
                pass
        if not os.path.exists(mp4_path):
            print(f"Converting {video_path} to MP4...", flush=True)
            try:
                import imageio_ffmpeg
                import subprocess
                import shutil
                exe = imageio_ffmpeg.get_ffmpeg_exe()
                try:
                    subprocess.run([exe, "-i", video_path, "-vcodec", "libx264", "-y", tmp_mp4_path],
                                   check=True, capture_output=True)
                except subprocess.CalledProcessError:
                    subprocess.run([exe, "-c:v", "hevc", "-i", video_path, "-vcodec", "libx264", "-y", tmp_mp4_path],
                                   check=True)
                if os.path.exists(tmp_mp4_path):
                    shutil.move(tmp_mp4_path, mp4_path)
                    print("Conversion complete.", flush=True)
            except Exception as e:
                print(f"Failed to convert AVI to MP4: {e}", flush=True)
                if os.path.exists(tmp_mp4_path):
                    try: os.remove(tmp_mp4_path)
                    except: pass
        if os.path.exists(mp4_path):
            video_path = mp4_path

    # ─────────────────────────────────────────────────────────────────
    # Architecture: Background inference thread + smooth main stream
    #
    # - Main thread reads video frames at native FPS and yields them
    #   with the latest cached detection overlays → smooth playback
    # - Background thread picks up the latest frame and runs YOLO
    #   inference, updating the cached detections when done
    # ─────────────────────────────────────────────────────────────────

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error opening video {video_path}", flush=True)
        return

    native_fps = cap.get(cv2.CAP_PROP_FPS)
    if native_fps <= 0:
        native_fps = 25
    frame_delay = 1.0 / native_fps

    print(f"Video FPS: {native_fps}, frame delay: {frame_delay:.4f}s", flush=True)

    # Shared state between threads (protected by lock)
    lock = threading.Lock()
    shared = {
        "latest_frame": None,         # latest frame for inference thread to pick up
        "last_detections": [],        # cached detection overlays
        "detections_cache": {},       # dictionary mapping frame_count to detections
        "frame_count": 0,
        "running": True,
    }

    prediction_history = defaultdict(lambda: deque(maxlen=20)) # Increased to 20 frames (~1.5s) for high stability


    engagement_state = {}
    pose_cache = {}

    LATEST_STATS.update({
        "total": 0,
        "engaged": 0,
        "off_task": 0,
        "context_dependent": 0,
        "decisive_total": 0,
        "active": 0
    })
    for key in LATEST_GROUP_STATS:
        LATEST_GROUP_STATS[key] = {
            "engaged": 0,
            "off_task": 0,
            "context_dependent": 0,
            "decisive_total": 0,
            "total": 0
        }

    # ─── Background Inference Thread ──────────────────────────────
    def inference_worker():
        infer_count = 0
        while shared["running"]:
            # Grab the latest frame
            with lock:
                frame = shared["latest_frame"]
                current_frame_idx = shared["frame_count"]
                if frame is None:
                    pass
            
            if frame is None:
                time.sleep(0.01)
                continue

            infer_count += 1
            h, w = frame.shape[:2]
            y_back_limit = h * ZONE_SPLITS["back"]
            y_front_limit = h * ZONE_SPLITS["front"]

            # Run YOLOv8-Pose tracking with optimized settings
            try:
                results = model.track(frame, device=0, verbose=False,
                                      persist=True, conf=0.05, imgsz=1280) # Lower conf and higher imgsz
            except Exception as e:

                print(f"[WARN] YOLO tracking failed: {e}", flush=True)
                time.sleep(0.1)
                continue

            frame_res = results[0]
            new_detections = []

            if frame_res.boxes is not None and frame_res.boxes.id is not None:
                ids = frame_res.boxes.id.cpu().numpy().astype(int)
                boxes = frame_res.boxes.xyxy.cpu().numpy()
                kpts = frame_res.keypoints.xy.cpu().numpy() if frame_res.keypoints is not None else None

                # Re-enable NMS to eliminate duplicate detections
                try:
                    from .tracking_utils import non_max_suppression_fast
                except ImportError:
                    from tracking_utils import non_max_suppression_fast
                
                boxes, ids, pick_indices = non_max_suppression_fast(boxes, ids, overlapThresh=0.45)
                if kpts is not None:
                    kpts = kpts[pick_indices]


                batch_features = []

                batch_tids = []
                batch_boxes = []

                for i, (x1, y1, x2, y2) in enumerate(boxes):
                    # ROI Filtering: Only process detections within the defined class boundary
                    # Coordinates are relative to the 50% crop
                    cx = (x1 + x2) / 2.0 / w
                    cy = (y1 + y2) / 2.0 / h
                    
                    if not (CLASS_ROI["x1"] <= cx <= CLASS_ROI["x2"] and 
                            CLASS_ROI["y1"] <= cy <= CLASS_ROI["y2"]):
                        continue

                    tid = ids[i]

                    x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
                    
                    bbox_width = x2 - x1
                    bbox_height = y2 - y1
                    
                    if kpts is not None and i < len(kpts):
                        p_kpts = kpts[i] # 17 keypoints from YOLOv8-Pose
                        if len(p_kpts) < 13: continue
                        
                        nose = p_kpts[0]
                        l_eye, r_eye = p_kpts[1], p_kpts[2]
                        ls, rs = p_kpts[5], p_kpts[6]
                        lw, rw = p_kpts[9], p_kpts[10]
                        lh, rh = p_kpts[11], p_kpts[12]

                        if np.all(ls == 0) or np.all(rs == 0): continue
                            
                        mid_sh = ((ls[0]+rs[0])/2, (ls[1]+rs[1])/2)
                        
                        if not np.all(lh == 0) and not np.all(rh == 0):
                            mid_hip = ((lh[0]+rh[0])/2, (lh[1]+rh[1])/2)
                            torso_angle = calculate_angle(mid_sh, mid_hip, (mid_hip[0] + 100, mid_hip[1]))
                        else:
                            torso_angle = 90.0
                        
                        shoulder_width = math.dist(ls, rs)
                        shoulder_ratio = shoulder_width / bbox_width if bbox_width > 0 else 0
                        
                        l_wrist_elev = (ls[1] - lw[1]) / bbox_height if not np.all(lw == 0) and bbox_height > 0 else -1.0
                        r_wrist_elev = (rs[1] - rw[1]) / bbox_height if not np.all(rw == 0) and bbox_height > 0 else -1.0
                        max_wrist_elevation = max(l_wrist_elev, r_wrist_elev)

                        bbox_aspect_ratio = bbox_width / bbox_height if bbox_height > 0 else 0
                        head_drop = (mid_sh[1] - nose[1]) / bbox_height if not np.all(nose == 0) and bbox_height > 0 else 0 

                        delta_y, delta_x = abs(rs[1] - ls[1]), abs(rs[0] - ls[0])
                        shoulder_tilt = math.degrees(math.atan2(delta_y, delta_x)) if delta_x != 0 else 90

                        # Wrist to Nose
                        if not np.all(nose == 0):
                            l_wn = math.dist(lw, nose) if not np.all(lw == 0) else 9999
                            r_wn = math.dist(rw, nose) if not np.all(rw == 0) else 9999
                            wrist_to_nose = min(l_wn, r_wn) / bbox_height if bbox_height > 0 else 0
                            if wrist_to_nose > 10: wrist_to_nose = 1.0
                        else:
                            wrist_to_nose = 0.0
                            
                        # Wrist distance
                        if not np.all(lw == 0) and not np.all(rw == 0):
                            wrist_distance = math.dist(lw, rw) / bbox_width if bbox_width > 0 else 0
                        else:
                            wrist_distance = 1.0
                            
                        # Eye distance
                        if not np.all(l_eye == 0) and not np.all(r_eye == 0):
                            eye_distance = math.dist(l_eye, r_eye) / bbox_width if bbox_width > 0 else 0
                        else:
                            eye_distance = 0.0
                        
                        batch_features.append(
                            [torso_angle, shoulder_ratio, max_wrist_elevation, bbox_aspect_ratio,
                             head_drop, shoulder_tilt, wrist_to_nose, wrist_distance, eye_distance]
                        )
                        batch_tids.append(tid)

                    batch_boxes.append((x1, y1, x2, y2, tid))


                # Batched Prediction
                if batch_features:
                    X_in = pd.DataFrame(
                        batch_features,
                        columns=['torso_angle', 'shoulder_ratio', 'max_wrist_elevation', 'bbox_aspect_ratio',
                                 'head_drop', 'shoulder_tilt', 'wrist_to_nose', 'wrist_distance', 'eye_distance']
                    )
                    try:
                        # The deployed classifier returns class probabilities for the behavior labels.
                        all_probs = clf.predict_proba(X_in) 
                        
                        for i, tid in enumerate(batch_tids):
                            current_probs = all_probs[i]
                            
                            # Probabilities for specific classes: 
                            # 0: Listening, 1: Working, 2: Hand Raised, 3: Sleeping, 4: Turned Away
                            p0, p1, p2, p3, p4 = current_probs[0], current_probs[1], current_probs[2], current_probs[3], current_probs[4]
                            
                            # 2. Hand Raised Exception (Explicit heuristic check)
                            current_feat = batch_features[i]
                            wrist_elev = current_feat[2] # max_wrist_elevation
                            eye_distance = current_feat[8]
                            is_hand_raised = (wrist_elev > 0.10) 
                            
                            # 3. Determine framing label for this frame
                            if is_hand_raised:
                                frame_label = 2 # Hand Raised
                            else:
                                raw_pred = int(np.argmax(current_probs))
                                frame_label = raw_pred # 1:1 mapping now (0, 1, 2, 3, 4)
                                
                            # 4. Temporal Filter (60% Off-Task Threshold)
                            prediction_history[tid].append(frame_label)
                            
                            counts = np.bincount(prediction_history[tid], minlength=5)
                            
                            # Make "turned away" stricter than sleeping so mild side-looking does not
                            # immediately become a yellow context label during the presentation.
                            strong_away_evidence = (
                                counts[4] >= AWAY_FRAMES_THRESHOLD and
                                p4 >= AWAY_PROB_THRESHOLD and
                                eye_distance <= AWAY_EYE_DISTANCE_MAX
                            )

                            if counts[3] >= SLEEP_FRAMES_THRESHOLD:
                                final_pred = 3
                            elif strong_away_evidence:
                                final_pred = 4
                            else:
                                # Default to On-Task majority if not enough off-task frames
                                final_pred = 0 if counts[0] > counts[1] else 1


                            engagement_state[tid] = (final_pred, float(np.max(current_probs)))



                    except Exception as e:
                        print(f"Batch prediction error: {e}")

                # Prepare Visualization Data
                for (x1, y1, x2, y2, tid) in batch_boxes:
                    label, score = engagement_state.get(tid, (None, 0.0))
                    color = (0, 255, 255)
                    text = ""
                    state = get_engagement_state(label)
                    if state is not None:
                        color = STATE_COLORS[state]
                        behavior_text = get_behavior_text(label)
                        if state == STATE_OFF_TASK:
                            text = ""
                        elif state == STATE_CONTEXT:
                            text = ""
                        else:
                            text = ""
                    if len(prediction_history[tid]) < 2:
                        text = ""
                        color = (0, 255, 255)
                        state = None

                    new_detections.append({
                        "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                        "color": color, "text": text, "state": state
                    })

            # Update shared detections atomically
            with lock:
                shared["last_detections"] = new_detections
                shared["detections_cache"][current_frame_idx] = new_detections
                
                # clean up old cache entries to prevent memory leak
                keys = list(shared["detections_cache"].keys())
                for k in keys:
                    if k < current_frame_idx - 150: # keep last ~6 seconds
                        del shared["detections_cache"][k]

            # Update global stats
            on_task_count = sum(1 for d in new_detections if d.get("state") == STATE_ON_TASK)
            off_task_count = sum(1 for d in new_detections if d.get("state") == STATE_OFF_TASK)
            context_count = sum(1 for d in new_detections if d.get("state") == STATE_CONTEXT)
            decisive_total = on_task_count + off_task_count
            total_active = len(new_detections)
            
            # Behavior specific counts for historical tracking
            behavior_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
            for tid, (label, score) in engagement_state.items():
                if label in behavior_counts:
                    behavior_counts[label] += 1

            group_counts = {
                "Front Row": {"engaged": 0, "off_task": 0, "context_dependent": 0, "decisive_total": 0, "total": 0},
                "Middle Row": {"engaged": 0, "off_task": 0, "context_dependent": 0, "decisive_total": 0, "total": 0},
                "Back Row": {"engaged": 0, "off_task": 0, "context_dependent": 0, "decisive_total": 0, "total": 0}
            }
            for d in new_detections:
                cy = (d["y1"] + d["y2"]) / 2.0
                det_state = d.get("state")
                if cy < y_back_limit:
                    group = "Back Row"
                elif cy < y_front_limit:
                    group = "Middle Row"
                else:
                    group = "Front Row"
                group_counts[group]["total"] += 1
                if det_state == STATE_ON_TASK:
                    group_counts[group]["engaged"] += 1
                elif det_state == STATE_OFF_TASK:
                    group_counts[group]["off_task"] += 1
                elif det_state == STATE_CONTEXT:
                    group_counts[group]["context_dependent"] += 1
            for group in group_counts.values():
                group["decisive_total"] = group["engaged"] + group["off_task"]
            for key in LATEST_GROUP_STATS:
                LATEST_GROUP_STATS[key] = group_counts[key]
            LATEST_STATS["total"] = total_active
            LATEST_STATS["engaged"] = on_task_count
            LATEST_STATS["off_task"] = off_task_count
            LATEST_STATS["context_dependent"] = context_count
            LATEST_STATS["decisive_total"] = decisive_total
            LATEST_STATS["active"] = total_active
            if infer_count % 5 == 0:
                STATS_HISTORY.append({
                    "timestamp": time.time(),
                    "engaged": on_task_count, "total": total_active,
                    "off_task": off_task_count,
                    "context_dependent": context_count,
                    "decisive_total": decisive_total,
                    "listening": behavior_counts[0],
                    "working": behavior_counts[1],
                    "hand_raised": behavior_counts[2],
                    "sleeping": behavior_counts[3],
                    "away": behavior_counts[4],
                    "front_engaged": group_counts["Front Row"]["engaged"],
                    "front_off_task": group_counts["Front Row"]["off_task"],
                    "front_context": group_counts["Front Row"]["context_dependent"],
                    "front_decisive_total": group_counts["Front Row"]["decisive_total"],
                    "front_total": group_counts["Front Row"]["total"],
                    "mid_engaged": group_counts["Middle Row"]["engaged"],
                    "mid_off_task": group_counts["Middle Row"]["off_task"],
                    "mid_context": group_counts["Middle Row"]["context_dependent"],
                    "mid_decisive_total": group_counts["Middle Row"]["decisive_total"],
                    "mid_total": group_counts["Middle Row"]["total"],
                    "back_engaged": group_counts["Back Row"]["engaged"],
                    "back_off_task": group_counts["Back Row"]["off_task"],
                    "back_context": group_counts["Back Row"]["context_dependent"],
                    "back_decisive_total": group_counts["Back Row"]["decisive_total"],
                    "back_total": group_counts["Back Row"]["total"]
                })


    # Start background inference thread
    infer_thread = threading.Thread(target=inference_worker, daemon=True)
    infer_thread.start()
    print("Background inference thread started.", flush=True)

    # ─── Main stream loop: yield frames at native FPS ─────────────
    print("Starting video stream...")
    frame_count = 0

    while True:
        t_frame_start = time.time()

        ret, frame = cap.read()
        if not ret or frame is None:
            # Loop video
            print("Video loop restarting...", flush=True)
            cap.release()
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                break
            ret, frame = cap.read()
            if not ret or frame is None:
                break

        h, w = frame.shape[:2]

        # 50% Vertical Crop (top half only)
        mid_y = h // 2
        frame = frame[:mid_y, :]
        h, w = frame.shape[:2]

        # Resize to 960px width for display
        target_w = 960
        if w > target_w:
            scale = target_w / w
            new_h = int(h * scale)
            frame = cv2.resize(frame, (target_w, new_h))
            h, w = frame.shape[:2]

        frame_count += 1

        # Feed frame to inference thread (every FRAME_STRIDE frames)
        if frame_count % FRAME_STRIDE == 0:
            with lock:
                shared["latest_frame"] = frame.copy()
                shared["frame_count"] = frame_count

        if 'display_queue' not in locals():
            from collections import deque
            display_queue = deque(maxlen=30)  # ~1.2s delay to allow inference to complete

        display_queue.append((frame_count, frame))

        # Delay playback until buffer is full so inference has time to catch up
        if len(display_queue) < 25: 
            elapsed = time.time() - t_frame_start
            if (frame_delay - elapsed) > 0:
                time.sleep(frame_delay - elapsed)
            continue

        out_frame_count, frame = display_queue.popleft()

        # Get cached detections matched closely to out_frame_count
        with lock:
            cache_keys = [k for k in shared["detections_cache"].keys() if k <= out_frame_count]
            if cache_keys:
                closest_idx = max(cache_keys)
                last_detections = shared["detections_cache"][closest_idx]
            else:
                last_detections = list(shared["last_detections"])

        # Zone limits for drawing
        y_back_limit = h * ZONE_SPLITS["back"]
        y_front_limit = h * ZONE_SPLITS["front"]

        # Draw overlays
        if VISUALIZE_GROUPS:
            cv2.line(frame, (0, int(y_back_limit)), (w, int(y_back_limit)), (255, 0, 255), 2)
            cv2.line(frame, (0, int(y_front_limit)), (w, int(y_front_limit)), (255, 255, 0), 2)
            cv2.putText(frame, "BACK ROW", (10, int(y_back_limit) - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
            cv2.putText(frame, "MIDDLE ROW", (10, int(y_front_limit) - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
            cv2.putText(frame, "FRONT ROW", (10, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
            
            # ROI boundary visualization
            rx1, ry1 = int(CLASS_ROI["x1"] * w), int(CLASS_ROI["y1"] * h)
            rx2, ry2 = int(CLASS_ROI["x2"] * w), int(CLASS_ROI["y2"] * h)
            cv2.rectangle(frame, (rx1, ry1), (rx2, ry2), (0, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(frame, "CLASS ROI", (rx1 + 5, ry1 + 20), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)

        # Legend (Top Bar)
        overlay = frame.copy()
        # Combined Legend (Compact)
        cv2.rectangle(overlay, (0, 0), (w, 32), (20, 20, 20), -1) 
        frame = cv2.addWeighted(overlay, 0.7, frame, 0.3, 0)
        
        # On-Task Indicator
        cv2.circle(frame, (20, 16), 5, (0, 255, 0), -1)
        cv2.putText(frame, "On-Task", (35, 21), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

        if ENABLE_CONTEXT_STATE:
            cv2.circle(frame, (120, 16), 5, (0, 215, 255), -1)
            cv2.putText(frame, "Context", (135, 21),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.circle(frame, (220, 16), 5, (0, 0, 255), -1)
            cv2.putText(frame, "Off-Task", (235, 21), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        else:
            cv2.circle(frame, (120, 16), 5, (0, 0, 255), -1)
            cv2.putText(frame, "Off-Task", (135, 21), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

        


        for det in last_detections:

            x1 = det["x1"]; y1 = det["y1"]
            x2 = det["x2"]; y2 = det["y2"]
            color = det["color"]
            text = det["text"]
            state = det.get("state")
            cx = int((x1 + x2) / 2)
            cy_body = (y1 + y2) / 2.0
            
            if VISUALIZE_GROUPS:
                if cy_body < y_back_limit:
                    color = (255, 0, 255) # Magenta for Back Row
                elif cy_body < y_front_limit:
                    color = (255, 255, 0) # Cyan for Middle Row
                else:
                    color = (0, 165, 255) # Orange for Front Row

            cy_head = y1 + 15
            label_y = max(y1 - 10, 20)

            if VISUAL_STYLE == "boxes":
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                if state == STATE_OFF_TASK and text:
                    cv2.putText(frame, text, (x1, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
            elif VISUAL_STYLE == "detailed":
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(frame, text, (x1, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
            else:
                cv2.circle(frame, (cx, cy_head), 8, color, -1)
                cv2.circle(frame, (cx, cy_head), 8, (0, 0, 0), 1)
                if state == STATE_OFF_TASK and text:
                    cv2.putText(frame, text, (x1, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 2)

        if show_video:
            cv2.imshow("Engagement Analysis", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        # Encode and yield
        ret_enc, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ret_enc:
            continue

        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

        # Pace the stream to ~native FPS
        elapsed = time.time() - t_frame_start
        sleep_time = frame_delay - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)

    shared["running"] = False
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    print("Running in standalone mode...", flush=True)
    for _ in run_inference(video_path=None, show_video=True):
        pass
