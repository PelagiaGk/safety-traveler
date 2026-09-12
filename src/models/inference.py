"""Inference engine executing raw spatial features with explainability and dynamic precautions."""
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

DISASTER_PRECAUTIONS = {
    "Wildfire": [
        "Clear flammable vegetation and dry debris at least 30 feet around structures.",
        "Prepare an emergency evacuation kit and closely monitor local air quality reports.",
        "Obey local burn bans and fire safety restrictions immediately."
    ],
    "Flood": [
        "Move valuable items, electronics, and important documents to upper levels.",
        "Avoid walking, swimming, or driving through moving floodwaters.",
        "Keep drainage paths clear and monitor meteorological flash-flood bulletins."
    ],
    "Storm": [
        "Secure loose outdoor objects, patio furniture, and garden equipment.",
        "Stay away from windows, glass doors, and exterior walls during high-wind events.",
        "Charge emergency communication devices and prepare for possible power outages."
    ],
    "Heatwave": [
        "Stay hydrated by drinking plenty of water throughout the day.",
        "Limit outdoor physical activity and strenuous work during peak sunlight hours.",
        "Check frequently on vulnerable neighbors, elderly residents, and pets."
    ],
    "Earthquake": [
        "Drop, Cover, and Hold On under sturdy furniture when shaking begins.",
        "Keep emergency supplies including clean water, first aid, and flashlights accessible.",
        "Inspect utility and gas lines for structural damage after tremors subside."
    ],
    "Drought": [
        "Implement strict water conservation measures for indoor and outdoor use.",
        "Comply with municipal water restrictions and rationing directives.",
        "Protect soil moisture using mulch and efficient irrigation practices."
    ]
}

class DisasterPredictor:
    def __init__(self):
        if not MODEL_PATH.exists() or not ENCODERS_PATH.exists():
            raise FileNotFoundError("Model artifacts missing. Run train.py first.")
            
        self.model = joblib.load(MODEL_PATH)
        self.encoders = joblib.load(ENCODERS_PATH)
        self.training_years_span = self.encoders.get("training_years_span", 10)
        
        self.med_threshold = self.encoders.get("threshold_medium", 0.20)
        self.high_threshold = self.encoders.get("threshold_high", 0.40)
        self.freq_lookup = self.encoders.get("historical_freq_lookup", {})

    def predict(self, region: str, season: str, month: int = None, lat: float = None, lon: float = None) -> dict:
        try:
            le_season = self.encoders["season"]
            le_disaster = self.encoders["disaster"]

            active_season = season if season in le_season.classes_ else "Summer"
            active_month = month or SEASON_MONTH_DEFAULTS.get(active_season, 7)
            active_lat = lat if lat is not None else 0.0
            active_lon = lon if lon is not None else 0.0

            season_encoded = le_season.transform([active_season])[0] if active_season in le_season.classes_ else 0
            classes = le_disaster.inverse_transform(self.model.classes_)

            results = []
            for disaster_type in classes:
                base_freq = self.freq_lookup.get((region, disaster_type), 0.05)

                x_input = pd.DataFrame([{
                    "season_encoded": season_encoded,
                    "month": active_month,
                    "latitude": active_lat,
                    "longitude": active_lon,
                    "historical_freq": base_freq
                }])

                prob = self.model.predict_proba(x_input)[0][le_disaster.transform([disaster_type])[0]]
                prob_pct = round(prob * 100, 1)
                
                if prob >= (self.med_threshold * 0.6):
                    if prob >= self.high_threshold:
                        risk_tier = "High"
                    elif prob >= self.med_threshold:
                        risk_tier = "Medium"
                    else:
                        risk_tier = "Low"

                    freq_percentage = round(base_freq * 100, 1)
                    primary_reason = (
                        f"Evaluated across {self.training_years_span} years of historical data "
                        f"with a regional baseline frequency of {freq_percentage}% for {disaster_type} during {active_season}."
                    )
                    dynamic_precautions = DISASTER_PRECAUTIONS.get(disaster_type, [
                        "Monitor local safety bulletins and regional advisories."
                    ])

                    results.append({
                        "disaster_type": disaster_type,
                        "probability_percentage": f"{prob_pct}%",
                        "risk_rating": risk_tier,
                        "years_of_data": self.training_years_span,
                        "primary_reason": primary_reason,
                        "dynamic_precautions": dynamic_precautions
                    })

            results.sort(key=lambda x: float(x["probability_percentage"].replace("%", "")), reverse=True)
            
            return {
                "region": region,
                "matched_region": region, 
                "season": active_season,
                "predictions": results
            }
        except Exception as e:
            print(f"Inference prediction error for region {region}: {e}")
            return {
                "region": region,
                "matched_region": region,
                "season": season,
                "predictions": []
            }