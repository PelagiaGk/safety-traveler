let map;
let markersClusterGroup;
let isMarkerClick = false;
let scanTimeout = null;
let overpassCircuitTripped = false; 
const plottedMarkersCache = [];
const MIN_DISTANCE_THRESHOLD = 0.25;
let currentRegionName = "Regional View";

async function updateSidebarRegion(lat, lon) {
    const panel = document.getElementById('info-panel');
    
    if (panel.innerHTML.includes("Season:")) return; 

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`);
        if (res.ok) {
            const data = await res.json();
            if (data.address) {
                currentRegionName = data.address.county || data.address.municipality || data.address.state_district || data.address.state || "Regional View";
            } else {
                currentRegionName = "Marine / Uncharted Sector";
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

function getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    if (month >= 9 && month <= 11) return 'Autumn';
    return 'Winter';
}

async function initApp() {
    const bounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));
    map = L.map('map', { center: [39.0, 22.0], zoom: 6, minZoom: 3, maxBounds: bounds });
    map.on('dragstart', resetSidebar);
    map.on('zoomstart', resetSidebar);

    function resetSidebar() {
        if (!isMarkerClick) { 
            const panel = document.getElementById('info-panel');
            if (panel.innerHTML.includes("Season:")) { 
                panel.innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Scanning new area...</p></div>';
            }
        }
    }
    map.on('moveend', () => {
        isMarkerClick = false; 
    });
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap, © CARTO', noWrap: true, bounds: bounds
    }).addTo(map);

    markersClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50, 
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 12,
        iconCreateFunction: function(cluster) {
            const children = cluster.getAllChildMarkers();
            let highestRisk = 'low';
            let dominantEmoji = '⚠️';
            let maxScore = 0;
            const riskScores = { 'low': 1, 'medium': 2, 'high': 3 };
            
            children.forEach(marker => {
                const r = marker.options.customRisk || 'low';
                const score = riskScores[r] || 1;
                if (score > maxScore) { maxScore = score; highestRisk = r; dominantEmoji = marker.options.customEmoji; }
            });

            const borderColor = highestRisk === 'high' ? '#ef4444' : highestRisk === 'medium' ? '#f59e0b' : '#10b981';
            return L.divIcon({
                html: `<div style="width: 38px; 
                height: 38px; 
                font-size: 20px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                background: white; 
                border-radius: 50%; 
                border: 3px solid ${borderColor}; 
                position: relative; 
                box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
                          ${dominantEmoji}
                          <span style="position: absolute; 
                          top: -6px; 
                          right: -6px; 
                          background: #334155; 
                          color: white; 
                          border-radius: 50%; 
                          font-size: 11px; 
                          font-weight: bold; 
                          padding: 2px 5px; 
                          border: 2px solid white;">${children.length}</span>
                       </div>`,
                className: 'custom-cluster-wrap', iconSize: [38, 38], iconAnchor: [19, 19]
            });
        }
    });
    map.addLayer(markersClusterGroup);

    map.on('moveend', () => {
        if (isMarkerClick) { isMarkerClick = false; return; }
        
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => { scanVisibleArea(); }, 600); 
    });

    document.getElementById('season-filter').addEventListener('change', () => {
        scanVisibleArea();
    });

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    if (searchInput) {
        searchInput.addEventListener('keypress', handleSearch);
    }
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            handleSearch({ key: 'Enter', target: searchInput });
        });
    }    

    scanVisibleArea();
}

async function scanVisibleArea() {
    const bounds = map.getBounds();
    const season = document.getElementById('season-filter').value || getCurrentSeason();
    const panel = document.getElementById('info-panel');
    
    if (!panel.innerHTML.includes("📍")) {
        panel.innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Scanning live ML forecasts...</p></div>';
    }

    const s = bounds.getSouth().toFixed(4);
    const w = bounds.getWest().toFixed(4);
    const n = bounds.getNorth().toFixed(4);
    const e = bounds.getEast().toFixed(4);

    let rawPoints = [];
    let apiSucceeded = false;

    if (!overpassCircuitTripped) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); 

            const query = `[out:json][timeout:2];node["place"~"city|town"](${s},${w},${n},${e});out 8;`;
            const overpassRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (overpassRes.ok) {
                apiSucceeded = true; 
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
            }
        } catch (err) {
            overpassCircuitTripped = true;
            setTimeout(() => { overpassCircuitTripped = false; }, 60000); 
        }
    }

    if (!apiSucceeded && rawPoints.length === 0) {
        const center = bounds.getCenter();
        
        try {
            const geoCheck = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}&zoom=10`);
            const geoData = await geoCheck.json();
            
            if (!geoData.error) {
                rawPoints.push({ 
                    lat: parseFloat(center.lat), 
                    lon: parseFloat(center.lng), 
                    name: geoData.address.county || geoData.address.municipality || "Regional Sector" 
                });
            } else {
                console.log("Fallback aborted: Center point is over water or invalid.");
            }
        } catch (err) {
            console.warn("Complete network failure. Aborting scan.");
        }
    }

    const validNewPoints = [];
    for (const pt of rawPoints) {
        let isTooClose = false;
        
        for (const cachedPt of plottedMarkersCache) {
            const distance = Math.sqrt(Math.pow(pt.lat - cachedPt.lat, 2) + Math.pow(pt.lon - cachedPt.lon, 2));
            if (distance < MIN_DISTANCE_THRESHOLD) {
                isTooClose = true;
                break;
            }
        }

        if (!isTooClose) {
            validNewPoints.push(pt);
            plottedMarkersCache.push({ lat: pt.lat, lon: pt.lon }); 
        }
    }

    for (const pt of validNewPoints) {
        try {
            const url = `/api/v1/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent(pt.name)}&season=${season}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
                    plotDynamicMarker(pt.lat, pt.lon, data.predictions[0], pt.name);
                }
            }
        } catch (err) {
            console.warn(`ML API failed for: ${pt.lat}, ${pt.lon}`);
        }
    }

    const center = bounds.getCenter();
    updateSidebarRegion(center.lat, center.lng);
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
        cursor: pointer;" title="Regional Alert: ${probability}% ${topThreat.disaster_type}">${emoji}</div>`,
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
            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`);
            const geoData = await geo.json();
            
            if (geoData.address) {
                finalName = geoData.address.county || geoData.address.municipality || geoData.address.state_district || geoData.address.state || finalName;
                
                if (geoData.boundingbox) {
                    const latMin = parseFloat(geoData.boundingbox[0]);
                    const latMax = parseFloat(geoData.boundingbox[1]);
                    const lonMin = parseFloat(geoData.boundingbox[2]);
                    const lonMax = parseFloat(geoData.boundingbox[3]);

                    const latThird = (latMax - latMin) / 3;
                    const lonThird = (lonMax - lonMin) / 3;

                    let v = ""; 
                    let h = "";

                    if (lat >= latMax - latThird) v = "North";
                    else if (lat <= latMin + latThird) v = "South";

                    if (lon >= lonMax - lonThird) h = "East";
                    else if (lon <= lonMin + lonThird) h = "West";

                    
                    if (v && h) {
                        directionPrefix = `${v}${h.toLowerCase()} `;
                    } else if (v || h) {
                        directionPrefix = `${v || h} `;
                    } else {
                        directionPrefix = "Central ";
                    }
                }
            }
        } catch (err) {
            console.warn("Failed to resolve regional name.");
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

async function handleSearch(event) {
    if (event.key === 'Enter') {
        const query = event.target.value.trim();
        if (!query) return;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);
                map.flyTo([lat, lon], 10, { duration: 1.5 });
            }
        } catch (err) { console.error("Search failed"); }
    }
}

function displayDetails(props) {
    const season = document.getElementById('season-filter').value || getCurrentSeason();
    document.getElementById('info-panel').innerHTML = `
        <div class="info-card ${props.risk_level}">
            <h3>📍 ${props.locality}</h3>
            <p><strong>Season:</strong> ${season}</p>
            <p style="color: ${props.risk_level === 'high' ? '#dc3545' : props.risk_level === 'medium' ? '#d97706' : '#28a745'};">
                <strong>⚠️ Seasonal Advisory: ${props.risk_level.charAt(0).toUpperCase() + props.risk_level.slice(1)} probability of ${props.disaster_type}.</strong>
            </p>
            <div style="margin-top: 15px; background: #fff5f5; padding: 12px; border-radius: 6px; border: 1px solid #ffc9c9;">
                <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Reason:</strong> ${props.primary_reason}</p>
                <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Precautions:</p>
                <ul style="padding-left: 18px; margin: 0; font-size: 13px;">${props.dynamic_precautions.map(t => `<li>${t}</li>`).join('')}</ul>
            </div>
        </div>`;
}

document.addEventListener('DOMContentLoaded', initApp);