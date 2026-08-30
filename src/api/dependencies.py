"""Application dependencies and in-memory asset singletons."""
import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Any
from src.models.inference import DisasterPredictor

BASE_DIR = Path(__file__).resolve().parents[2]
GEOJSON_PATH = BASE_DIR / "data" / "processed" / "regional_disaster_index.geojson"

@lru_cache(maxsize=1)
def get_disaster_data() -> Dict[str, Any]:
    """Loads and caches processed GeoJSON data securely."""
    if not GEOJSON_PATH.exists():
        # Fail-open: Allows the server to run and serve the frontend even if data is missing
        print(f"Warning: GeoJSON not found at {GEOJSON_PATH}. Returning empty dataset.")
        return {"type": "FeatureCollection", "features": []}
        
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

@lru_cache(maxsize=1)
def get_predictor() -> DisasterPredictor:
    """Loads and caches the ML DisasterPredictor thread-safely."""
    return DisasterPredictor()