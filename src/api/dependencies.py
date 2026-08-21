"""Application dependencies and in-memory asset singletons."""
import json
from pathlib import Path
from typing import Dict, Any, Optional
from src.models.inference import DisasterPredictor

BASE_DIR = Path(__file__).resolve().parents[2]
GEOJSON_PATH = BASE_DIR / "data" / "processed" / "regional_disaster_index.geojson"

_cached_geojson: Optional[Dict[str, Any]] = None
_cached_predictor: Optional[DisasterPredictor] = None


def get_disaster_data() -> Dict[str, Any]:
    """Loads and caches processed GeoJSON data."""
    global _cached_geojson
    if _cached_geojson is None:
        if not GEOJSON_PATH.exists():
            raise FileNotFoundError("Processed GeoJSON data not found. Run preprocess.py first.")
        with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
            _cached_geojson = json.load(f)
    return _cached_geojson


def get_predictor() -> DisasterPredictor:
    """Loads and caches the ML DisasterPredictor."""
    global _cached_predictor
    if _cached_predictor is None:
        _cached_predictor = DisasterPredictor()
    return _cached_predictor