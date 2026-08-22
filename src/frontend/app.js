let map;
let markersClusterGroup;
let allDisasterData = [];
let dynamicSelectionMarker = null;
let isMarkerClick = false;

function getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    if (month >= 9 && month <= 11) return 'Autumn';
    return 'Winter';
}

async function fetchAllDisasters() {
    try {
        const res = await fetch('/api/v1/disasters');
        if (res.ok) allDisasterData = await res.json();
    } catch (e) {
        console.error("Failed to load historical data.", e);
    }
}

async function initApp() {
    const bounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));
    map = L.map('map', { center: [39.0, 22.0], zoom: 5, minZoom: 3, maxBounds: bounds });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap, © CARTO', noWrap: true, bounds: bounds
    }).addTo(map);

    await fetchAllDisasters();
    renderMarkers();

    document.getElementById('season-filter').addEventListener('change', () => {
        if (dynamicSelectionMarker) { map.removeLayer(dynamicSelectionMarker); dynamicSelectionMarker = null; }
        renderMarkers();
    });

    map.on('click', async (e) => {
        if (isMarkerClick) { isMarkerClick = false; return; }
        
        const lat = e.latlng.lat.toFixed(4);
        const lon = e.latlng.lng.toFixed(4);
        document.getElementById('info-panel').innerHTML = '<div class="info-card low"><p style="color: #64748b;">🌍 Identifying location...</p></div>';

        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
            const geoData = await geoRes.json();
            const locationName = geoData.address ? (geoData.address.city || geoData.address.town || geoData.address.village || "Unknown Region") : "Regional Sector";
            await fetchAndDisplayDynamicPrediction(lat, lon, locationName);
        } catch (err) {
            await fetchAndDisplayDynamicPrediction(lat, lon, "Regional Sector");
        }
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('keypress', handleSearch);
}

function renderMarkers() {
    if (markersClusterGroup) map.removeLayer(markersClusterGroup);

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

            const borderColor = highestRisk === 'high' ? '#ff0000' : highestRisk === 'medium' ? '#ffa200' : '#00ffaa';
            return L.divIcon({
                html: `<div style="width: 38px; height: 38px; font-size: 20px; display: flex; align-items: center; justify-content: center; background: white; border-radius: 50%; border: 3px solid ${borderColor}; position: relative; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
                          ${dominantEmoji}
                          <span style="position: absolute; top: -6px; right: -6px; background: #334155; color: white; border-radius: 50%; font-size: 11px; font-weight: bold; padding: 2px 5px; border: 2px solid white;">${children.length}</span>
                       </div>`,
                className: 'custom-cluster-wrap', iconSize: [38, 38], iconAnchor: [19, 19]
            });
        }
    });

    let safeDataArray = Array.isArray(allDisasterData) ? allDisasterData : (allDisasterData.features || allDisasterData.data || []);
    const activeSeason = (document.getElementById('season-filter').value || getCurrentSeason()).toLowerCase();
    const filteredRecords = safeDataArray.filter(r => (r.season || r.properties?.season || '').toLowerCase() === activeSeason);

    const localityStats = {};
    filteredRecords.forEach(record => {
        const loc = record.locality || record.properties?.locality || "Unknown";
        if (!localityStats[loc]) localityStats[loc] = { types: [], counts: {} };
        const type = record.disaster_type || record.properties?.disaster_type;
        localityStats[loc].types.push(type);
        localityStats[loc].counts[type] = (localityStats[loc].counts[type] || 0) + 1;
    });

    for (const loc in localityStats) {
        let maxCount = 0;
        let topThreat = "";
        for (const [t, c] of Object.entries(localityStats[loc].counts)) {
            if (c > maxCount) { maxCount = c; topThreat = t; }
        }
        localityStats[loc].probability = Math.round((maxCount / localityStats[loc].types.length) * 100);
        localityStats[loc].topThreat = topThreat;
    }

    const gridMap = new Map();
    filteredRecords.forEach(record => {
        const lat = record.latitude || record.geometry?.coordinates[1];
        const lon = record.longitude || record.geometry?.coordinates[0];
        if (!lat || !lon) return;

        const gridKey = `${parseFloat(lat).toFixed(2)}-${parseFloat(lon).toFixed(2)}`;
        if (!gridMap.has(gridKey)) {
            gridMap.set(gridKey, { lat: parseFloat(lat), lon: parseFloat(lon), locality: record.locality || record.properties?.locality || "Unknown" });
        }
    });

    gridMap.forEach((data) => {
        const stats = localityStats[data.locality];
        if (!stats || stats.probability < 30) return;

        let risk = stats.probability >= 65 ? 'high' : (stats.probability >= 40 ? 'medium' : 'low');
        const emojis = { "Wildfire": "🔥", "Flood": "🌊", "Storm": "🌪️", "Heatwave": "☀️", "Earthquake": "🌋", "Drought": "🏜️" };
        const emoji = emojis[stats.topThreat] || '⚠️';
        const borderColor = risk === 'high' ? '#ff0000' : risk === 'medium' ? '#ffa200' : '#00ffaa';

        const icon = L.divIcon({
            html: `<div style="background: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 3px solid ${borderColor}; box-shadow: 0 2px 5px rgba(0,0,0,0.15); cursor: pointer;">${emoji}</div>`,
            className: '', iconSize: [28, 28], iconAnchor: [14, 14]
        });

        const marker = L.marker([data.lat, data.lon], { icon: icon, customRisk: risk, customEmoji: emoji });
        
        marker.on('click', () => {
            isMarkerClick = true;
            map.flyTo([data.lat, data.lon], 14, { duration: 1.2 });
            fetchAndDisplayDynamicPrediction(data.lat, data.lon, data.locality);
        });
        markersClusterGroup.addLayer(marker);
    });

    map.addLayer(markersClusterGroup);
}

