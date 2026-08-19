"""Preprocessing and spatial feature generation pipeline."""
import json
from pathlib import Path
from typing import Dict, Any, List
import pandas as pd
from schemas import DISASTER_EMOJIS, DisasterType, RiskLevel

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"
PROCESSED_DATA_PATH = BASE_DIR / "data" / "processed" / "regional_disaster_index.geojson"
SUMMARY_STATS_PATH = BASE_DIR / "data" / "processed" / "risk_summary.json"


def load_raw_dataset(path: Path = RAW_DATA_PATH) -> pd.DataFrame:
    """Loads raw records into a DataFrame."""
    if not path.exists():
        raise FileNotFoundError(f"Raw data file not found at {path}. Run ingest_data.py first.")
    return pd.read_json(path)


def calculate_risk_level(frequency: int, total_seasonal_records: int) -> RiskLevel:
    """Calculates risk tier based on occurrence frequency ratio."""
    if total_seasonal_records == 0:
        return RiskLevel.LOW
    
    ratio = frequency / total_seasonal_records
    if ratio >= 0.40:
        return RiskLevel.HIGH
    elif ratio >= 0.15:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def build_geojson_features(df: pd.DataFrame) -> Dict[str, Any]:
    """Transforms incident rows into a GeoJSON FeatureCollection with visual emoji metadata."""
    features: List[Dict[str, Any]] = []

    #Calculates seasonal incident counts per sub_region for relative risk
    sub_region_counts = df.groupby(["country", "region", "sub_region", "season"]).size().to_dict()

    for _, row in df.iterrows():
        d_type = DisasterType(row["disaster_type"])
        emoji = DISASTER_EMOJIS.get(d_type, "⚠️")

        key = (row["country"], row["region"], row["sub_region"], row["season"])
        total_sub_region_seasonal_incidents = sub_region_counts.get(key, 1)

        #Counts occurrences of this specific disaster type in this locality & season
        type_count = len(df[
            (df["country"] == row["country"]) &
            (df["sub_region"] == row["sub_region"]) &
            (df["season"] == row["season"]) &
            (df["disaster_type"] == row["disaster_type"])
        ])

        risk_tier = calculate_risk_level(type_count, total_sub_region_seasonal_incidents)
        probability_percentage = round((type_count / total_sub_region_seasonal_incidents) * 100, 1)

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row["longitude"], row["latitude"]]
            },
            "properties": {
                "incident_id": row["incident_id"],
                "country": row["country"],
                "region": row["region"],
                "sub_region": row["sub_region"],
                "locality": row["locality"],
                "season": row["season"],
                "disaster_type": row["disaster_type"],
                "emoji": emoji,
                "risk_level": risk_tier.value,
                "statistical_probability": f"{probability_percentage}%",
                "primary_reason": row["primary_reason"],
                "static_safety_tips": row["static_safety_tips"],
                "dynamic_precautions": row["dynamic_precautions"],
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features
    }


def run_pipeline() -> None:
    """Executes full preprocessing and saves processed data artifacts."""
    PROCESSED_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    df = load_raw_dataset()

    #Generates GeoJSON with embedded metadata and emojis
    geojson_data = build_geojson_features(df)
    with open(PROCESSED_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2, ensure_ascii=False)

    #Exports statistical summary for API querying
    summary = df.groupby(["country", "region", "sub_region", "season", "disaster_type"]).size().reset_index(name="incident_count")
    summary.to_json(SUMMARY_STATS_PATH, orient="records", indent=2)

    print(f"Pipeline executed successfully.")
    print(f"Generated GeoJSON: {PROCESSED_DATA_PATH}")
    print(f"Generated Summary: {SUMMARY_STATS_PATH}")


if __name__ == "__main__":
    run_pipeline()