from fastapi import FastAPI, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
import pandas as pd
import joblib
from contextlib import asynccontextmanager
from fastapi.staticfiles import StaticFiles

from database import Base, engine, get_db
from models import User, Prediction
from dependencies import get_current_user
from routers import auth, admin

ml_model = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)      # tables auto ban jayengi
    ml_model['model'] = joblib.load('credit_risk_model.pkl')
    ml_model['threshold'] = joblib.load('best_threshold.pkl')
    yield
    ml_model.clear()

app = FastAPI(lifespan=lifespan)

app.include_router(auth.router)
app.include_router(admin.router)

class LoanApplication(BaseModel):
    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int

@app.post('/predict')
def predict(
    data: LoanApplication,
    user: User = Depends(get_current_user),     # ab login zaroori hai
    db: Session = Depends(get_db),
):
    input_dict = data.model_dump()
    input_df = pd.DataFrame([input_dict])

    probability = float(ml_model['model'].predict_proba(input_df)[:, 1][0])
    threshold = float(ml_model["threshold"])
    prediction = int(probability >= threshold)
    result = "High Risk" if prediction == 1 else "Low Risk"

    db.add(Prediction(user_id=user.id, input_data=input_dict,
                      probability=probability, result=result))
    db.commit()

    return {
        "default_probability": probability,
        "default_prediction": prediction,
        "threshold": threshold,
        "Result": result,
    }

# Hamesha sabse last me
app.mount("/", StaticFiles(directory="static", html=True), name="static")