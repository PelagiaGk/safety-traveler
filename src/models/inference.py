"""Inference engine executing raw spatial features."""
import sys
from pathlib import Path
import joblib
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

MODEL_PATH = BASE_DIR / "data" / "models" / "rf_disaster_model.joblib"
ENCODERS_PATH = BASE_DIR / "data" / "models" / "encoders.joblib"

SEASON_MONTH_DEFAULTS = {"Spring": 4, "Summer": 7, "Autumn": 10, "Winter": 1}

class DisasterPredictor:
    def __init__(self):
        if not MODEL_PATH.exists() or not ENCODERS_PATH.exists():
            raise FileNotFoundError("Model artifacts missing. Run train.py first.")
            
        self.model = joblib.load(MODEL_PATH)
        self.encoders = joblib.load(ENCODERS_PATH)
        self.training_years_span = self.encoders.get("training_years_span", 10)

    def predict(self, region: str, season: str, month: int = None, lat: float = None, lon: float = None) -> dict:
        le_season = self.encoders["season"]
        le_disaster = self.encoders["disaster"]

        active_season = season if season in le_season.classes_ else "Summer"
        active_month = month or SEASON_MONTH_DEFAULTS.get(active_season, 7)
        active_lat = lat if lat is not None else 0.0
        active_lon = lon if lon is not None else 0.0

        x_input = pd.DataFrame([{
            "season_encoded": le_season.transform([active_season])[0],
            "month": active_month,
            "latitude": active_lat,
            "longitude": active_lon
        }])

        probabilities = self.model.predict_proba(x_input)[0]
        classes = le_disaster.inverse_transform(self.model.classes_)

        results = []
        for disaster_type, prob in zip(classes, probabilities):
            prob_pct = round(prob * 100, 1)
            
            if prob_pct >= 12.0:
                risk_tier = "High" if prob_pct >= 40.0 else "Medium" if prob_pct >= 20.0 else "Low"

                results.append({
                    "disaster_type": disaster_type,
                    "probability_percentage": f"{prob_pct}%",
                    "risk_rating": risk_tier,
                    "years_of_data": self.training_years_span
                })

        results.sort(key=lambda x: float(x["probability_percentage"].replace("%", "")), reverse=True)
        
        return {
            "region": region,
            "matched_region": region, 
            "season": active_season,
            "predictions": results
        }