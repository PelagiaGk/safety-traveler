let map;
let markersClusterGroup; 
let isMarkerClick = false;
let overpassCircuitTripped = false;
let mapIdleTimer;
let currentRegionName = "Regional View";

const plottedMarkersCache = [];
const MIN_DISTANCE_THRESHOLD = 0.25; 

document.addEventListener("DOMContentLoaded", () => {
    if (map !== undefined && map !== null) {
        map.remove();
    }

    map = L.map('map').setView([38.0, 24.0], 6); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    markersClusterGroup = L.featureGroup().addTo(map); 

    map.on('dragstart', resetSidebar);
    map.on('zoomstart', resetSidebar);

    map.on('moveend', () => {
        isMarkerClick = false; 
        clearTimeout(mapIdleTimer);
        
        mapIdleTimer = setTimeout(() => {
            const center = map.getBounds().getCenter();
            updateSidebarRegion(center.lat, center.lng);
            scanVisibleArea();
        }, 1500); 
    });

    setTimeout(() => {
        const center = map.getBounds().getCenter();
        updateSidebarRegion(center.lat, center.lng);
        scanVisibleArea();
    }, 500);
});

function resetSidebar() {
    if (!isMarkerClick) { 
        const panel = document.getElementById('info-panel');
        if (panel.innerHTML.includes("Season:")) { 
             panel.innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Scanning new area...</p></div>';
        }
    }
}

function getCurrentSeason() {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return "Spring";
    if (month >= 5 && month <= 7) return "Summer";
    if (month >= 8 && month <= 10) return "Autumn";
    return "Winter";
}

function getCompassDirection(lat, lon, boundingbox) {
    if (!boundingbox || boundingbox.length < 4) return "";
    const latMin = parseFloat(boundingbox[0]);
    const latMax = parseFloat(boundingbox[1]);
    const lonMin = parseFloat(boundingbox[2]);
    const lonMax = parseFloat(boundingbox[3]);

    if (latMax - latMin < 0.001 || lonMax - lonMin < 0.001) return "";

    const latThird = (latMax - latMin) / 3;
    const lonThird = (lonMax - lonMin) / 3;

    let v = "", h = "";
    if (lat >= latMax - latThird) v = "North";
    else if (lat <= latMin + latThird) v = "South";

    if (lon >= lonMax - lonThird) h = "East";
    else if (lon <= lonMin + lonThird) h = "West";

    if (v && h) return `${v}${h.toLowerCase()} `;
    if (v || h) return `${v || h} `;
    return "Central ";
}

function displayDetails(data) {
    const panel = document.getElementById('info-panel');
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    
    panel.innerHTML = `
        <div class="info-card ${data.risk_level}">
            <h3>📍 ${data.locality}</h3>
            <p><strong>Season:</strong> ${season}</p>
            <hr>
            <p><strong>${data.emoji} Seasonal Advisory: ${data.risk_level.charAt(0).toUpperCase() + data.risk_level.slice(1)} probability of ${data.disaster_type}.</strong></p>
            <div class="reason-box">
                <p><strong>Reason:</strong> ${data.primary_reason}</p>
                <p><strong>PRECAUTIONS:</strong></p>
                <ul>
                    ${data.dynamic_precautions.map(p => `<li>${p}</li>`).join('')}
                </ul>
            </div>
        </div>
    `;
}

