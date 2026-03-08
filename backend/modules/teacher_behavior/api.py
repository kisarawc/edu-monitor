import os
import joblib
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── CONFIGURABLE BOUNDARY ─────────────────────────────────────────────────────
# Pixel row that separates the stage (teacher) from the audience (students).
# Set to None initially so it requires explicit teacher adjustment.
BOUNDARY_Y = None

# ── TEACHER REGISTRATION STATE ────────────────────────────────────────────────
# Once boundary is set, we give the teacher ~3 seconds to walk to the podium
# before we automatically lock their biometric signature from Camera 1.
TEACHER_REGISTERED    = False  # Set True once biometric is captured


# ── MODEL PATH ────────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "models", "teacher_behavior_rf_model.pkl"
)


def load_model(path: str = MODEL_PATH):
    if not os.path.exists(path):
        return None
    try:
        return joblib.load(path)
    except Exception:
        return None


# ── PYDANTIC SCHEMA ───────────────────────────────────────────────────────────
# Field names match training_features.csv exactly so scikit-learn raises
# no feature-name warnings and the math aligns with the trained model.
class PoseFeatures(BaseModel):
    Mean_Hand_Speed:         float
    Max_Hand_Speed:          float
    Mean_Arm_Extension:      float
    Max_Arm_Extension:       float
    Distance_From_Boundary:  float
    Mean_Shoulder_Width:     float
    Percentage_Hands_Raised: float


class BoundaryUpdate(BaseModel):
    boundary_y: int


# ── LABEL MAPPING ─────────────────────────────────────────────────────────────
FINE_TO_COARSE = {
    "Pointing":       "LECTURING",
    "Beat (Talking)": "LECTURING",
    "Descriptive":    "LECTURING",
    "Writing":        "PASSIVE",
    "Normal":         "PASSIVE",
    "Interactive":    "INTERACTIVE",
}


# ── ENDPOINTS ─────────────────────────────────────────────────────────────────
@router.post("/predict")
async def predict(features: PoseFeatures):
    """
    Accept 7 named features, return fine-grained label + coarse dashboard label.
    """
    import pandas as pd

    clf = load_model()
    feature_cols = [
        "Mean_Hand_Speed", "Max_Hand_Speed",
        "Mean_Arm_Extension", "Max_Arm_Extension",
        "Distance_From_Boundary", "Mean_Shoulder_Width",
        "Percentage_Hands_Raised",
    ]
    df = pd.DataFrame([features.dict()])[feature_cols]

    if clf is None:
        # Heuristic fallback when no model file is present
        fine_label = "Normal"
        coarse     = "PASSIVE"
        probs      = {"PASSIVE": 1.0, "LECTURING": 0.0, "INTERACTIVE": 0.0}
        return {"fine_label": fine_label, "label": coarse,
                "probabilities": probs, "model_loaded": False}

    try:
        fine_label = str(clf.predict(df)[0])
        coarse     = FINE_TO_COARSE.get(fine_label, "PASSIVE")

        if hasattr(clf, "predict_proba"):
            proba   = clf.predict_proba(df)[0]
            classes = clf.classes_.tolist()
            fine_probs = dict(zip(classes, proba.tolist()))
        else:
            fine_probs = {fine_label: 1.0}

        return {
            "fine_label":        fine_label,
            "label":             coarse,
            "fine_probabilities": fine_probs,
            "model_loaded":      True,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/calibrate")
async def calibrate_boundary(req: BoundaryUpdate):
    """
    Hot-update the stage boundary pixel row without restarting the server.
    E.g. POST /teacher_behavior/calibrate  {"boundary_y": 650}
    """
    global BOUNDARY_Y
    BOUNDARY_Y = req.boundary_y
    return {"status": "ok", "boundary_y": BOUNDARY_Y}


@router.get("/boundary")
async def get_boundary():
    """Return the current boundary_y setting."""
    return {"boundary_y": BOUNDARY_Y}


@router.post("/reset_registration")
async def reset_registration():
    """
    Clears the biometric teacher lock and the stage boundary,
    allowing a new session or a new teacher to be registered.
    """
    global BOUNDARY_Y, TEACHER_REGISTERED
    BOUNDARY_Y = None
    TEACHER_REGISTERED = False
    return {"status": "reset", "message": "Teacher lock and boundary cleared."}

