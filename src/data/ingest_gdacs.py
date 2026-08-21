"""GDACS API Ingestion Module."""
import json
import requests
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"

#REST API endpoint for fetching recent events
GDACS_SEARCH_URL = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH"

def determine_season(month: int) -> str:
    """Derives meteorological season from month."""
    if month in [3, 4, 5]: return "Spring"
    if month in [6, 7, 8]: return "Summer"
    if month in [9, 10, 11]: return "Autumn"
    return "Winter"

def fetch_gdacs_events() -> list:
    """Fetches and normalizes the latest events from the GDACS API."""
    try:
        response = requests.get(GDACS_SEARCH_URL, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        features = data.get("features", []) if isinstance(data, dict) else data
        
        normalized_events = []
        for feature in features[:50]:  
            props = feature.get("properties", {})
            geom = feature.get("geometry", {}).get("coordinates", [0.0, 0.0])
            
            #Maps GDACS events to system format
            event_date = datetime.fromisoformat(props.get("fromdate", datetime.utcnow().isoformat())[:19])
            
            normalized_events.append({
                "incident_id": f"GDACS-{props.get('eventid')}",
                "country": props.get("country", "Unknown"),
                "region": "Unknown", 
                "sub_region": "Unknown",
                "locality": props.get("name", "Unknown"),
                "latitude": geom[1] if len(geom) > 1 else 0.0,
                "longitude": geom[0] if len(geom) > 0 else 0.0,
                "year": event_date.year,
                "month": event_date.month,
                "season": determine_season(event_date.month),
                "disaster_type": props.get("eventtype", "Unknown"),
                "primary_reason": props.get("description", "No detailed description available."),
                "static_safety_tips": ["Monitor local authorities for real-time guidance."],
                "dynamic_precautions": ["Avoid the affected perimeter mapped by GDACS."]
            })
        return normalized_events
    except Exception as e:
        print(f"Failed to fetch GDACS data: {e}")
        return []

def update_dataset():
    """Appends recent GDACS events to the local raw dataset."""
    RAW_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    existing_data = []
    if RAW_DATA_PATH.exists():
        with open(RAW_DATA_PATH, "r", encoding="utf-8") as f:
            existing_data = json.load(f)
            
    new_events = fetch_gdacs_events()
    
    #Deduplicates by incident_id
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