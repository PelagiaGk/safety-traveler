"""Global GDACS API Historical Ingestion Module with Strict Reverse Geocoding."""
import sys
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta
import requests
import json
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.schemas import DisasterType, SeasonEnum

RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"
GDACS_SEARCH_URL = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH"

GDACS_TYPE_MAPPING = {
    "FL": DisasterType.FLOOD.value, "EQ": DisasterType.EARTHQUAKE.value,
    "TC": DisasterType.STORM.value, "WF": DisasterType.WILDFIRE.value,
    "DR": DisasterType.DROUGHT.value, "VO": DisasterType.EARTHQUAKE.value,
}

SAFETY_REASONS = {
    "Wildfire": "High heat index combined with sustained winds and dry vegetation.",
    "Flood": "Intense torrential rainfall leading to overwhelmed storm runoff channels.",
    "Earthquake": "Regional tectonic fault line movement.",
    "Storm": "Rapid low-pressure cyclonic front with localized gale winds.",
    "Heatwave": "Subtropical high-pressure ridge trapping extreme ambient heat.",
    "Drought": "Prolonged deficit in seasonal precipitation combined with high evaporation."
}

def determine_season(month: int) -> str:
    if month in [3, 4, 5]: return SeasonEnum.SPRING.value
    if month in [6, 7, 8]: return SeasonEnum.SUMMER.value
    if month in [9, 10, 11]: return SeasonEnum.AUTUMN.value
    return SeasonEnum.WINTER.value

def fetch_gdacs_historical(years_back: int = 5, retries: int = 3) -> list:
    normalized_events = []
    end_date = datetime.now(timezone.utc)
    
    geolocator = Nominatim(user_agent="safety-traveler-app")
    reverse_geocode = RateLimiter(geolocator.reverse, min_delay_seconds=1.2)
    
    for _ in range(years_back * 2):
        start_date = end_date - timedelta(days=180)
        params = {
            "fromdate": start_date.strftime("%Y-%m-%d"),
            "todate": end_date.strftime("%Y-%m-%d")
        }
        
        for attempt in range(retries):
            try:
                response = requests.get(GDACS_SEARCH_URL, params=params, timeout=30)
                response.raise_for_status()
                data = response.json()
                features = data.get("features", []) if isinstance(data, dict) else data

                for feature in features:
                    props = feature.get("properties", {})
                    geom = feature.get("geometry", {}).get("coordinates", [0.0, 0.0])
                    
                    lon = geom[0] if len(geom) > 0 else 0.0
                    lat = geom[1] if len(geom) > 1 else 0.0
                    
                    if lat == 0.0 and lon == 0.0:
                        continue
                        
                    try:
                        location = reverse_geocode((lat, lon), language='en', exactly_one=True)
                        if not location or not location.raw.get('address'):
                            continue
                            
                        address = location.raw['address']
                        clean_country = address.get('country')
                        
                        if not clean_country:
                            continue 
                            
                        clean_region = address.get('state', address.get('region', clean_country))
                        clean_locality = address.get('city', address.get('town', address.get('county', clean_region)))
                        
                    except Exception:
                        continue 
                        
                    event_date = datetime.fromisoformat(props.get("fromdate", datetime.now(timezone.utc).isoformat())[:19])
                    raw_type = props.get("eventtype", "Unknown")
                    disaster_type = GDACS_TYPE_MAPPING.get(raw_type, DisasterType.STORM.value)
                    
                    normalized_events.append({
                        "incident_id": f"GDACS-{props.get('eventid')}",
                        "country": clean_country,
                        "region": clean_region,
                        "locality": clean_locality,
                        "latitude": lat,
                        "longitude": lon,
                        "year": event_date.year,
                        "month": event_date.month,
                        "season": determine_season(event_date.month),
                        "disaster_type": disaster_type,
                        "primary_reason": SAFETY_REASONS.get(disaster_type, "Active meteorological alert."),
                        "static_safety_tips": ["Monitor local authorities for real-time guidance."],
                        "dynamic_precautions": ["Avoid the immediate affected perimeter."]
                    })
                break 
            except requests.exceptions.RequestException:
                time.sleep(2)
                
        end_date = start_date
        time.sleep(1) 
        
    return normalized_events

def update_dataset():
    RAW_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing_data = []
    
    if RAW_DATA_PATH.exists():
        with open(RAW_DATA_PATH, "r", encoding="utf-8") as f:
            existing_data = json.load(f)

    print("Fetching multi-year global historical data. Reverse-geocoding to enforce terrestrial accuracy...")
    new_events = fetch_gdacs_historical(years_back=5)
    existing_ids = {event["incident_id"] for event in existing_data}
    
    added_count = 0
    for event in new_events:
        if event["incident_id"] not in existing_ids:
            existing_data.append(event)
            added_count += 1

    with open(RAW_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False)
    print(f"Dataset updated. Added {added_count} hyper-accurate terrestrial events.")

if __name__ == "__main__":
    update_dataset()