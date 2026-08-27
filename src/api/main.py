"""FastAPI Main Application."""
import sys
import math
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, Query, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.api.dependencies import get_disaster_data, get_predictor
from src.models.inference import DisasterPredictor
from src.data.schemas import SeasonEnum

app = FastAPI(title="Safety Traveler API", page_icon= "🌍")
app.mount("/src/frontend", StaticFiles(directory="src/frontend"), name="frontend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_current_season() -> str:
    """Determines meteorological season from current UTC month."""
    month = datetime.now(timezone.utc).month
    if month in [3, 4, 5]: return SeasonEnum.SPRING.value
    if month in [6, 7, 8]: return SeasonEnum.SUMMER.value
    if month in [9, 10, 11]: return SeasonEnum.AUTUMN.value
    return SeasonEnum.WINTER.value

def get_nearest_region(lat: float, lon: float, features: List[Dict]) -> Optional[Dict]:
    """Finds the closest regional data point using Euclidean distance."""
    min_dist = float('inf')
    nearest_props = None
    
    for feature in features:
        geom = feature.get("geometry", {})
        if geom.get("type") == "Point":
            coords = geom.get("coordinates", [0, 0])
            f_lon, f_lat = coords[0], coords[1]
            
            dist = math.hypot(f_lat - lat, f_lon - lon)
            if dist < min_dist:
                min_dist = dist
                nearest_props = feature.get("properties")
                
    return nearest_props

@app.get("/api/v1/hierarchy")
def get_location_hierarchy(data: Dict[str, Any] = Depends(get_disaster_data)):
    hierarchy = {}
    for feature in data.get("features", []):
        props = feature["properties"]
        c, r, s = props.get("country", "Unknown"), props.get("region", "Unknown"), props.get("sub_region", "Unknown")
        if c not in hierarchy: hierarchy[c] = {}
        if r not in hierarchy[c]: hierarchy[c][r] = []
        if s not in hierarchy[c][r]: hierarchy[c][r].append(s)
    return {"hierarchy": hierarchy}

@app.get("/api/v1/disasters")
def get_disasters(
    country: Optional[str] = None, region: Optional[str] = None, 
    sub_region: Optional[str] = None, season: Optional[str] = None,
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    filtered = []
    for f in data.get("features", []):
        p = f["properties"]
        if country and p.get("country", "").lower() != country.lower(): continue
        if region and p.get("region", "").lower() != region.lower(): continue
        if sub_region and p.get("sub_region", "").lower() != sub_region.lower(): continue
        if season and p.get("season", "").lower() != season.lower(): continue
        filtered.append(f)
    return {"type": "FeatureCollection", "features": filtered}

@app.get("/api/v1/predict")
def predict_risk(
    region: Optional[str] = None,
    season: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    predictor: DisasterPredictor = Depends(get_predictor)
):
    active_season = season if season else get_current_season()
    target_region = region if region else "Unknown"
    
    return predictor.predict(
        region=target_region,
        season=active_season,
        lat=lat,
        lon=lon
    )

@app.get("/api/v1/default-view", tags=["Default View"])
def get_default_view(
    lat: Optional[float] = Query(None, description="User latitude"),
    lon: Optional[float] = Query(None, description="User longitude"),
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    """Generates a localized map centered on the user's country with active seasonal alerts."""
    current_season = get_current_season()
    features = data.get("features", [])
    
    center_lat, center_lon = 39.0, 22.0
    matched_country = "Greece"
    zoom_level = 6  
    
    if lat is not None and lon is not None:
        nearest = get_nearest_region(lat, lon, features)
        if nearest:
            matched_country = nearest.get("country", matched_country)
            center_lat, center_lon = lat, lon

    active_features = [
        f for f in features
        if f["properties"].get("season", "").lower() == current_season.lower()
        and f["properties"].get("country", "") == matched_country
    ]
    
    return {
        "current_season": current_season,
        "default_center": {"lat": center_lat, "lon": center_lon, "zoom": zoom_level},
        "matched_country": matched_country,
        "active_seasonal_features": {
            "type": "FeatureCollection",
            "features": active_features
        }
    }

FRONTEND_DIR = BASE_DIR / "src" / "frontend"

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def serve_frontend():
    """Serves the main HTML file."""
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html not found. Did you create it in src/frontend?")
    return FileResponse(str(index_file))