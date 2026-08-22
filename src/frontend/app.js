let map;
let markersClusterGroup;
let allDisasterData = [];
let debounceTimer;
let isMarkerClick = false;

function getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    if (month >= 9 && month <= 11) return 'Autumn';
    return 'Winter';
}

async function initApp() {
    
    const defaultCenter = [39.0, 22.0];
    const bounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));

    map = L.map('map', {
        center: defaultCenter,
        zoom: 5,
        minZoom: 3,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors, © CARTO',
        noWrap: true,
        bounds: bounds
    }).addTo(map);

    setTimeout(() => { map.invalidateSize(); }, 300);
    window.addEventListener('resize', () => { map.invalidateSize(); });

    await fetchAllDisasters();

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                map.setView([pos.coords.latitude, pos.coords.longitude], 8);
                triggerAreaPrediction(pos.coords.latitude, pos.coords.longitude);
            },
            () => { triggerAreaPrediction(defaultCenter[0], defaultCenter[1]); }
        );
    }

    map.on('moveend', () => {
        if (isMarkerClick) {
            isMarkerClick = false; 
            return; 
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { scanCurrentMapArea(); }, 800);
    });

    scanCurrentMapArea();

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && searchInput.value.trim()) {
            await searchLocation(searchInput.value.trim());
        }
    });

    document.getElementById('season-filter').addEventListener('change', () => {
        renderMarkers();
        if (map.getZoom() >= 6) {
            const center = map.getCenter();
            triggerAreaPrediction(center.lat, center.lng);
        }
    });
}

async function scanCurrentMapArea() {
    const bounds = map.getBounds();
    const season = document.getElementById('season-filter').value || getCurrentSeason();
    
    const latStep = (bounds.getNorth() - bounds.getSouth()) / 4;
    const lonStep = (bounds.getEast() - bounds.getWest()) / 4;

    document.getElementById('info-panel').innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Scanning regional ML forecasts...</p></div>';

    const fetchPromises = [];
    for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
            const lat = (bounds.getSouth() + (i * latStep)).toFixed(4);
            const lon = (bounds.getWest() + (j * lonStep)).toFixed(4);
            const url = `/api/v1/predict?lat=${lat}&lon=${lon}&season=${season}`;
            
            fetchPromises.push(
                fetch(url).then(res => res.json()).then(data => ({ lat, lon, data })).catch(() => null)
            );
        }
    }

    const results = (await Promise.all(fetchPromises)).filter(r => r && r.data && r.data.predictions);
    renderDynamicMarkers(results, season);
}