async function updateSidebarRegion(lat, lon) {
    const panel = document.getElementById('info-panel');
    if (panel.innerHTML.includes("Season:")) return; 

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=8&accept-language=en`);
        if (res.ok) {
            const data = await res.json();
            if (data.address) {
                let baseName = data.address.sea || data.address.ocean || data.address.county || data.address.state_district || data.address.state || "Uncharted Marine Sector";
                
                let prefix = getCompassDirection(lat, lon, data.boundingbox);
                currentRegionName = prefix + baseName;
            } else {
                currentRegionName = "Marine Sector";
            }
        }
    } catch (err) {
        currentRegionName = "Regional View"; 
    }

    if (!panel.innerHTML.includes("Season:")) {
        panel.innerHTML = `<div class="info-card low"><h3>🌍 ${currentRegionName}</h3><p>Select a marker in this area to view detailed local forecasts.</p></div>`;
    }
}

async function scanVisibleArea() {
    const bounds = map.getBounds();
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    const panel = document.getElementById('info-panel');
    
    if (!panel.innerHTML.includes("📍") && !panel.innerHTML.includes("Season:")) {
        panel.innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Scanning live ML forecasts...</p></div>';
    }

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

            const query = `[out:json][timeout:2];node["place"~"city|town"](${s},${w},${n},${e});out 8;`;
            const overpassRes = await fetch(`https://overpass-api.de/api/interpreter`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `data=${encodeURIComponent(query)}`,
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
                } 
                else if (geoData.address && (geoData.address.sea || geoData.address.ocean || geoData.address.water)) {
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
        console.warn("All external APIs failed. Forcing scan.");
        rawPoints.push({
            lat: parseFloat(center.lat),
            lon: parseFloat(center.lng),
            name: "Unresolved Region (API Offline)"
        });
    }

    const thinnedPoints = [];
    for (const pt of rawPoints) {
        let isTooClose = thinnedPoints.some(tPt => Math.sqrt(Math.pow(pt.lat - tPt.lat, 2) + Math.pow(pt.lon - tPt.lon, 2)) < 0.05); 
        if (!isTooClose) thinnedPoints.push(pt);
    }

    for (const pt of thinnedPoints) {
        try {
            const url = `/api/v1/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent(pt.name)}&season=${season}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
                    const topThreat = data.predictions[0];
                    
                    let isTooClose = false;
                    for (const cachedPt of plottedMarkersCache) {
                        if (cachedPt.type === topThreat.disaster_type) {
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
                             if (Math.abs(pt.lat - cachedPt.lat) < 0.02 && Math.abs(pt.lon - cachedPt.lon) < 0.02) {
                                 finalLat += 0.025; 
                                 finalLon += 0.025; 
                                 break;
                             }
                        }
                        
                        plottedMarkersCache.push({ lat: finalLat, lon: finalLon, type: topThreat.disaster_type }); 
                        plotDynamicMarker(finalLat, finalLon, topThreat, pt.name);
                    }
                }
            }
        } catch (err) {
            console.warn(`ML API failed for: ${pt.lat}, ${pt.lon}`);
        }
    }

    if (!panel.innerHTML.includes("📍") && !panel.innerHTML.includes("Season:")) {
        panel.innerHTML = `<div class="info-card low"><h3>🌍 ${currentRegionName}</h3><p>Select a marker in this area to view detailed local forecasts.</p></div>`;
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
        html: `<div style="background: white;
        border-radius: 50%;
        width: 28px;
        height: 28px; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        font-size: 16px; 
        border: 3px solid ${borderColor}; 
        box-shadow: 0 2px 5px rgba(0,0,0,0.15); 
        cursor: pointer;" 
        title="Regional Alert: ${probability}% ${topThreat.disaster_type}">${emoji}</div>`,
        className: '', iconSize: [28, 28], iconAnchor: [14, 14]
    });

    const marker = L.marker([lat, lon], { icon: icon, customRisk: risk, customEmoji: emoji });
    
    marker.on('click', async () => {
        isMarkerClick = true;
        map.flyTo([lat, lon], 11, { duration: 1.2 }); 
        
        displayDetails({
            locality: "⏳ Resolving Region...", 
            disaster_type: topThreat.disaster_type,
            risk_level: risk,
            emoji: emoji,
            primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type} in the surrounding area.`,
            dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
        });

        let finalName = cityName;
        let directionPrefix = "";
        
        try {
            await new Promise(resolve => setTimeout(resolve, 1300));

            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`);
            
            if (geo.ok) {
                const geoData = await geo.json();
                if (geoData.address) {
                    finalName = geoData.address.county || geoData.address.municipality || geoData.address.state_district || geoData.address.state || finalName;
                    
                    directionPrefix = getCompassDirection(lat, lon, geoData.boundingbox);
                }
            }
        } catch (err) {
            console.warn("Failed to resolve regional name on click. Using fallback.");
        } 

        displayDetails({
            locality: `${directionPrefix}${finalName} (Radius)`, 
            disaster_type: topThreat.disaster_type,
            risk_level: risk,
            emoji: emoji,
            primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type} in the surrounding area.`,
            dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
        });
    });

    markersClusterGroup.addLayer(marker);
}