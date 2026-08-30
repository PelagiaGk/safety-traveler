"""FastAPI Main Application."""
import sys
import math
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Query, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.api.dependencies import get_disaster_data, get_predictor
from src.models.inference import DisasterPredictor
from src.data.schemas import SeasonEnum

app = FastAPI(title="Safety Traveler API", page_icon="🌍")

FRONTEND_DIR = BASE_DIR / "src" / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/src/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_current_season() -> str:
    month = datetime.now(timezone.utc).month
    if month in [3, 4, 5]: return SeasonEnum.SPRING.value
    if month in [6, 7, 8]: return SeasonEnum.SUMMER.value
    if month in [9, 10, 11]: return SeasonEnum.AUTUMN.value
    return SeasonEnum.WINTER.value

def get_nearest_region(lat: float, lon: float, features: List[Dict], max_dist: float = 0.15) -> Optional[Dict]:
    min_dist = float('inf')
    nearest_feature = None
    for feature in features:
        geom = feature.get("geometry", {})
        if geom.get("type") == "Point":
            coords = geom.get("coordinates", [0, 0])
            f_lon, f_lat = coords[0], coords[1]
            dist = math.hypot(f_lat - lat, f_lon - lon)
            if dist < min_dist and dist <= max_dist:
                min_dist = dist
                nearest_feature = feature
    return nearest_feature

@app.get("/api/v1/nominatim-proxy")
async def nominatim_proxy(lat: float, lon: float, zoom: int = 10, accept_language: str = "en"):
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {"format": "json", "lat": lat, "lon": lon, "zoom": zoom, "accept-language": accept_language}
    headers = {"User-Agent": "PublicSafetyDashboard/1.0"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(url, params=params, headers=headers)
            return response.json() if response.status_code == 200 else {"error": "Rate limited"}
        except Exception:
            return {"error": "Failed", "address": {}}

@app.get("/api/v1/scan-bounds")
def scan_bounds(
    n: float, s: float, e: float, w: float,
    season: Optional[str] = None,
    predictor: DisasterPredictor = Depends(get_predictor),
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    active_season = season if season else get_current_season()
    results = []
    seen_locations = set()

    for feature in data.get("features", []):
        geom = feature.get("geometry", {})
        props = feature.get("properties", {})
        
        if geom.get("type") == "Point":
            coords = geom.get("coordinates", [0, 0])
            lon, lat = coords[0], coords[1]
            
            if s <= lat <= n and w <= lon <= e:
                locality = props.get("locality", "Unknown")
                
                dedupe_key = f"{locality}-{round(lat, 2)}-{round(lon, 2)}"
                
                if dedupe_key not in seen_locations:
                    seen_locations.add(dedupe_key)
                    
                    region_name = props.get("region", "Unknown")
                    country_name = props.get("country", "Unknown")
                    
                    pred_result = predictor.predict(region=region_name, season=active_season, lat=lat, lon=lon)
                    
                    if pred_result and "predictions" in pred_result:
                        for p in pred_result["predictions"]:
                            raw_prob = str(p.get("probability_percentage", "0")).replace("%", "")
                            
                            if float(raw_prob) >= 30.0:
                                results.append({
                                    "lat": lat,
                                    "lon": lon,
                                    "region": region_name,
                                    "locality": locality,
                                    "country": country_name,
                                    "threat": p
                                })
    return {"results": results}

@app.get("/api/v1/predict")
def predict_risk(
    region: Optional[str] = None,
    season: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    predictor: DisasterPredictor = Depends(get_predictor),
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    active_season = season if season else get_current_season()
    target_region = region if region else "Unknown"
    resolved_lat, resolved_lon = lat, lon

    if target_region and re.search(r'\b(sea|ocean|marine|gulf|bay|strait|lake|water)\b', target_region, re.IGNORECASE):
        return {"predictions": []}

    if lat is not None and lon is not None:
        nearest_feat = get_nearest_region(lat, lon, data.get("features", []))
        
        if not nearest_feat:
            return {"predictions": []}
            
        props = nearest_feat.get("properties", {})
        geom = nearest_feat.get("geometry", {})
        
        if props.get("region"):
            target_region = props.get("region")
        if geom.get("type") == "Point":
            coords = geom.get("coordinates", [0, 0])
            resolved_lon, resolved_lat = coords[0], coords[1]

    result = predictor.predict(region=target_region, season=active_season, lat=resolved_lat, lon=resolved_lon)
    
    if isinstance(result, dict):
        result["resolved_lat"] = resolved_lat
        result["resolved_lon"] = resolved_lon
        result["resolved_region"] = target_region

    return result

@app.get("/api/v1/default-view", tags=["Default View"])
def get_default_view(
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    current_season = get_current_season()
    features = data.get("features", [])
    center_lat, center_lon = 39.0, 22.0
    matched_country = "Greece"
    
    if lat is not None and lon is not None:
        nearest = get_nearest_region(lat, lon, features)
        if nearest:
            matched_country = nearest.get("properties", {}).get("country", matched_country)
            center_lat, center_lon = lat, lon

    active_features = [f for f in features if f["properties"].get("season", "").lower() == current_season.lower() and f["properties"].get("country", "") == matched_country]
    return {"current_season": current_season, "default_center": {"lat": center_lat, "lon": center_lon, "zoom": 6}, "active_seasonal_features": {"type": "FeatureCollection", "features": active_features}}

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi import Response
    return Response(content="", media_type="image/x-icon")

@app.get("/")
def serve_frontend():
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html not found.")
    return FileResponse(str(index_file))