function renderDynamicMarkers(gridResults, activeSeason) {
    if (markersClusterGroup) map.removeLayer(markersClusterGroup);

    markersClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50, 
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: 10,
        iconCreateFunction: function(cluster) {
            const children = cluster.getAllChildMarkers();
            let highestRisk = 'low';
            let dominantEmoji = '⚠️';
            const riskScores = { 'low': 1, 'medium': 2, 'high': 3 };
            
            children.forEach(m => {
                if (riskScores[m.options.customRisk] > (riskScores[highestRisk] || 0)) {
                    highestRisk = m.options.customRisk;
                    dominantEmoji = m.options.customEmoji;
                }
            });

            return L.divIcon({
                html: `<div class="cluster-emoji-badge risk-${highestRisk}" style="width: 38px; height: 38px; font-size: 20px;">
                          ${dominantEmoji}<span class="cluster-count">${children.length}</span>
                       </div>`,
                className: 'custom-cluster-wrap', iconSize: [38, 38], iconAnchor: [19, 19]
            });
        }
    });

    gridResults.forEach(cell => {
        const topThreatData = cell.data.predictions[0];
        if (!topThreatData) return;

        const probability = parseInt(topThreatData.probability_percentage);
        if (probability >= 30) {
            let risk = probability >= 65 ? 'high' : (probability >= 40 ? 'medium' : 'low');
            const emojis = { "Wildfire": "🔥", "Flood": "🌊", "Storm": "🌪️", "Heatwave": "☀️", "Earthquake": "🌋", "Drought": "🏜️" };
            const emoji = emojis[topThreatData.disaster_type] || '⚠️';

            const icon = L.divIcon({
                html: `<div class="emoji-marker risk-${risk}" title="${probability}% ${topThreatData.disaster_type}">${emoji}</div>`,
                className: '', iconSize: [28, 28], iconAnchor: [14, 14]
            });

            const marker = L.marker([cell.lat, cell.lon], { icon: icon, customRisk: risk, customEmoji: emoji });
            
            marker.on('click', () => {
                isMarkerClick = true;
                map.flyTo([cell.lat, cell.lon], 14, { duration: 1.2 });
                displayDetails({
                    locality: "Regional Sector",
                    disaster_type: topThreatData.disaster_type,
                    risk_level: risk,
                    emoji: emoji,
                    primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreatData.disaster_type}.`,
                    dynamic_precautions: ["Monitor local safety warnings."]
                }, cell.lat, cell.lon);
            });

            markersClusterGroup.addLayer(marker);
        }
    });

    map.addLayer(markersClusterGroup);
    document.getElementById('info-panel').innerHTML = '<div class="info-card low"><h3>🌍 Global View</h3><p>Select a region or marker to view detailed local forecasts.</p></div>';
}

async function searchLocation(query) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const results = await res.json();
        if (results && results.length > 0) {
            const { lat, lon } = results[0];
            map.flyTo([parseFloat(lat), parseFloat(lon)], 9);
        }
    } catch (err) { console.error("Geocoding failed", err); }
}

async function triggerAreaPrediction(lat, lon, knownPlaceName = null) {
    const season = document.getElementById('season-filter').value;
    const panel = document.getElementById('info-panel');
    
    panel.innerHTML = '<p>Analyzing area...</p>';
    let placeName = knownPlaceName;

    if (!placeName) {
        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12`);
            const geoData = await geoRes.json();
            
            if (geoData.error) {
                panel.innerHTML = `<div class="info-card low"><h3>🌊 Uncharted Area</h3><p>No active alerts.</p></div>`;
                return;
            }
            
            const addr = geoData.address || {};
            placeName = addr.village || addr.town || addr.suburb || addr.city_district || addr.city || geoData.name || addr.country;
        } catch (e) { placeName = "Selected Area"; }
    }

    let url = `/api/v1/predict?lat=${lat}&lon=${lon}&region=${encodeURIComponent(placeName)}`;
    if (season) url += `&season=${season}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        const bounds = map.getBounds();
        
        let visibleAlerts = [];
        if (markersClusterGroup) {
            markersClusterGroup.eachLayer(layer => {
                if (bounds.contains(layer.getLatLng())) {
                    visibleAlerts.push(layer.feature.properties);
                }
            });
        }

        if (data.predictions) {
            updateSidebar(placeName, data.predictions, season || data.season, visibleAlerts);
        } else if (data.error) {
            updateSidebarNoData(placeName, season || document.getElementById('season-filter').value || "Current", visibleAlerts);
        }
    } catch (err) { console.error("Prediction fetch failed", err); }
}

function updateSidebar(locationTitle, predictions, season, visibleAlerts) {
    const panel = document.getElementById('info-panel');
    let highestRiskPrediction = predictions[0] || { probability_percentage: "0%" };
    let topProbValue = parseInt(highestRiskPrediction.probability_percentage) || 0;

    let alertStatus = "";
    let cardStyle = "low";

    if (visibleAlerts.length > 0) {
        cardStyle = "high";
        alertStatus = `<p style="color: rgb(255, 0, 25);"><strong>⚠️ ${visibleAlerts.length} active emergency alert(s) in view.</strong></p>`;
    } else if (topProbValue >= 50) {
        cardStyle = "medium";
        alertStatus = `<p style="color: #ff8800;"><strong>⚠️ Seasonal Advisory: High probability of ${highestRiskPrediction.disaster_type} (${topProbValue}).</strong></p>`;
    } else {
        alertStatus = `<p style="color: #00ff3c;"><strong>✅ Low seasonal risk profile.</strong></p>`;
    }

    let listHtml = predictions.map(p => `<li>${p.disaster_type}: <strong>${p.probability_percentage}</strong></li>`).join('');

    panel.innerHTML = `
        <div class="info-card ${cardStyle}">
            <h3>📍 ${locationTitle}</h3>
            <p><strong>Season:</strong> ${season}</p>
            ${alertStatus}
            <hr style="border: 0; border-top: 1px solid #eee; margin: 12px 0;">
            <h4>Historical Forecast:</h4>
            <ul>${listHtml}</ul>
        </div>
    `;
}

function updateSidebarNoData(locationTitle, season, visibleAlerts) {
    const panel = document.getElementById('info-panel');
    
    let alertStatus = "";
    if (visibleAlerts.length > 0) {
        let alertsList = visibleAlerts.map(a => `<li><strong>${a.emoji} ${a.disaster_type}</strong> (${a.locality})</li>`).join('');
        alertStatus = `
            <div style="margin-top: 10px; color: #dc3545;">
                <p style="margin-bottom: 5px;"><strong>⚠️ ${visibleAlerts.length} active alert(s) in view:</strong></p>
                <ul style="padding-left: 18px; margin-top: 0;">${alertsList}</ul>
                <p style="font-size: 12px; color: #64748b; margin-top: 8px;"><em>Click map emojis for full emergency precautions.</em></p>
            </div>`;
    } else {
        alertStatus = `<p style="color: #28a745;"><strong>✅ No active alerts reported.</strong></p>`;
    }

    panel.innerHTML = `
        <div class="info-card ${visibleAlerts.length > 0 ? 'high' : 'low'}">
            <h3>📍 ${locationTitle}</h3>
            <p><strong>Season:</strong> ${season}</p>
            ${alertStatus}
            <hr style="border: 0; border-top: 1px solid #eee; margin: 12px 0;">
            <h4>Historical Forecast:</h4>
            <p style="color: #64748b; font-size: 13px;"><em>No historical ML training data available for this specific region.</em></p>
        </div>
    `;
}

async function displayDetails(props, lat, lon) {
    const panel = document.getElementById('info-panel');
    const placeName = props.locality || props.region || "Selected Area";
    const season = document.getElementById('season-filter').value || props.season || "Current";

    panel.innerHTML = `
        <div class="info-card ${(props.risk_level || 'medium').toLowerCase()}">
            <h3>📍 ${placeName}</h3>
            <p><strong>Season:</strong> ${season}</p>
            
            <div style="margin-top: 15px; background: #fff5f5; padding: 12px; border-radius: 6px; border: 1px solid #ffc9c9;">
                <p style="margin: 0 0 8px 0; color: #ff0019; font-size: 15px;">
                    <strong>⚠️ Active Alert: ${props.emoji} ${props.disaster_type}</strong>
                </p>
                <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Reason:</strong> ${props.primary_reason}</p>
                <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Precautions:</p>
                <ul style="padding-left: 18px; margin: 0; font-size: 13px;">
                    ${(props.dynamic_precautions || []).map(t => `<li>${t}</li>`).join('')}
                </ul>
            </div>
            
            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
            
            <div id="historical-data-container">
                <p style="font-size: 13px; color: #64748b;"><em>Loading historical ML forecast...</em></p>
            </div>
        </div>
    `;

    let url = `/api/v1/predict?lat=${lat}&lon=${lon}&region=${encodeURIComponent(placeName)}`;
    if (season && season !== "Current") url += `&season=${season}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        const histContainer = document.getElementById('historical-data-container');
        
        if (data.predictions) {
            const listHtml = data.predictions.map(p => `<li>${p.disaster_type}: <strong>${p.probability_percentage}</strong></li>`).join('');
            histContainer.innerHTML = `<h4>Historical Forecast:</h4><ul>${listHtml}</ul>`;
        } else {
            histContainer.innerHTML = `<p style="color: #64748b; font-size: 13px;"><em>No historical ML training data available for this specific region.</em></p>`;
        }
    } catch (err) {
        console.error("Failed to load ML details", err);
        document.getElementById('historical-data-container').innerHTML = `<p style="color: #ff0019; font-size: 13px;">Failed to load historical data.</p>`;
    }
}

initApp();