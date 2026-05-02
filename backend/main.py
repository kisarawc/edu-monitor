import sys
import os

# Fix for Protobuf conflict (MediaPipe vs others)
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

from fastapi import FastAPI
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import performance module routes (graceful if chromadb is broken)
try:
    from modules.performance.routes import router as performance_router
except Exception as e:
    logger.warning(f"⚠️  Performance module failed to load: {e}")
    logger.warning("   - Upload, Summary, and Q&A features will be disabled")
    performance_router = None

# Teacher behavior API - CHANGED FROM models to modules
try:
    from modules.teacher_behavior.api import router as teacher_behavior_router
except Exception as e:
    logger.warning(f"⚠️  Teacher behavior router failed to load: {e}")
    teacher_behavior_router = None

# CHANGED FROM modules to models
from modules.engagement.run_inference import run_inference, LATEST_STATS, STATS_HISTORY, LATEST_GROUP_STATS, set_group_visualization


# def set_visual_style(style: str): pass
# def set_zone_boundaries(back_split: float, front_split: float): pass
from pydantic import BaseModel

# Attendance router - CHANGED FROM modules to models
from models.attendance.routes import router as attendance_router

# Auth router - CHANGED FROM modules to models
from models.auth.routes import router as auth_router
from database import engine, Base, SessionLocal
from models.auth.seeder import seed_users

# Import models so Base can see them
import models.auth.models
from modules.performance.models import LearningOutcome, Quiz, QuizQuestion, QuizResponse

