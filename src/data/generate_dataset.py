"""Dataset expansion script for training realistic seasonal disaster models globally."""
import json
import random
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"

REGIONAL_PROFILES = [
    #Europe
    {
        "country": "Greece", "region": "East Macedonia and Thrace", "sub_region": "Evros", "locality": "Alexandroupoli",
        "lat": 40.8539, "lon": 25.8741,
        "patterns": {
            "Summer": [("Wildfire", 0.70), ("Heatwave", 0.20), ("Drought", 0.10)],
            "Winter": [("Flood", 0.65), ("Storm", 0.35)],
            "Autumn": [("Flood", 0.50), ("Storm", 0.40), ("Wildfire", 0.10)],
            "Spring": [("Storm", 0.50), ("Flood", 0.30), ("Earthquake", 0.20)],
        }
    },
    {
        "country": "Germany", "region": "Bavaria", "sub_region": "Upper Bavaria", "locality": "Munich",
        "lat": 48.1351, "lon": 11.5820,
        "patterns": {
            "Summer": [("Heatwave", 0.40), ("Storm", 0.40), ("Flood", 0.20)],
            "Winter": [("Storm", 0.70), ("Flood", 0.30)],
            "Autumn": [("Storm", 0.60), ("Flood", 0.40)],
            "Spring": [("Flood", 0.60), ("Storm", 0.40)],
        }
    },
    #North America
    {
        "country": "USA", "region": "California", "sub_region": "Los Angeles County", "locality": "Malibu",
        "lat": 34.0259, "lon": -118.7798,
        "patterns": {
            "Summer": [("Wildfire", 0.75), ("Heatwave", 0.15), ("Drought", 0.10)],
            "Winter": [("Flood", 0.60), ("Storm", 0.30), ("Earthquake", 0.10)],
            "Autumn": [("Wildfire", 0.80), ("Drought", 0.10), ("Earthquake", 0.10)],
            "Spring": [("Earthquake", 0.60), ("Storm", 0.40)],
        }
    },
    {
        "country": "USA", "region": "Florida", "sub_region": "Miami-Dade", "locality": "Miami",
        "lat": 25.7617, "lon": -80.1918,
        "patterns": {
            "Summer": [("Storm", 0.60), ("Flood", 0.30), ("Heatwave", 0.10)],
            "Winter": [("Flood", 0.70), ("Storm", 0.30)],
            "Autumn": [("Storm", 0.80), ("Flood", 0.20)],
            "Spring": [("Storm", 0.50), ("Flood", 0.30), ("Heatwave", 0.20)],
        }
    },
    #South America
    {
        "country": "Chile", "region": "Valparaiso", "sub_region": "Valparaiso Province", "locality": "Valparaiso",
        "lat": -33.0456, "lon": -71.6204,
        "patterns": {
            "Summer": [("Wildfire", 0.50), ("Earthquake", 0.30), ("Heatwave", 0.20)],
            "Winter": [("Flood", 0.50), ("Storm", 0.30), ("Earthquake", 0.20)],
            "Autumn": [("Earthquake", 0.60), ("Storm", 0.40)],
            "Spring": [("Earthquake", 0.70), ("Flood", 0.30)],
        }
    },
    #Asia
    {
        "country": "Japan", "region": "Kanto", "sub_region": "Tokyo", "locality": "Tokyo",
        "lat": 35.6762, "lon": 139.6503,
        "patterns": {
            "Summer": [("Storm", 0.50), ("Heatwave", 0.30), ("Earthquake", 0.20)],
            "Winter": [("Earthquake", 0.60), ("Storm", 0.40)],
            "Autumn": [("Storm", 0.70), ("Flood", 0.20), ("Earthquake", 0.10)],
            "Spring": [("Earthquake", 0.50), ("Flood", 0.30), ("Storm", 0.20)],
        }
    },
    {
        "country": "India", "region": "Maharashtra", "sub_region": "Mumbai City", "locality": "Mumbai",
        "lat": 19.0760, "lon": 72.8777,
        "patterns": {
            "Summer": [("Heatwave", 0.70), ("Drought", 0.20), ("Storm", 0.10)],
            "Winter": [("Storm", 0.80), ("Flood", 0.20)],
            "Autumn": [("Flood", 0.80), ("Storm", 0.20)],
            "Spring": [("Heatwave", 0.60), ("Storm", 0.40)],
        }
    },
    #Oceania
    {
        "country": "Australia", "region": "New South Wales", "sub_region": "Sydney", "locality": "Sydney",
        "lat": -33.8688, "lon": 151.2093,
        "patterns": {
            "Summer": [("Wildfire", 0.60), ("Heatwave", 0.30), ("Drought", 0.10)],
            "Winter": [("Storm", 0.60), ("Flood", 0.40)],
            "Autumn": [("Flood", 0.50), ("Storm", 0.50)],
            "Spring": [("Wildfire", 0.40), ("Heatwave", 0.40), ("Storm", 0.20)],
        }
    },
    #Africa
    {
        "country": "South Africa", "region": "Western Cape", "sub_region": "Cape Town", "locality": "Cape Town",
        "lat": -33.9249, "lon": 18.4241,
        "patterns": {
            "Summer": [("Drought", 0.50), ("Wildfire", 0.40), ("Heatwave", 0.10)],
            "Winter": [("Storm", 0.60), ("Flood", 0.40)],
            "Autumn": [("Wildfire", 0.50), ("Drought", 0.50)],
            "Spring": [("Flood", 0.50), ("Storm", 0.50)],
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
        "static": ["Keep emergency numbers (112 / 911) on hand.", "Prepare an evacuation bag."],
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

def generate_dataset(num_samples: int = 2400) -> None:
    """Generates a balanced multi-year historical dataset with topographically distributed coordinates."""
    records = []
    
    for i in range(num_samples):
        profile = random.choice(REGIONAL_PROFILES)
        season = random.choice(list(profile["patterns"].keys()))
        month = random.choice(MONTH_SEASON_MAP[season])
        year = random.randint(2012, 2024)
        
        disasters, weights = zip(*profile["patterns"][season])
        disaster_type = random.choices(disasters, weights=weights, k=1)[0]
        
        guide = SAFETY_GUIDES[disaster_type]
        
        base_lat = profile["lat"]
        base_lon = profile["lon"]
        
        if disaster_type == "Wildfire":
            lat_offset = random.uniform(0.01, 0.05)
            lon_offset = random.uniform(0.01, 0.05)
        elif disaster_type == "Flood":
            lat_offset = random.uniform(-0.02, 0.02)
            lon_offset = random.uniform(-0.02, 0.02)
        else:
            lat_offset = random.uniform(-0.04, 0.04)
            lon_offset = random.uniform(-0.04, 0.04)

        if random.choice([True, False]): lat_offset *= -1
        if random.choice([True, False]): lon_offset *= -1

        records.append({
            "incident_id": f"HIST-{year}-{i:04d}",
            "country": profile["country"],
            "region": profile["region"],
            "sub_region": profile["sub_region"],
            "locality": profile["locality"],
            "latitude": base_lat + lat_offset,
            "longitude": base_lon + lon_offset,
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
        
    print(f"Generated {len(records)} historical records into {RAW_DATA_PATH}")

if __name__ == "__main__":
    generate_dataset()