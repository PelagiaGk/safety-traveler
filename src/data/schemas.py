"""Data schemas for disaster tracking and regional hierarchy."""
from typing import Optional, List, Dict
from pydantic import BaseModel, Field
from enum import Enum


class SeasonEnum(str, Enum):
    SPRING = "Spring"
    SUMMER = "Summer"
    AUTUMN = "Autumn"
    WINTER = "Winter"


class RiskLevel(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


class DisasterType(str, Enum):
    WILDFIRE = "Wildfire"
    FLOOD = "Flood"
    EARTHQUAKE = "Earthquake"
    STORM = "Storm"
    HEATWAVE = "Heatwave"
    DROUGHT = "Drought"


#Mapping disaster types to representative emoji badges
DISASTER_EMOJIS: Dict[DisasterType, str] = {
    DisasterType.WILDFIRE: "🔥",
    DisasterType.FLOOD: "🌊",
    DisasterType.EARTHQUAKE: "🌋",
    DisasterType.STORM: "🌪️",
    DisasterType.HEATWAVE: "☀️",
    DisasterType.DROUGHT: "🏜️",
}


class DisasterIncident(BaseModel):
    incident_id: str
    country: str
    region: str #ex Central Macedonia (perifereia)   
    sub_region: str #ex Thessaloniki (nomos)
    locality: str #ex Thessaloniki (poli)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    year: int
    month: int = Field(..., ge=1, le=12)
    season: SeasonEnum
    disaster_type: DisasterType
    primary_reason: str      
    static_safety_tips: List[str]
    dynamic_precautions: List[str]  