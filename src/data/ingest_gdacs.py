"""GDACS API Ingestion Module with Multi-Country Parsing."""
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
import requests
import json

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.schemas import DisasterType, SeasonEnum

RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"
GDACS_SEARCH_URL = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH"

GDACS_TYPE_MAPPING = {
    "FL": DisasterType.FLOOD.value,
    "EQ": DisasterType.EARTHQUAKE.value,
    "TC": DisasterType.STORM.value,
    "WF": DisasterType.WILDFIRE.value,
    "DR": DisasterType.DROUGHT.value,
    "VO": DisasterType.EARTHQUAKE.value,
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

def geocode_country(country_name: str) -> tuple:
    """Fetches coordinates for a country to split multi-country alerts."""
    url = f"https://nominatim.openstreetmap.org/search?country={country_name}&format=json"
    try:
        r = requests.get(url, headers={'User-Agent': 'SafetyTraveler/1.0'}, timeout=5)
        if r.status_code == 200 and len(r.json()) > 0:
            return float(r.json()[0]['lat']), float(r.json()[0]['lon'])
    except Exception:
        pass
    return None, None

def fetch_gdacs_events(retries: int = 3, delay: int = 2) -> list:
    for attempt in range(retries):
        try:
            response = requests.get(GDACS_SEARCH_URL, timeout=30)
            response.raise_for_status()
            data = response.json()
            features = data.get("features", []) if isinstance(data, dict) else data

            normalized_events = []
            for feature in features[:50]:
                props = feature.get("properties", {})
                geom = feature.get("geometry", {}).get("coordinates", [0.0, 0.0])
                
                event_date = datetime.fromisoformat(props.get("fromdate", datetime.now(timezone.utc).isoformat())[:19])
                raw_type = props.get("eventtype", "Unknown")
                disaster_type = GDACS_TYPE_MAPPING.get(raw_type, DisasterType.STORM.value)
                
                primary_reason = SAFETY_REASONS.get(disaster_type, "Active meteorological alert recorded by GDACS.")
                raw_name = props.get("name", "")

                if " in " in raw_name and len(raw_name.split(",")) > 2:
                    print(f"Splitting multi-country event: {raw_name[:50]}...")
                    countries_str = raw_name.split(" in ")[-1].replace(" and ", ",").replace(".", "")
                    countries_list = [c.strip() for c in countries_str.split(",") if c.strip()]
                    
                    for country_name in countries_list:
                        lat, lon = geocode_country(country_name)
                        if lat and lon:
                            normalized_events.append({
                                "incident_id": f"GDACS-{props.get('eventid')}-{country_name.replace(' ', '')}",
                                "country": country_name,
                                "region": country_name,
                                "sub_region": "National Alert",
                                "locality": f"{disaster_type} Warning",
                                "latitude": lat,
                                "longitude": lon,
                                "year": event_date.year,
                                "month": event_date.month,
                                "season": determine_season(event_date.month),
                                "disaster_type": disaster_type,
                                "primary_reason": primary_reason,
                                "static_safety_tips": ["Monitor local authorities for real-time alerts.", "Check national advisories before travel."],
                                "dynamic_precautions": [f"National level alert active for {country_name}."]
                            })
                        time.sleep(1) 
                    continue 
                
                normalized_events.append({
                    "incident_id": f"GDACS-{props.get('eventid')}",
                    "country": props.get("country", "Unknown"),
                    "region": props.get("country", "Unknown"),
                    "sub_region": props.get("name", "Unknown"),
                    "locality": props.get("name", "Unknown"),
                    "latitude": geom[1] if len(geom) > 1 else 0.0,
                    "longitude": geom[0] if len(geom) > 0 else 0.0,
                    "year": event_date.year,
                    "month": event_date.month,
                    "season": determine_season(event_date.month),
                    "disaster_type": disaster_type,
                    "primary_reason": primary_reason,
                    "static_safety_tips": ["Monitor local authorities for real-time guidance.", "Keep emergency devices charged."],
                    "dynamic_precautions": ["Avoid the immediate affected perimeter."]
                })
            return normalized_events
        except requests.exceptions.RequestException as e:
            print(f"Attempt {attempt + 1}/{retries} failed: {e}")
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                return []

def update_dataset():
    RAW_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing_data = []
    if RAW_DATA_PATH.exists():
        with open(RAW_DATA_PATH, "r", encoding="utf-8") as f:
            existing_data = json.load(f)

    new_events = fetch_gdacs_events()
    existing_ids = {event["incident_id"] for event in existing_data}
    
    added_count = 0
    for event in new_events:
        if event["incident_id"] not in existing_ids:
            existing_data.append(event)
            added_count += 1

    with open(RAW_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False)
    print(f"Updated raw dataset with {added_count} new GDACS events.")

if __name__ == "__main__":
    update_dataset()