async function fetchAndDisplayDynamicPrediction(lat, lon, locationName) {
    const season = document.getElementById('season-filter').value || getCurrentSeason();
    const panel = document.getElementById('info-panel');
    panel.innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Analyzing live regional ML forecast...</p></div>';

    if (dynamicSelectionMarker) { map.removeLayer(dynamicSelectionMarker); dynamicSelectionMarker = null; }

    try {
        const res = await fetch(`/api/v1/predict?lat=${lat}&lon=${lon}&region=Dynamic&season=${season}`);
        if (res.ok) {
            const data = await res.json();
            if (data.predictions && data.predictions.length > 0) {
                const topThreat = data.predictions[0];
                const probability = parseInt(topThreat.probability_percentage);
                let risk = probability >= 65 ? 'high' : (probability >= 40 ? 'medium' : 'low');
                
                const emojis = { "Wildfire": "🔥", "Flood": "🌊", "Storm": "🌪️", "Heatwave": "☀️", "Earthquake": "🌋", "Drought": "🏜️" };
                const emoji = emojis[topThreat.disaster_type] || '⚠️';
                const borderColor = risk === 'high' ? '#ff0000' : risk === 'medium' ? '#ffa200' : '#00ffaa';

                const icon = L.divIcon({
                    html: `<div style="background: white; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 4px solid ${borderColor}; box-shadow: 0 4px 8px rgba(0,0,0,0.4); z-index: 1000;" title="Live Forecast: ${probability}% ${topThreat.disaster_type}">${emoji}</div>`,
                    className: '', iconSize: [34, 34], iconAnchor: [17, 17]
                });
                dynamicSelectionMarker = L.marker([lat, lon], { icon: icon, zIndexOffset: 1000 }).addTo(map);

                displayDetails({
                    locality: locationName, disaster_type: topThreat.disaster_type, risk_level: risk, emoji: emoji,
                    primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type}.`,
                    dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
                }, lat, lon);
                return;
            }
        }
        panel.innerHTML = `<div class="info-card low"><h3>📍 ${locationName}</h3><p style="color: #00ffaa;"><strong>✅ Low seasonal risk profile.</strong></p></div>`;
    } catch (err) {
        panel.innerHTML = `<div class="info-card low"><h3>📍 ${locationName}</h3><p>Error retrieving prediction.</p></div>`;
    }
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
                const locationName = data[0].display_name.split(',')[0];
                map.flyTo([lat, lon], 13, { duration: 1.5 });
                await fetchAndDisplayDynamicPrediction(lat, lon, locationName);
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
            <p style="color: ${props.risk_level === 'high' ? '#ff0019' : props.risk_level === 'medium' ? '#ff8800' : '#00ff3c'};">
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