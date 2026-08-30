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
    seen_regions = set()

    for feature in data.get("features", []):
        geom = feature.get("geometry", {})
        props = feature.get("properties", {})
        
        if geom.get("type") == "Point":
            coords = geom.get("coordinates", [0, 0])
            lon, lat = coords[0], coords[1]
            
            if s <= lat <= n and w <= lon <= e:
                region_name = props.get("region", "Unknown")
                country_name = props.get("country", "Unknown")
                
                dedupe_key = f"{region_name}-{country_name}"
                if dedupe_key not in seen_regions:
                    seen_regions.add(dedupe_key)
                    
                    pred_result = predictor.predict(region=region_name, season=active_season, lat=lat, lon=lon)
                    
                    if pred_result and "predictions" in pred_result:
                        for p in pred_result["predictions"]:
                            if float(p.get("probability_percentage", 0)) >= 30:
                                results.append({
                                    "lat": lat,
                                    "lon": lon,
                                    "region": region_name,
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
    predictor: DisasterPredictor = Depends(get_predictor)
):
    active_season = season if season else get_current_season()
    target_region = region if region else "Unknown"

    if target_region and re.search(r'\b(sea|ocean|marine|gulf|bay|strait|lake|water)\b', target_region, re.IGNORECASE):
        return {"predictions": []}

    return predictor.predict(region=target_region, season=active_season, lat=lat, lon=lon)

@app.get("/")
def serve_frontend():
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html not found.")
    return FileResponse(str(index_file))