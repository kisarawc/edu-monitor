"""
ML Insights API Routes — 3 endpoints for prescriptive attendance analytics.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.auth.dependencies import get_current_user
from models.auth.models import User

from ml.insights_engine import (
    get_overall_insights,
    get_module_insights,
    get_student_insights,
    force_retrain,
)

router = APIRouter(tags=["ML Insights"])


@router.get("/ml/overview")
async def ml_overview(
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get global ML insights across all modules.
    
    Returns factor importance, model metrics (RF vs Linear Regression),
    and actionable recommendations for educators.
    
    Query params:
        force (bool): Force model retrain if True
    """
    try:
        result = get_overall_insights(db, force_retrain=force)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML analysis failed: {str(e)}")


@router.get("/ml/module/{module_code}")
async def ml_module_insights(
    module_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get ML insights for a specific module.
    
    Returns module-specific factor importance, recommendations,
    and at-risk students with their top barrier factors.
    """
    if not module_code or not module_code.strip():
        raise HTTPException(status_code=400, detail="module_code is required")

    try:
        result = get_module_insights(db, module_code.strip())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML analysis failed: {str(e)}")


@router.get("/ml/student/{student_user_id}")
async def ml_student_insights(
    student_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get individual student's factor profile and personalized recommendations.
    
    Shows factor scores (A-F), attendance per module, and
    personalized guidance based on top barrier factors.
    """
    try:
        result = get_student_insights(db, student_user_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML analysis failed: {str(e)}")


@router.post("/ml/retrain")
async def ml_retrain(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Force retrain the ML model.
    Clears cache and retrains on next request.
    """
    force_retrain()
    # Immediately train fresh
    result = get_overall_insights(db, force_retrain=True)
    return {
        "message": "Model retrained successfully",
        "result": result,
    }
