"""FastAPI Main Application."""
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Query, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from src.api.dependencies import get_disaster_data, get_predictor
from src.models.inference import DisasterPredictor
from src.data.schemas import SeasonEnum

app = FastAPI(
    title="Disaster Risk & Prediction API",
    description="Interactive geospatial disaster tracking and seasonal risk estimation.",
    version="1.0.0"
)

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
    if month in [3, 4, 5]:
        return SeasonEnum.SPRING.value
    if month in [6, 7, 8]:
        return SeasonEnum.SUMMER.value
    if month in [9, 10, 11]:
        return SeasonEnum.AUTUMN.value
    return SeasonEnum.WINTER.value


@app.get("/api/v1/hierarchy", tags=["Locations"])
def get_location_hierarchy(data: Dict[str, Any] = Depends(get_disaster_data)):
    """Returns available countries, regions, and sub-regions for dynamic search dropdowns."""
    hierarchy: Dict[str, Dict[str, List[str]]] = {}
    
    for feature in data.get("features", []):
        props = feature["properties"]
        country = props.get("country", "Unknown")
        region = props.get("region", "Unknown")
        sub_region = props.get("sub_region", "Unknown")

        if country not in hierarchy:
            hierarchy[country] = {}
        if region not in hierarchy[country]:
            hierarchy[country][region] = []
        if sub_region not in hierarchy[country][region]:
            hierarchy[country][region].append(sub_region)

    return {"hierarchy": hierarchy}


@app.get("/api/v1/disasters", tags=["GeoSpatial Data"])
def get_disasters(
    country: Optional[str] = Query(None, description="Country filter, e.g. Greece"),
    region: Optional[str] = Query(None, description="Region filter, e.g. East Macedonia and Thrace"),
    sub_region: Optional[str] = Query(None, description="Sub-region/Unit, e.g. Evros"),
    season: Optional[str] = Query(None, description="Season filter: Spring, Summer, Autumn, Winter"),
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    """Returns filtered GeoJSON points with disaster emojis, likelihood, and precautions."""
    filtered_features = []
    
    for feature in data.get("features", []):
        props = feature["properties"]
        if country and props.get("country", "").lower() != country.lower():
            continue
        if region and props.get("region", "").lower() != region.lower():
            continue
        if sub_region and props.get("sub_region", "").lower() != sub_region.lower():
            continue
        if season and props.get("season", "").lower() != season.lower():
            continue
        filtered_features.append(feature)

    return {
        "type": "FeatureCollection",
        "total_results": len(filtered_features),
        "features": filtered_features
    }


@app.get("/api/v1/predict", tags=["Predictions"])
def predict_risk(
    region: str = Query(..., description="Administrative Region, e.g. East Macedonia and Thrace"),
    season: Optional[str] = Query(None, description="Season (defaults to current season)"),
    predictor: DisasterPredictor = Depends(get_predictor)
):
    """Calculates ML-based probability estimates for upcoming seasons."""
    active_season = season if season else get_current_season()
    prediction_result = predictor.predict(region=region, season=active_season)
    
    if "error" in prediction_result:
        raise HTTPException(status_code=404, detail=prediction_result["error"])
        
    return prediction_result


@app.get("/api/v1/default-view", tags=["Default View"])
def get_default_view(
    lat: Optional[float] = Query(None, description="User latitude"),
    lon: Optional[float] = Query(None, description="User longitude"),
    data: Dict[str, Any] = Depends(get_disaster_data)
):
    """Generates the initial map center and current seasonal active alerts."""
    current_season = get_current_season()
    
    default_center = {"lat": 40.8539, "lon": 25.8741, "zoom": 8}
    matched_country = "Greece"
    
    active_features = [
        f for f in data.get("features", [])
        if f["properties"].get("season", "").lower() == current_season.lower()
    ]
    
    return {
        "current_season": current_season,
        "default_center": default_center,
        "matched_country": matched_country,
        "active_seasonal_features": {
            "type": "FeatureCollection",
            "features": active_features
        }
    }