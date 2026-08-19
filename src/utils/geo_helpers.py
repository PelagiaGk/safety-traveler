"""Geospatial helper utilities."""
from typing import Dict, Optional
import math


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates haversine distance in kilometers between two coordinates."""
    r = 6371.0  # Earth radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def resolve_administrative_region(lat: float, lon: float) -> Dict[str, str]:
    """
    Resolves coordinates into Country, Region, and Sub-region.
    Can be linked to OpenStreetMap Nominatim or an offline GeoJSON boundary map.
    """
    #Sample bounding box / centroid lookup for Northern Greece / Thrace
    if 40.5 <= lat <= 41.8 and 25.0 <= lon <= 26.6:
        return {
            "country": "Greece",
            "region": "East Macedonia and Thrace",
            "sub_region": "Evros",
            "locality": "Alexandroupoli"
        }
    
    return {
        "country": "Unknown",
        "region": "Unknown",
        "sub_region": "Unknown",
        "locality": "Unknown"
    }