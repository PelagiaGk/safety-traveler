let map;
let markersClusterGroup;
let isMarkerClick = false;
let currentRegionName = "Regional View";
let plottedMarkersCache = [];
window.isMapScanning = false;
window.currentScanController = null;

const WILDLAND_SEARCH_RADIUS_M = 8000;
const WATER_SEARCH_RADIUS_M = 8000;
const WILDFIRE_JITTER_DEG = 0.035;
const areaNameCache = new Map();

document.addEventListener("DOMContentLoaded", () => {
    if (map !== undefined && map !== null) {
        map.remove();
    }

    const worldBounds = [
        [-90, -180],
        [90, 180]
    ];

    map = L.map('map', {
        maxBounds: worldBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 3
    }).setView([38.0, 24.0], 6);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
        maxZoom: 19,
        minZoom: 3,
        noWrap: true,
        bounds: worldBounds
    }).addTo(map);

    markersClusterGroup = L.featureGroup().addTo(map);
    const seasonFilter = document.getElementById('season-filter');
    
    if (seasonFilter) {
        seasonFilter.addEventListener('change', () => {
            markersClusterGroup.clearLayers();
            plottedMarkersCache = [];
            scanVisibleArea();
        });
    }

    map.on('click', async (e) => {
        if (isMarkerClick) { isMarkerClick = false; return; }

        const popup = L.popup({ offset: [0, -5], className: 'custom-glass-wrapper' })
            .setLatLng(e.latlng)
            .setContent('<div class="glass-popup empty-state"><h3>📡 Analyzing ML data...</h3></div>')
            .openOn(map);

        try {
            const season = document.getElementById('season-filter')?.value || (typeof getCurrentSeason === 'function' ? getCurrentSeason() : 'Summer');
            
            let clickName = "Regional Sector"; 
            let isProvenWater = false;

            const currentZoom = map.getZoom();
            let nomZoom = currentZoom < 5 ? 3 : (currentZoom < 7 ? 5 : 10);
            
            try {
                const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${e.latlng.lat}&lon=${e.latlng.lng}&zoom=${nomZoom}`);
                
                if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    if (!geoData.error) {
                        if (isWaterFromGeoData(geoData)) {
                            isProvenWater = true;
                        } else if (geoData.address) {
                            clickName = geoData.address.municipality || geoData.address.town || geoData.address.city || geoData.address.county || "Regional Sector";
                        }
                    }
                }
            } catch (err) {
                console.warn("Geocode request failed. Proceeding with default land assumption.");
            }

            if (isProvenWater) {
                popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                return;
            }

            const res = await fetch(`/api/predict?lat=${e.latlng.lat}&lon=${e.latlng.lng}&region=${encodeURIComponent(clickName)}&season=${season}`);
            
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
                    
                    const validThreats = data.predictions.filter(p => parseInt(p.probability_percentage) >= 30);
                    
                    if (validThreats.length > 0) {
                        let combinedHTML = `<div class="multi-threat-scroll" style="max-height: 280px; overflow-y: auto; padding-right: 5px;">`;
                        validThreats.forEach(threat => {
                            threat.locality = clickName;
                            combinedHTML += buildPopupCard(threat, e.latlng.lat, e.latlng.lng);
                        });
                        combinedHTML += `</div>`;
                        
                        popup.setContent(combinedHTML);
                        return;
                    }
                }
            }
            
            popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
            
        } catch (err) {
            popup.setContent('<div class="glass-popup empty-state"><h3>⚠️ ML Service unavailable. Please try again.</h3></div>');
        }
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (!query) return;

                try {
                    const params = new URLSearchParams({ q: query, format: 'json', limit: 1 });
                    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
                    const data = await response.json();

                    if (data && data.length > 0) {
                        const lat = parseFloat(data[0].lat);
                        const lon = parseFloat(data[0].lon);
                        map.flyTo([lat, lon], 8, { animate: true, duration: 1.5 });
                        searchInput.value = '';
                        searchInput.blur();
                    }
                } catch (err) {
                    console.warn("Search geocode failed:", err);
                }
            }
        });
    }

    let scanTimeout;
    
    map.on('moveend', () => {
        isMarkerClick = false;
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
            const center = map.getBounds().getCenter();
            if (typeof updateRegionMeta === 'function') {
                updateRegionMeta(center.lat, center.lng);
            }
            scanVisibleArea();
        }, 1500); 
    });
    
    map.on('zoomend', () => {
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanVisibleArea, 1500); 
    });

    updateRegionMeta(map.getCenter().lat, map.getCenter().lng);
    scanVisibleArea();
});

function getCurrentSeason() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "Spring";
    if (month >= 5 && month <= 7) return "Summer";
    if (month >= 8 && month <= 10) return "Autumn";
    return "Winter";
}

function getCompassDirection(lat, lon, geoData) {
    if (!geoData || !geoData.boundingbox || geoData.boundingbox.length < 4) return "";

    const targetLat = parseFloat(lat);
    const targetLon = parseFloat(lon);

    const southLat = parseFloat(geoData.boundingbox[0]);
    const northLat = parseFloat(geoData.boundingbox[1]);
    const westLon = parseFloat(geoData.boundingbox[2]);
    const eastLon = parseFloat(geoData.boundingbox[3]);

    const latSpan = northLat - southLat;
    const lonSpan = eastLon - westLon;

    if (latSpan < 0.005 || lonSpan < 0.005) return "";

    const latThird = latSpan / 3;
    const lonThird = lonSpan / 3;

    let v = "", h = "";

    if (targetLat > northLat - latThird) v = "North";
    else if (targetLat < southLat + latThird) v = "South";

    if (targetLon > eastLon - lonThird) h = "East";
    else if (targetLon < westLon + lonThird) h = "West";

    if (v && h) return `${v}${h.toLowerCase()}ern `;
    if (v || h) return `${v || h}ern `;
    return "Central ";
}

function isWaterFromGeoData(geoData) {
    if (!geoData || geoData.error) return false;

    const isWaterMeta = (geoData.class === 'natural' && geoData.type === 'water') ||
        geoData.class === 'waterway' || geoData.type === 'sea' ||
        (geoData.address && (geoData.address.sea || geoData.address.ocean));

    const dispName = (geoData.display_name || "").toLowerCase();
    const isWaterText = ["sea", "ocean", "gulf", "marine", "bay", "strait"].some(t => dispName.includes(t));

    return isWaterMeta || isWaterText;
}

async function isPointOverWater(lat, lon, signal) {
    try {
        const res = await fetch(`/api/v1/nominatim-proxy?lat=${lat}&lon=${lon}&zoom=14`, { signal });
        if (!res.ok) return false;
        const geoData = await res.json();
        return isWaterFromGeoData(geoData);
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        return false;
    }
}

async function resolveAreaName(lat, lon, signal) {
    const cacheKey = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    if (areaNameCache.has(cacheKey)) {
        return areaNameCache.get(cacheKey);
    }

    let areaName = null;
    try {
        const res = await fetch(`/api/v1/nominatim-proxy?lat=${lat}&lon=${lon}&zoom=8`, { signal });
        if (res.ok) {
            const geoData = await res.json();
            if (!geoData.error && geoData.address) {
                const addr = geoData.address;
                const baseArea = addr.county || addr.state_district || addr.region || addr.state || addr.country || null;
                if (baseArea) {
                    areaName = `${getCompassDirection(lat, lon, geoData)}${baseArea}`;
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn("Area name resolution failed; falling back to a per-point dedupe key.");
    }

    areaNameCache.set(cacheKey, areaName);
    return areaName;
}

async function findNearestOverpassFeature(query, lat, lon, signal) {
    try {
        const res = await fetch(`/api/v1/overpass-proxy?data=${encodeURIComponent(query)}`, { signal });
        if (!res.ok) return null;

        const data = await res.json();
        if (!data.elements || data.elements.length === 0) return null;

        let best = null;
        let bestDist = Infinity;

        data.elements.forEach(el => {
            const elLat = el.lat ?? (el.center && el.center.lat);
            const elLon = el.lon ?? (el.center && el.center.lon);
            if (elLat === undefined || elLon === undefined) return;

            const dist = Math.hypot(elLat - lat, elLon - lon);
            if (dist < bestDist) {
                bestDist = dist;
                best = { lat: elLat, lon: elLon };
            }
        });

        return best;
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn("Overpass placement lookup failed; using default position.");
        return null;
    }
}

async function computePlacement(lat, lon, disasterType, signal) {
    const type = (disasterType || "").toLowerCase();

    if (type.includes('fire')) {
        const query = `[out:json][timeout:5];(way["natural"="wood"](around:${WILDLAND_SEARCH_RADIUS_M},${lat},${lon});way["landuse"="forest"](around:${WILDLAND_SEARCH_RADIUS_M},${lat},${lon});relation["natural"="wood"](around:${WILDLAND_SEARCH_RADIUS_M},${lat},${lon});relation["landuse"="forest"](around:${WILDLAND_SEARCH_RADIUS_M},${lat},${lon}););out center 5;`;
        const feature = await findNearestOverpassFeature(query, lat, lon, signal);
        if (feature) return feature;

        for (let attempt = 0; attempt < 4; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const candidate = {
                lat: lat + Math.sin(angle) * WILDFIRE_JITTER_DEG,
                lon: lon + Math.cos(angle) * WILDFIRE_JITTER_DEG
            };
            const overWater = await isPointOverWater(candidate.lat, candidate.lon, signal);
            if (!overWater) return candidate;
        }
        return { lat, lon };
    }

    if (type.includes('flood')) {
        const query = `[out:json][timeout:5];(way["waterway"](around:${WATER_SEARCH_RADIUS_M},${lat},${lon});way["natural"="water"](around:${WATER_SEARCH_RADIUS_M},${lat},${lon});relation["natural"="water"](around:${WATER_SEARCH_RADIUS_M},${lat},${lon}););out center 3;`;
        const feature = await findNearestOverpassFeature(query, lat, lon, signal);
        if (feature) return feature;
        return { lat, lon };
    }

    return { lat, lon };
}

function buildPopupCard(data, lat, lon) {
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    let reasonText = data.primary_reason || `Live ML forecast indicates a ${data.probability_percentage} probability for ${data.disaster_type} in the surrounding area.`;

    if (data.years_of_data) {
        reasonText += ` (Derived from ${data.years_of_data} years of historical data).`;
    }

    const precautionsList = data.dynamic_precautions && data.dynamic_precautions.length > 0 
        ? data.dynamic_precautions.map(p => `<li>${p}</li>`).join('')
        : `<li>Monitor local meteorological bulletins and regional safety warnings.</li>`;

    return `
        <div class="glass-popup" style="margin-bottom: 10px;">
            <h2>${data.locality || 'User Selected Area'}</h2>
            <p class="season-tag">Season: <strong>${season}</strong></p>
            <div class="advisory-section">
                <p><strong>Seasonal Advisory:</strong> ${data.risk_rating || 'Medium'} probability of ${data.disaster_type}.</p>
                <p><strong>Reason:</strong> ${reasonText}</p>
            </div>
            <div class="precautions-section">
                <h3>PRECAUTIONS:</h3>
                <ul>${precautionsList}</ul>
            </div>
        </div>
    `;
}

async function updateRegionMeta(lat, lon) {
    const regionTextEl = document.getElementById('regionText');
    
    if (regionTextEl) {
        regionTextEl.innerHTML = `<span style="opacity: 0.5;">Scanning Area...</span>`;
    }

    const currentZoom = map.getZoom();
    let nomZoom = 10;
    if (currentZoom < 5) nomZoom = 3;
    else if (currentZoom < 7) nomZoom = 5;
    else if (currentZoom < 9) nomZoom = 8;

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${nomZoom}&accept-language=en`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Public-Safety-Dashboard/1.0'
            }
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.address) {
                const addr = data.address;
                let baseName = "Uncharted Sector";

                if (currentZoom < 5) baseName = addr.country || "International Space";
                else if (currentZoom < 7) baseName = addr.state || addr.region || addr.province || addr.country || "Regional Sector";
                else baseName = addr.county || addr.district || addr.state_district || addr.municipality || addr.city || addr.state || addr.country || "Local Sector";

                if (addr.ocean || addr.sea || addr.water) baseName = addr.ocean || addr.sea || addr.water;

                const prefix = getCompassDirection(lat, lon, data);
                currentRegionName = prefix + baseName;
            } else {
                currentRegionName = "Marine Sector";
            }
        } else {
            currentRegionName = "Regional View";
        }
    } catch (err) {
        console.warn("Geocoding failed, falling back to default region name.");
        currentRegionName = "Regional View";
    }

    if (regionTextEl) {
        regionTextEl.innerText = currentRegionName;
    }
}