# Create DB tables
Base.metadata.create_all(bind=engine)
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI(title="EduMonitor Backend", description="Classroom engagement and AI-powered lecture assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Startup event to check dependencies
@app.on_event("startup")
async def startup_event():
    """Check dependencies on startup and log their status."""
    logger.info("=" * 60)
    logger.info("EduMonitor Backend Starting")
    logger.info("=" * 60)
    
    # Check Ollama availability - CHANGED FROM modules to models
    try:
        from models.performance.llm_service import check_ollama_connection, get_available_models
        ollama_ok = check_ollama_connection()
        if ollama_ok:
            models = get_available_models()
            logger.info(f"✅ Ollama LLM is available. Models: {models}")
        else:
            logger.warning("⚠️  Ollama LLM is NOT running")
            logger.warning("   - AI Summary and Q&A features will be disabled")
            logger.warning("   - Upload and transcript storage will still work")
            logger.warning("   To enable LLM features:")
            logger.warning("   1. Install Ollama from https://ollama.com")
            logger.warning("   2. Run: ollama run llama3-it")
    except Exception as e:
        logger.warning(f"⚠️  Could not check Ollama status: {e}")
    
    logger.info("=" * 60)
    logger.info("Server ready at http://localhost:8000")
    logger.info("=" * 60)

    # Seed database
    db = SessionLocal()
    try:
        seed_users(db)
        logger.info("✅ Database seeded with default users")
    except Exception as e:
        logger.error(f"⚠️  Database seeding failed: {e}")
    finally:
        db.close()

    # Pre-load Whisper model in background thread (delayed so other components load first)
    import threading
    import time as _time
    def _preload_whisper():
        try:
            _time.sleep(15)  # Wait for server + frontend to fully initialize
            logger.info("⏳ Starting delayed Whisper model pre-load...")

            # Ensure .env vars (WHISPER_FORCE_CPU etc.) are loaded in this thread
            try:
                from dotenv import load_dotenv
                load_dotenv()
            except ImportError:
                pass

            # When force-CPU is requested, hide CUDA *before* importing whisper_stt
            # so neither PyTorch nor CTranslate2 ever initialise the CUDA runtime
            if os.environ.get("WHISPER_FORCE_CPU", "0").strip() == "1":
                os.environ["CUDA_VISIBLE_DEVICES"] = ""

            from modules.performance.whisper_stt import preload_model
            preload_model()
        except Exception as e:
            logger.warning(f"⚠️  Whisper pre-load failed (will retry on first request): {e}")
    threading.Thread(target=_preload_whisper, daemon=True).start()


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup resources on shutdown."""
    logger.info("Shutting down EduMonitor Backend...")
    try:
        from modules.performance.vector_store import close_qdrant_client
        close_qdrant_client()
    except Exception as e:
        logger.error(f"Error during Qdrant cleanup: {e}")


# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ok for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
if performance_router is not None:
    app.include_router(performance_router)


@app.get("/")
def read_root():
    return {"message": "Engagement Detection API is running"}

# Mount teacher behavior routes if available
if teacher_behavior_router is not None:
    app.include_router(teacher_behavior_router, prefix="/teacher_behavior")

# Server-side teacher behavior inference (stream + stats) - CHANGED FROM models to modules
try:
    from modules.teacher_behavior.inference import run_teacher_inference, get_latest_stats
except Exception as e:
    logger.critical(f"CRITICAL: modules.teacher_behavior.inference failed to import: {e}")
    run_teacher_inference = None
    def get_latest_stats():
        return {"behavior": "Unavailable", "mobility": 0.0, "orientation": 0.0, "hand_speed": 0.0}



from fastapi.responses import JSONResponse


@app.get('/teacher_feed')
def teacher_feed():
    if run_teacher_inference is None:
        return StreamingResponse(iter([b"" ]), media_type="multipart/x-mixed-replace; boundary=frame")
    return StreamingResponse(run_teacher_inference(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get('/api/teacher_stats')
def teacher_stats():
    return JSONResponse(content=get_latest_stats())


@app.get('/api/teacher_stats/report')
def teacher_report():
    # CHANGED FROM modules to models
    report_path = os.path.join(os.path.dirname(__file__), 'models', 'teacher_behavior', 'reports', 'teacher_behavior_report.csv')
    if os.path.exists(report_path):
        return FileResponse(report_path, media_type='text/csv', filename='teacher_behavior_report.csv')
    return JSONResponse(content={"error": "Report not found"}, status_code=404)
@app.get("/stats")
def get_stats():
    return LATEST_STATS

@app.get("/stats/history")
def get_stats_history():
    return STATS_HISTORY

@app.get("/stats/groups")
def get_stats_groups():
    return LATEST_GROUP_STATS

class VisualizeRequest(BaseModel):
    enabled: bool

@app.post("/settings/visualize-groups")
def set_visualize_groups(req: VisualizeRequest):
    set_group_visualization(req.enabled)
    return {"status": "ok", "enabled": req.enabled}

class VisualStyleRequest(BaseModel):
    style: str

@app.post("/settings/visual-style")
def set_visual_style_endpoint(req: VisualStyleRequest):
    # CHANGED FROM modules to models
    from modules.engagement.run_inference import set_visual_style
    set_visual_style(req.style)
    return {"status": "ok", "style": req.style}

class ZoneSettingsRequest(BaseModel):
    back_split: float
    front_split: float

@app.post("/settings/zones")
def set_zone_settings(req: ZoneSettingsRequest):
    # CHANGED FROM modules to models
    from modules.engagement.run_inference import set_zone_boundaries
    set_zone_boundaries(req.back_split, req.front_split)
    return {"status": "ok", "zones": {"back": req.back_split, "front": req.front_split}}

class ClassBoundaryRequest(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

@app.post("/settings/class-boundary")
def set_class_boundary_endpoint(req: ClassBoundaryRequest):
    from modules.engagement.run_inference import set_class_boundary
    set_class_boundary(req.x1, req.y1, req.x2, req.y2)
    return {"status": "ok", "boundary": {"x1": req.x1, "y1": req.y1, "x2": req.x2, "y2": req.y2}}


@app.get("/video_feed")

def video_feed():
    if run_inference is None:
        return StreamingResponse(iter([b""]), media_type="multipart/x-mixed-replace; boundary=frame")
    return StreamingResponse(
        run_inference(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# ML Insights router
try:
    from ml.routes import router as ml_router
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    print("⚠️ ML Insights module not available")

app.include_router(attendance_router, prefix="/api")
app.include_router(auth_router, prefix="/api/auth")
if ML_AVAILABLE:
    app.include_router(ml_router, prefix="/api")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)