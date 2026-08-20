"""Data ingestion module for historical disaster events."""
import json
from pathlib import Path
import pandas as pd
from schemas import DisasterType, SeasonEnum

RAW_DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "disasters_raw.json"

SAMPLE_HISTORICAL_EVENTS = [
    {
        "incident_id": "GR-EVR-2023-01",
        "country": "Greece",
        "region": "East Macedonia and Thrace",
        "sub_region": "Evros",
        "locality": "Alexandroupoli",
        "latitude": 40.8539,
        "longitude": 25.8741,
        "year": 2023,
        "month": 8,
        "season": SeasonEnum.SUMMER.value,
        "disaster_type": DisasterType.WILDFIRE.value,
        "primary_reason": "Prolonged extreme drought, sustained gale-force winds (6-7 Beaufort), and high temperatures.",
        "static_safety_tips": [
            "Keep emergency contact numbers (112 for EU civil protection) on speed dial.",
            "Keep an emergency grab-bag ready with essential documents, medication, and water.",
            "Follow official civil defense evacuation routes immediately when notified."
        ],
        "dynamic_precautions": [
            "Avoid visiting peri-urban pine forest zones during dry Summer days with high wind alerts.",
            "Monitor local fire hazard risk indices before undertaking outdoor activities.",
            "Check highway status (Egnatia Odos) for potential smoke-related closures."
        ]
    },
    {
        "incident_id": "GR-EVR-2021-02",
        "country": "Greece",
        "region": "East Macedonia and Thrace",
        "sub_region": "Evros",
        "locality": "Alexandroupoli (Apollon Forest / Kirki)",
        "latitude": 40.9412,
        "longitude": 25.7925,
        "year": 2021,
        "month": 7,
        "season": SeasonEnum.SUMMER.value,
        "disaster_type": DisasterType.WILDFIRE.value,
        "primary_reason": "High heatwave conditions coupled with dry lightning strikes.",
        "static_safety_tips": [
            "Keep emergency contact numbers on speed dial.",
            "Maintain defensible space around rural properties."
        ],
        "dynamic_precautions": [
            "Do not discard lit cigarettes or operate machinery generating sparks near dry vegetation."
        ]
    },
    {
        "incident_id": "GR-EVR-2022-03",
        "country": "Greece",
        "region": "East Macedonia and Thrace",
        "sub_region": "Evros",
        "locality": "Evros River Basin",
        "latitude": 41.3481,
        "longitude": 26.4982,
        "year": 2022,
        "month": 2,
        "season": SeasonEnum.WINTER.value,
        "disaster_type": DisasterType.FLOOD.value,
        "primary_reason": "Heavy seasonal upstream precipitation combined with snowmelt entering the river delta.",
        "static_safety_tips": [
            "Never attempt to drive or walk through flooded roads or underpasses.",
            "Move to higher ground if flood alerts are issued."
        ],
        "dynamic_precautions": [
            "Avoid agricultural lowlands near the riverbanks during winter alert periods."
        ]
    }
]


def ingest_initial_data(output_path: Path = RAW_DATA_PATH) -> None:
    """Writes baseline raw dataset to the designated data directory."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(SAMPLE_HISTORICAL_EVENTS, f, indent=2, ensure_ascii=False)
    print(f"Successfully ingested {len(SAMPLE_HISTORICAL_EVENTS)} records into {output_path}")


if __name__ == "__main__":
    ingest_initial_data()