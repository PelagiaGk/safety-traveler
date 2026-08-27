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

    const worldBounds = [
        [-90, -180], 
        [90, 180]    
    ];

    map = L.map('map', {
        maxBounds: worldBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 3 
    }).setView([38.0, 24.0], 6); 
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        minZoom: 3,       
        noWrap: true,
        bounds: worldBounds 
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

function getCompassDirection(lat, lon, geoData) {
    if (!geoData || !geoData.boundingbox || geoData.boundingbox.length < 4) return "";

    const targetLat = parseFloat(lat);
    const targetLon = parseFloat(lon);

    const southLat = parseFloat(geoData.boundingbox[0]);
    const northLat = parseFloat(geoData.boundingbox[1]);
    const westLon  = parseFloat(geoData.boundingbox[2]);
    const eastLon  = parseFloat(geoData.boundingbox[3]);

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

    const currentZoom = map.getZoom();
    let nomZoom = 10; 
    if (currentZoom < 5) nomZoom = 3;      
    else if (currentZoom < 7) nomZoom = 5; 
    else if (currentZoom < 9) nomZoom = 8; 

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${nomZoom}&accept-language=en`);
        if (res.ok) {
            const data = await res.json();
            if (data.address) {
                const addr = data.address; 
                let baseName = "Uncharted Sector";

                if (currentZoom < 5) {
                    baseName = addr.country || "International Space";
                } else if (currentZoom < 7) {
                    baseName = addr.state || addr.region || addr.province || addr.country || "Regional Sector";
                } else {
                    baseName = addr.county || addr.district || addr.state_district || addr.municipality || addr.city || addr.state || addr.country || "Local Sector";
                }

                if (addr.ocean || addr.sea || addr.water) {
                    baseName = addr.ocean || addr.sea || addr.water;
                }
                
                let prefix = getCompassDirection(lat, lon, data);
                currentRegionName = prefix + baseName;
            } else {
                currentRegionName = "Marine Sector";
            }
        }
    } catch (err) {
        currentRegionName = "Regional View"; 
    }

    if (!panel.innerHTML.includes("Season:")) {
        panel.innerHTML = `
            <div class="info-card low">
                <h3>🌍 ${currentRegionName}</h3>
                <p>Select a marker in this area to view detailed local forecasts.</p>
            </div>`;
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

            const currentZoom = map.getZoom();
            let placeFilter = "city|town";
            let nodeLimit = 25;

            if (currentZoom < 7) {
                placeFilter = "city"; 
                nodeLimit = 35;       
            } else if (currentZoom >= 10) {
                placeFilter = "city|town|village"; 
                nodeLimit = 15;
            }

            const formData = new URLSearchParams();
            formData.append("data", query);

            const overpassRes = await fetch(`https://overpass.openstreetmap.fr/api/interpreter`, {
                method: 'POST',
                body: formData,
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

            const naturalDisasters = ["Wildfire", "Flood", "Earthquake", "Drought"];
            if (naturalDisasters.includes(pt.threat.disaster_type)) {
                const offset = (pt.name.length % 5 + 2) * 0.003; 
                const direction = pt.name.length % 4; 
                
                if (direction === 0) finalLat += offset;      
                else if (direction === 1) finalLon += offset; 
                else if (direction === 2) finalLat -= offset; 
                else finalLon -= offset;                      
            }

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