"""Geospatial helper utilities."""
from typing import Dict, List, Optional, Any
import math

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates haversine distance in kilometers between two spherical coordinates."""
    r = 6371.0  # Earth radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
         
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c

def resolve_administrative_region(lat: float, lon: float, dataset_features: Optional[List[Dict[str, Any]]] = None) -> Dict[str, str]:
    """
    Universally resolves coordinates into Country, Region, and Sub-region.
    Uses Haversine distance against a provided dataset of known global features for offline snapping.
    """
    default_resp = {
        "country": "Unknown",
        "region": "Unknown",
        "sub_region": "Unknown",
        "locality": "Unknown"
    }
    
    if not dataset_features:
        return default_resp
        
    min_dist = float('inf')
    best_match = None
    
    for feature in dataset_features:
        geom = feature.get("geometry", {})
        props = feature.get("properties", {})
        
        if geom.get("type") == "Point":
            coords = geom.get("coordinates", [0, 0])
            f_lon, f_lat = coords[0], coords[1]
            
            dist = calculate_distance(lat, lon, f_lat, f_lon)
            if dist < min_dist:
                min_dist = dist
                best_match = props
                
    if best_match and min_dist <= 50.0:  
        return {
            "country": best_match.get("country", "Unknown"),
            "region": best_match.get("region", "Unknown"),
            "sub_region": best_match.get("sub_region", "Unknown"),
            "locality": best_match.get("locality", "Unknown")
        }
        
    return default_resp