async function scanVisibleArea() {
    if (window.currentScanController) {
        window.currentScanController.abort();
    }
    window.currentScanController = new AbortController();
    const globalSignal = window.currentScanController.signal;

    const bounds = map.getBounds();
    const season = document.getElementById('season-filter')?.value || (typeof getCurrentSeason === 'function' ? getCurrentSeason() : 'Summer');
    const currentZoom = map.getZoom();

    const s = bounds.getSouth().toFixed(4);
    const w = bounds.getWest().toFixed(4);
    const n = bounds.getNorth().toFixed(4);
    const e = bounds.getEast().toFixed(4);

    let rawPoints = [];

    const overpassController = new AbortController();
    const overpassTimeout = setTimeout(() => overpassController.abort(), 6000);
    globalSignal.addEventListener('abort', () => { overpassController.abort(); clearTimeout(overpassTimeout); });

    try {
        let nodeLimit = currentZoom < 6 ? 5 : (currentZoom >= 10 ? 12 : 8);
        let placeFilter = currentZoom < 6 ? "country|state|city" : "city|town|municipality";
        const query = `[out:json][timeout:5];node["place"~"${placeFilter}"](${s},${w},${n},${e});out ${nodeLimit};`;

        const overpassRes = await fetch(`/api/v1/overpass-proxy?data=${encodeURIComponent(query)}`, { signal: overpassController.signal });

        if (overpassRes.ok) {
            const cityData = await overpassRes.json();
            if (cityData.elements) {
                cityData.elements.forEach(city => {
                    const placeName = city.tags['name:en'] || city.tags.name || "Regional Sector";
                    rawPoints.push({ lat: parseFloat(city.lat), lon: parseFloat(city.lon), name: placeName });
                });
            }
        }
    } catch (err) {
        if (err.name === 'AbortError' && globalSignal.aborted) return;
        console.warn("Overpass API unavailable. Triggering strict fallback.");
    } finally {
        clearTimeout(overpassTimeout); 
    }

    if (rawPoints.length === 0) {
        const center = bounds.getCenter();
        const latOff = (bounds.getNorth() - bounds.getSouth()) * 0.25;
        const lonOff = (bounds.getEast() - bounds.getWest()) * 0.25;
        
        const fallbackPoints = [
            { lat: center.lat, lon: center.lng },
            { lat: center.lat + latOff, lon: center.lng - lonOff }, 
            { lat: center.lat + latOff, lon: center.lng + lonOff }, 
            { lat: center.lat - latOff, lon: center.lng - lonOff }, 
            { lat: center.lat - latOff, lon: center.lng + lonOff }  
        ];

        for (const pt of fallbackPoints) {
            if (globalSignal.aborted) return;

            let isValidLand = false;
            let regionName = "Regional Sector"; 

            try {
                const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${pt.lat}&lon=${pt.lon}&zoom=10`, { signal: globalSignal });
                if (geoRes.ok) {
                    const geoData = await geoRes.json();

                    if (!geoData.error && !isWaterFromGeoData(geoData)) {
                        isValidLand = true;
                        if (geoData.address) {
                            regionName = geoData.address.municipality || geoData.address.town || geoData.address.city || "Regional Sector";
                        }
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
            }

            if (isValidLand) {
                rawPoints.push({ lat: pt.lat, lon: pt.lon, name: regionName });
            }

            await new Promise(resolve => {
                const timer = setTimeout(resolve, 1100);
                globalSignal.addEventListener('abort', () => { clearTimeout(timer); resolve(); });
            });
        }
    }

    if (globalSignal.aborted) return;

    let predictionsList = [];
    for (const pt of rawPoints) {
        if (globalSignal.aborted) return;
        try {
            const url = `/api/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent(pt.name)}&season=${season}`;
            const res = await fetch(url, { signal: globalSignal });
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
                    data.predictions.forEach(pred => {
                        if (parseInt(pred.probability_percentage) >= 30) {
                            predictionsList.push({ lat: pt.lat, lon: pt.lon, name: pt.name, threat: pred });
                        }
                    });
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }

    if (globalSignal.aborted) return;
    predictionsList.sort((a, b) => parseInt(b.threat.probability_percentage) - parseInt(a.threat.probability_percentage));

    let dedupeDistance = 0.2; 
    if (currentZoom < 6) dedupeDistance = 0.8; 
    else if (currentZoom < 8) dedupeDistance = 0.5; 
    else if (currentZoom >= 10) dedupeDistance = 0.08; 

    for (const pt of predictionsList) {
        if (globalSignal.aborted) return;

        let areaName = null;
        try {
            areaName = await resolveAreaName(pt.lat, pt.lon, globalSignal);
        } catch (err) {
            if (err.name === 'AbortError') return;
        }

        const areaLabel = areaName || (pt.name && pt.name !== "Regional Sector" ? pt.name : `${pt.lat.toFixed(2)}_${pt.lon.toFixed(2)}`);
        const uniqueKey = `${areaLabel}-${pt.threat.disaster_type}`;

        const isDuplicate = plottedMarkersCache.some(cachedPt => cachedPt.uniqueKey === uniqueKey);
        if (isDuplicate) continue;

        let placement = { lat: pt.lat, lon: pt.lon };
        try {
            placement = await computePlacement(pt.lat, pt.lon, pt.threat.disaster_type, globalSignal);
        } catch (err) {
            if (err.name === 'AbortError') return;
        }

        let finalLat = placement.lat;
        let finalLon = placement.lon;

        const spatialOverlap = plottedMarkersCache.some(c => Math.hypot(finalLat - c.lat, finalLon - c.lon) < dedupeDistance);
        if (spatialOverlap) {
            finalLon += 0.04;
        }

        plottedMarkersCache.push({
            lat: finalLat,
            lon: finalLon,
            type: pt.threat.disaster_type,
            name: pt.name,
            uniqueKey: uniqueKey
        });

        plotDynamicMarker(finalLat, finalLon, pt.threat, pt.name);
    }
}

function plotDynamicMarker(lat, lon, topThreat, cityName) {
    const probability = parseInt(topThreat.probability_percentage);
    if (probability < 30) return;

    let risk = probability >= 65 ? 'high' : (probability >= 40 ? 'medium' : 'low');
    const emojis = { "Wildfire": "🔥", "Flood": "🌊", "Storm": "🌪️", "Heatwave": "☀️", "Earthquake": "🌋", "Drought": "🏜️" };
    const emoji = emojis[topThreat.disaster_type] || '⚠️';
    const borderColor = risk === 'high' ? '#ef4444' : risk === 'medium' ? '#f59e0b' : '#10b981';

    const icon = L.divIcon({
        html: `<div class="marker-bubble" style="border-color: ${borderColor};">${emoji}</div>`,
        className: 'custom-emoji-icon-container',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    const marker = L.marker([lat, lon], { icon: icon, customRisk: risk, customEmoji: emoji });

    marker.on('click', async (e) => {
        isMarkerClick = true;
        L.DomEvent.stopPropagation(e);

        map.flyTo([lat, lon], 10, { duration: 1.2 });

        const initialDetails = {
            locality: "⏳ Resolving Region...",
            disaster_type: topThreat.disaster_type,
            risk_level: risk,
            emoji: emoji,
            primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type} in the surrounding area.`,
            dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
        };

        const popup = L.popup({
            offset: [0, -10],
            className: 'custom-glass-wrapper'
        })
            .setLatLng([lat, lon])
            .setContent(buildPopupCard(initialDetails, lat, lon))
            .openOn(map);

        let finalName = cityName;
        let directionPrefix = "";

        try {
            await new Promise(resolve => setTimeout(resolve, 800));

            const currentZoom = map.getZoom();
            let nomZoom = 10;
            if (currentZoom < 5) nomZoom = 3;
            else if (currentZoom < 7) nomZoom = 5;
            else if (currentZoom < 9) nomZoom = 8;

            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${nomZoom}&accept-language=en`);

            if (geo.ok) {
                const geoData = await geo.json();
                if (geoData.address) {
                    const addr = geoData.address;

                    if (currentZoom < 5) {
                        finalName = addr.country || "International Space";
                    } else if (currentZoom < 7) {
                        finalName = addr.state || addr.region || addr.province || addr.country || finalName;
                    } else {
                        finalName = addr.county || addr.district || addr.state_district || addr.municipality || addr.city || addr.state || addr.country || finalName;
                    }

                    directionPrefix = getCompassDirection(lat, lon, geoData);
                }
            }
        } catch (err) {
            console.warn("Failed to resolve regional name on click.");
        }

        const resolvedDetails = {
            locality: `${directionPrefix}${finalName}`,
            disaster_type: topThreat.disaster_type,
            risk_level: risk,
            emoji: emoji,
            primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type} in the surrounding area.`,
            dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
        };

        popup.setContent(buildPopupCard(resolvedDetails, lat, lon));
    });

    markersClusterGroup.addLayer(marker);
}