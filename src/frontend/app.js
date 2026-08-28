let map;
let markersClusterGroup;
let isMarkerClick = false;
let overpassCircuitTripped = false;
let mapIdleTimer;
let currentRegionName = "Regional View";
let currentActivePopup = null;
let plottedMarkersCache = [];
const MIN_DISTANCE_THRESHOLD = 0.25;

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

    map.on('click', async (e) => {
        if (isMarkerClick) { isMarkerClick = false; return; }

        const popup = L.popup({ offset: [0, -5], className: 'custom-glass-wrapper' })
            .setLatLng(e.latlng)
            .setContent('<div class="glass-popup empty-state"><h3>📡 Analyzing ML data...</h3></div>')
            .openOn(map);

        try {
            const season = document.getElementById('season-filter')?.value || getCurrentSeason();
            const res = await fetch(`/api/v1/predict?lat=${e.latlng.lat}&lon=${e.latlng.lng}&region=Local Sector&season=${season}`);
            const data = await res.json();
            
            if (data.predictions && data.predictions[0]) {
                let clickRegionName = null; 
                try {
                    const currentZoom = map.getZoom();
                    let nomZoom = 10;
                    if (currentZoom < 5) nomZoom = 3; else if (currentZoom < 7) nomZoom = 5; else if (currentZoom < 9) nomZoom = 8;
                    
                    const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${e.latlng.lat}&lon=${e.latlng.lng}&zoom=${nomZoom}`);
                     
                    if (geoRes.ok) {
                        const geoData = await geoRes.json();
                        const dispName = (geoData.display_name || "").toLowerCase();
                        const waterTerms = ["sea", "ocean", "gulf", "marine", "bay", "sound", "st. lawrence", "strait", "channel", "water"];
                        const isWaterText = waterTerms.some(term => dispName.includes(term));
                        
                        if (geoData.lat && geoData.lon) {
                            const snapDist = Math.hypot(e.latlng.lat - parseFloat(geoData.lat), e.latlng.lng - parseFloat(geoData.lon));
                            if (snapDist > 0.01 || isWaterText) {
                                popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                                return;
                            }
                        }

                        const isWaterMetadata = (geoData.class === 'natural' && geoData.type === 'water') || 
                                                geoData.class === 'waterway' || geoData.type === 'sea' || 
                                                (geoData.address && (geoData.address.sea || geoData.address.ocean || geoData.address.water));
                        
                        if (isWaterMetadata) {
                            popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                            return;
                        }

                        if (geoData.address) {
                            const addr = geoData.address;
                            clickRegionName = addr.municipality || addr.town || addr.village || addr.county || addr.district || addr.city || addr.state || addr.country || "Regional Sector";
                        }
                    }
                } catch (err) {
                    console.warn("Click geocode failed.");
                }

                if (!clickRegionName) {
                    popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                    return;
                }

                data.predictions[0].locality = clickRegionName;
                popup.setContent(buildPopupCard(data.predictions[0], e.latlng.lat, e.latlng.lng));

            } else {
                popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
            }
        } catch (err) {
            popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
        }
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (!query) return;

                try {
                    const params = new URLSearchParams({
                        q: query,
                        format: 'json',
                        limit: 1
                    });
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

    const boxCenterLat = southLat + (latSpan / 2);
    const boxCenterLon = westLon + (lonSpan / 2);

    const latDeadzone = latSpan / 5;
    const lonDeadzone = lonSpan / 5;

    let v = "", h = "";

    if (targetLat > boxCenterLat + latDeadzone) v = "North";
    else if (targetLat < boxCenterLat - latDeadzone) v = "South";

    if (targetLon > boxCenterLon + lonDeadzone) h = "East";
    else if (targetLon < boxCenterLon - lonDeadzone) h = "West";

    if (v && h) return `${v}${h.toLowerCase()}ern `;
    if (v || h) return `${v || h}ern `;
    return "Central ";
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
        <div class="glass-popup">
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
    const bounds = map.getBounds();
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    const currentZoom = map.getZoom();

    const s = bounds.getSouth().toFixed(4);
    const w = bounds.getWest().toFixed(4);
    const n = bounds.getNorth().toFixed(4);
    const e = bounds.getEast().toFixed(4);

    let rawPoints = [];
    const waterTerms = ["sea", "ocean", "gulf", "marine", "bay", "sound", "st. lawrence", "strait", "channel"];

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); 

        let nodeLimit = currentZoom < 6 ? 15 : (currentZoom >= 10 ? 25 : 20);
        let placeFilter = currentZoom < 6 ? "country|state|city" : "city|town|village|municipality";

        const query = `[out:json][timeout:8];node["place"~"${placeFilter}"](${s},${w},${n},${e});out ${nodeLimit};`;
        const overpassRes = await fetch(`/api/v1/overpass-proxy?data=${encodeURIComponent(query)}`, {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (overpassRes.ok) {
            const cityData = await overpassRes.json();
            if (cityData.elements && cityData.elements.length > 0) {
                cityData.elements.forEach(city => {
                    const placeName = city.tags['name:en'] || city.tags.name || "Regional Sector";
                    
                    if (!waterTerms.some(term => placeName.toLowerCase().includes(term))) {
                        rawPoints.push({
                            lat: parseFloat(city.lat),
                            lon: parseFloat(city.lon),
                            name: placeName
                        });
                    }
                });
            }
        }
    } catch (err) {
        console.warn("Overpass API unavailable. Triggering strict grid scan.");
    }

    if (rawPoints.length === 0) {
        const latStep = (bounds.getNorth() - bounds.getSouth()) / 3;
        const lonStep = (bounds.getEast() - bounds.getWest()) / 3;
        
        const fallbackPoints = [];
        for (let i = 1; i <= 2; i++) {
            for (let j = 1; j <= 2; j++) {
                fallbackPoints.push({ lat: bounds.getSouth() + (latStep * i), lon: bounds.getWest() + (lonStep * j) });
            }
        }
        fallbackPoints.push({ lat: bounds.getCenter().lat, lon: bounds.getCenter().lng });

        for (const pt of fallbackPoints) {
            try {
                const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${pt.lat}&lon=${pt.lon}&zoom=10`);
                if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    
                    if (geoData.error || !geoData.address) continue;

                    const isWaterMetadata = (geoData.class === 'natural' && geoData.type === 'water') || 
                                            geoData.class === 'waterway' || geoData.type === 'sea' || 
                                            geoData.address.sea || geoData.address.ocean || geoData.address.water;
                    if (isWaterMetadata) continue;

                    const dispName = (geoData.display_name || "").toLowerCase();
                    if (waterTerms.some(term => dispName.includes(term))) continue;

                    let plotLat = pt.lat;
                    let plotLon = pt.lon;
                    if (geoData.lat && geoData.lon) {
                        plotLat = parseFloat(geoData.lat);
                        plotLon = parseFloat(geoData.lon);
                        const snapDist = Math.hypot(pt.lat - plotLat, pt.lon - plotLon);
                        if (snapDist > 0.02) continue; 
                    }
                    
                    const regionName = geoData.address.municipality || geoData.address.town || geoData.address.village || geoData.address.county || geoData.address.city || "Regional Sector";
                    
                    rawPoints.push({ lat: plotLat, lon: plotLon, name: regionName });
                }
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (err) {
                console.warn("Fallback point dropped.");
            }
        }
    }

    let predictionsList = [];
    for (const pt of rawPoints) {
        try {
            const url = `/api/v1/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent(pt.name)}&season=${season}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                
                if (data.predictions && data.predictions.length > 0 && parseInt(data.predictions[0].probability_percentage) >= 30) {
                    predictionsList.push({
                        ...pt,
                        threat: data.predictions[0]
                    });
                }
            }
        } catch (err) {
            console.warn(`ML API failed for: ${pt.lat}, ${pt.lon}`);
        }
    }

    predictionsList.sort((a, b) => parseInt(b.threat.probability_percentage) - parseInt(a.threat.probability_percentage));

    let dedupeDistance = 0.25; 
    if (currentZoom < 6) dedupeDistance = 1.2; 
    else if (currentZoom < 8) dedupeDistance = 0.7; 
    else if (currentZoom >= 10) dedupeDistance = 0.1; 

    for (const pt of predictionsList) {
        let isDuplicate = false;
        let overlapOffset = 0; 

        for (const cachedPt of plottedMarkersCache) {
            const distance = Math.hypot(pt.lat - cachedPt.lat, pt.lon - cachedPt.lon);
            
            if (distance < dedupeDistance && cachedPt.type === pt.threat.disaster_type) {
                isDuplicate = true;
                break;
            }
            
            if (distance < 0.02) {
                overlapOffset += 0.015;
            }
        }

        if (!isDuplicate) {
            let finalLat = pt.lat + overlapOffset;
            plottedMarkersCache.push({ lat: finalLat, lon: pt.lon, type: pt.threat.disaster_type, name: pt.name });
            plotDynamicMarker(finalLat, pt.lon, pt.threat, pt.name);
        }
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