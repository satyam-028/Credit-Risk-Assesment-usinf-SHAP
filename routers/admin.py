from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import User, Prediction
from schemas import UserOut
from dependencies import require_role

router = APIRouter(prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_role("admin"))])

@router.get("/users", response_model=list[UserOut])
def all_users(db: Session = Depends(get_db)):
    return db.query(User).all()

@router.get("/predictions")
def all_predictions(db: Session = Depends(get_db)):
    return db.query(Prediction).order_by(Prediction.created_at.desc()).limit(100).all()