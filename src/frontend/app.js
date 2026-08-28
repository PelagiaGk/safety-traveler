let map;
let markersClusterGroup;
let isMarkerClick = false;
let overpassCircuitTripped = false;
let mapIdleTimer;
let currentRegionName = "Regional View";
let currentActivePopup = null;

const plottedMarkersCache = [];
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
            .setContent('<div class="glass-popup empty-state"><h3>📡 Analyzing coordinates...</h3></div>')
            .openOn(map);

        try {
            const currentZoom = map.getZoom();
            let nomZoom = 10;
            if (currentZoom < 5) nomZoom = 3; else if (currentZoom < 7) nomZoom = 5; else if (currentZoom < 9) nomZoom = 8;
            
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}&zoom=${nomZoom}&accept-language=en`, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'Public-Safety-Dashboard/1.0' }
            });
            
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                
                if (geoData.address && (geoData.address.ocean || geoData.address.sea || geoData.address.water)) {
                    popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                    return;
                }

                const season = document.getElementById('season-filter')?.value || getCurrentSeason();
                const res = await fetch(`/api/v1/predict?lat=${e.latlng.lat}&lon=${e.latlng.lng}&region=Local Sector&season=${season}`);
                const data = await res.json();
                
                if (data.predictions && data.predictions[0] && parseInt(data.predictions[0].probability_percentage) >= 30) {
                    let clickRegionName = "Local Sector";
                    if (geoData.address) {
                        const addr = geoData.address;
                        let baseName = addr.county || addr.district || addr.city || addr.state || addr.country || "Local Sector";
                        const prefix = getCompassDirection(e.latlng.lat, e.latlng.lng, geoData);
                        clickRegionName = prefix + baseName;
                    }

                    popup.close();
                    plotDynamicMarker(e.latlng.lat, e.latlng.lng, data.predictions[0], clickRegionName);
                } else {
                    popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                }
            } else {
                popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
            }
        } catch (err) {
            popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
        }
    });

    map.on('moveend', () => {
        isMarkerClick = false;
        clearTimeout(mapIdleTimer);

        mapIdleTimer = setTimeout(() => {
            const center = map.getBounds().getCenter();
            updateRegionMeta(center.lat, center.lng);
            scanVisibleArea();
        }, 1500);
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

    setTimeout(() => {
        const center = map.getBounds().getCenter();
        updateRegionMeta(center.lat, center.lng);
        scanVisibleArea();
    }, 500);
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
    const precautionsList = data.dynamic_precautions && data.dynamic_precautions.length > 0 
        ? data.dynamic_precautions.map(p => `<li>${p}</li>`).join('')
        : `<li>Monitor local meteorological bulletins and regional safety warnings.</li>`;

    return `
        <div class="glass-popup">
            <h2>${data.locality}</h2>
            <p class="season-tag">Season: <strong>${season}</strong></p>
            <div class="advisory-section">
                <p><strong>Seasonal Advisory:</strong> ${data.risk_level.charAt(0).toUpperCase() + data.risk_level.slice(1)} probability of ${data.disaster_type}.</p>
                <p><strong>Reason:</strong> ${data.primary_reason}</p>
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

    const s = bounds.getSouth().toFixed(4);
    const w = bounds.getWest().toFixed(4);
    const n = bounds.getNorth().toFixed(4);
    const e = bounds.getEast().toFixed(4);

    let rawPoints = [];
    let isOcean = false;
    let apiOffline = false;

    if (!overpassCircuitTripped) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const currentZoom = map.getZoom();
            let placeFilter = "city|town|country|state"; 
            let nodeLimit = 40;

            if (currentZoom < 6) {
                placeFilter = "country|state";
                nodeLimit = 15;
            } else if (currentZoom >= 10) {
                placeFilter = "city|town|village";
                nodeLimit = 20;
            }

            const query = `[out:json][timeout:5];node["place"~"${placeFilter}"](${s},${w},${n},${e});out ${nodeLimit};`;
            const overpassRes = await fetch(`/api/v1/overpass-proxy?data=${encodeURIComponent(query)}`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (overpassRes.ok) {
                const cityData = await overpassRes.json();
                if (cityData.elements && cityData.elements.length > 0) {
                    cityData.elements.forEach(city => {
                        rawPoints.push({
                            lat: parseFloat(city.lat),
                            lon: parseFloat(city.lon),
                            name: city.tags['name:en'] || city.tags.name || "Regional Sector"
                        });
                    });
                }
            } else {
                apiOffline = true;
            }
        } catch (err) {
            overpassCircuitTripped = true;
            apiOffline = true;
            setTimeout(() => { overpassCircuitTripped = false; }, 60000);
        }
    } else {
        apiOffline = true;
    }

    if (rawPoints.length === 0) {
        const center = bounds.getCenter();
        try {
            const geoCheck = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}&zoom=10`);
            if (geoCheck.ok) {
                apiOffline = false;
                const geoData = await geoCheck.json();

                if (geoData.address && (geoData.address.county || geoData.address.municipality || geoData.address.city || geoData.address.state_district)) {
                    rawPoints.push({
                        lat: parseFloat(center.lat),
                        lon: parseFloat(center.lng),
                        name: geoData.address.county || geoData.address.municipality || "Regional Sector"
                    });
                } else if (geoData.address && (geoData.address.sea || geoData.address.ocean || geoData.address.water)) {
                    isOcean = true;
                }
            } else {
                apiOffline = true;
            }
        } catch (err) {
            apiOffline = true;
        }
    }

    if (rawPoints.length === 0 && apiOffline && !isOcean) {
        const center = bounds.getCenter();
        rawPoints.push({
            lat: parseFloat(center.lat),
            lon: parseFloat(center.lng),
            name: "Unresolved Region (API Offline)"
        });
    }

    let predictionsList = [];
    for (const pt of rawPoints) {
        try {
            const url = `/api/v1/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent(pt.name)}&season=${season}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
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

    for (const pt of predictionsList) {
        let isTooClose = false;

        for (const cachedPt of plottedMarkersCache) {
            if (cachedPt.type === pt.threat.disaster_type) {
                const distance = Math.sqrt(Math.pow(pt.lat - cachedPt.lat, 2) + Math.pow(pt.lon - cachedPt.lon, 2));
                if (distance < MIN_DISTANCE_THRESHOLD) {
                    isTooClose = true;
                    break;
                }
            }
        }

        if (!isTooClose) {
            let finalLat = pt.lat;
            let finalLon = pt.lon;

            for (const cachedPt of plottedMarkersCache) {
                if (Math.abs(finalLat - cachedPt.lat) < 0.02 && Math.abs(finalLon - cachedPt.lon) < 0.02) {
                    finalLat += 0.025;
                    finalLon += 0.025;
                    break;
                }
            }

            plottedMarkersCache.push({ lat: finalLat, lon: finalLon, type: pt.threat.disaster_type });
            plotDynamicMarker(finalLat, finalLon, pt.threat, pt.name);
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