"""Dataset expansion script for training realistic seasonal disaster models."""
import json
import random
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"

#Regional risk profiles with seasonal disaster weights
REGIONAL_PROFILES = [
    {
        "country": "Greece",
        "region": "East Macedonia and Thrace",
        "sub_region": "Evros",
        "locality": "Alexandroupoli",
        "lat": 40.8539, "lon": 25.8741,
        "patterns": {
            "Summer": [("Wildfire", 0.70), ("Heatwave", 0.20), ("Drought", 0.10)],
            "Winter": [("Flood", 0.65), ("Storm", 0.35)],
            "Autumn": [("Flood", 0.50), ("Storm", 0.40), ("Wildfire", 0.10)],
            "Spring": [("Storm", 0.50), ("Flood", 0.30), ("Earthquake", 0.20)],
        }
    },
    {
        "country": "Greece",
        "region": "Attica",
        "sub_region": "Athens",
        "locality": "Athens Center",
        "lat": 37.9838, "lon": 23.7275,
        "patterns": {
            "Summer": [("Heatwave", 0.55), ("Wildfire", 0.35), ("Drought", 0.10)],
            "Winter": [("Storm", 0.50), ("Flood", 0.40), ("Earthquake", 0.10)],
            "Autumn": [("Flood", 0.60), ("Storm", 0.40)],
            "Spring": [("Earthquake", 0.40), ("Storm", 0.40), ("Heatwave", 0.20)],
        }
    },
    {
        "country": "Greece",
        "region": "Central Macedonia",
        "sub_region": "Thessaloniki",
        "locality": "Thessaloniki Port",
        "lat": 40.6401, "lon": 22.9444,
        "patterns": {
            "Summer": [("Heatwave", 0.50), ("Wildfire", 0.30), ("Storm", 0.20)],
            "Winter": [("Flood", 0.50), ("Storm", 0.50)],
            "Autumn": [("Flood", 0.55), ("Storm", 0.45)],
            "Spring": [("Storm", 0.60), ("Flood", 0.30), ("Earthquake", 0.10)],
        }
    },
    {
        "country": "Greece",
        "region": "Crete",
        "sub_region": "Chania",
        "locality": "Chania Old Town",
        "lat": 35.5138, "lon": 24.0180,
        "patterns": {
            "Summer": [("Wildfire", 0.50), ("Drought", 0.30), ("Heatwave", 0.20)],
            "Winter": [("Storm", 0.60), ("Flood", 0.30), ("Earthquake", 0.10)],
            "Autumn": [("Storm", 0.50), ("Flood", 0.50)],
            "Spring": [("Earthquake", 0.50), ("Storm", 0.30), ("Drought", 0.20)],
        }
    }
]

MONTH_SEASON_MAP = {
    "Spring": [3, 4, 5],
    "Summer": [6, 7, 8],
    "Autumn": [9, 10, 11],
    "Winter": [12, 1, 2]
}

SAFETY_GUIDES = {
    "Wildfire": {
        "reason": "High heat index combined with sustained winds and dry vegetation.",
        "static": ["Keep emergency numbers (112) on hand.", "Prepare an evacuation bag."],
        "dynamic": ["Avoid forested rural areas during high wind warnings."]
    },
    "Flood": {
        "reason": "Intense torrential rainfall leading to overwhelmed storm runoff channels.",
        "static": ["Never drive through moving water.", "Stay informed via regional alerts."],
        "dynamic": ["Avoid basement structures and low-lying coastal roads."]
    },
    "Earthquake": {
        "reason": "Regional tectonic fault line movement.",
        "static": ["Drop, Cover, and Hold On during tremors.", "Keep clear of heavy overhead objects."],
        "dynamic": ["Identify open evacuation assembly points away from high-rises."]
    },
    "Storm": {
        "reason": "Rapid low-pressure cyclonic front with localized gale winds.",
        "static": ["Secure outdoor furniture.", "Stay indoors during peak winds."],
        "dynamic": ["Avoid maritime travel and coastal marinas."]
    },
    "Heatwave": {
        "reason": "Subtropical high-pressure ridge trapping extreme ambient heat.",
        "static": ["Stay hydrated and remain in shaded/air-conditioned zones."],
        "dynamic": ["Avoid direct sun exposure between 12:00 and 17:00."]
    },
    "Drought": {
        "reason": "Prolonged deficit in seasonal precipitation combined with high evaporation.",
        "static": ["Adhere to municipal water conservation guidelines."],
        "dynamic": ["Monitor local agricultural and municipal water restrictions."]
    }
}


def generate_dataset(num_samples: int = 1200) -> None:
    """Generates a balanced multi-year historical dataset."""
    records = []
    
    for i in range(num_samples):
        profile = random.choice(REGIONAL_PROFILES)
        season = random.choice(list(profile["patterns"].keys()))
        month = random.choice(MONTH_SEASON_MAP[season])
        year = random.randint(2012, 2024)
        
        # Select disaster type based on weighted probability
        disasters, weights = zip(*profile["patterns"][season])
        disaster_type = random.choices(disasters, weights=weights, k=1)[0]
        
        guide = SAFETY_GUIDES[disaster_type]
        
        records.append({
            "incident_id": f"HIST-{year}-{i:04d}",
            "country": profile["country"],
            "region": profile["region"],
            "sub_region": profile["sub_region"],
            "locality": profile["locality"],
            "latitude": profile["lat"] + random.uniform(-0.02, 0.02),
            "longitude": profile["lon"] + random.uniform(-0.02, 0.02),
            "year": year,
            "month": month,
            "season": season,
            "disaster_type": disaster_type,
            "primary_reason": guide["reason"],
            "static_safety_tips": guide["static"],
            "dynamic_precautions": guide["dynamic"]
        })
    
    with open(RAW_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        
    print(f"Generated {len(records)} balanced historical records into {RAW_DATA_PATH}")


if __name__ == "__main__":
    generate_dataset()