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

async function fetchAllDisasters() {
    try {
        const res = await fetch('/api/v1/disasters');
        if (res.ok) {
            allDisasterData = await res.json();
        }
    } catch (e) {
        console.error("Failed to load disaster data. Is the backend running?", e);
    }
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
        attribution: '© OpenStreetMap, © CARTO',
        noWrap: true,
        bounds: bounds
    }).addTo(map);

    await fetchAllDisasters();
    renderMarkers();

    document.getElementById('season-filter').addEventListener('change', () => {
        renderMarkers();
    });

    map.on('moveend', () => {
        if (isMarkerClick) {
            isMarkerClick = false;
            return;
        }
        
        const zoom = map.getZoom();
        if (zoom < 6) {
            document.getElementById('info-panel').innerHTML = `
                <div class="info-card low">
                    <h3>🌍 Global View</h3>
                    <p>Select a region or marker to view detailed local forecasts.</p>
                </div>`;
        }
    });

    map.on('click', async (e) => {
        if (isMarkerClick) return; 
        
        const lat = e.latlng.lat.toFixed(4);
        const lon = e.latlng.lng.toFixed(4);
        
        await fetchAndDisplayDynamicPrediction(lat, lon, "Selected Map Sector");
    });

    const searchInput = document.getElementById('search-box');
    if (searchInput) {
        searchInput.addEventListener('keypress', handleSearch);
    }
}

function renderMarkers() {
    if (markersClusterGroup) map.removeLayer(markersClusterGroup);

    markersClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50, 
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: 10,
        iconCreateFunction: function(cluster) {
            const children = cluster.getAllChildMarkers();
            let highestRisk = 'low';
            let dominantEmoji = '⚠️';
            let maxScore = 0;
            const riskScores = { 'low': 1, 'medium': 2, 'high': 3 };
            
            children.forEach(marker => {
                const r = marker.options.customRisk || 'low';
                const score = riskScores[r] || 1;
                if (score > maxScore) {
                    maxScore = score;
                    highestRisk = r;
                    dominantEmoji = marker.options.customEmoji || '⚠️';
                }
            });

            const borderColor = highestRisk === 'high' ? '#ef4444' : highestRisk === 'medium' ? '#f59e0b' : '#10b981';
            
            return L.divIcon({
                html: `<div style="width: 38px; height: 38px; font-size: 20px; display: flex; align-items: center; justify-content: center; background: white; border-radius: 50%; border: 3px solid ${borderColor}; position: relative; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
                          ${dominantEmoji}
                          <span style="position: absolute; top: -6px; right: -6px; background: #334155; color: white; border-radius: 50%; font-size: 11px; font-weight: bold; padding: 2px 5px; border: 2px solid white;">${children.length}</span>
                       </div>`,
                className: 'custom-cluster-wrap', 
                iconSize: [38, 38],
                iconAnchor: [19, 19]
            });
        }
    });

    let safeDataArray = [];
    if (Array.isArray(allDisasterData)) {
        safeDataArray = allDisasterData;
    } else if (allDisasterData && Array.isArray(allDisasterData.features)) {
        safeDataArray = allDisasterData.features; 
    } else if (allDisasterData && Array.isArray(allDisasterData.data)) {
        safeDataArray = allDisasterData.data; 
    } else {
        console.error("Could not find the data array. API returned:", allDisasterData);
        return; 
    }

    const dropdownValue = document.getElementById('season-filter').value;
    const activeSeason = dropdownValue === "" ? getCurrentSeason() : dropdownValue;
    
    const filteredRecords = safeDataArray.filter(record => {
        const recordSeason = record.season || record.properties?.season || '';
        return recordSeason.toLowerCase() === activeSeason.toLowerCase();
    });

    const gridMap = new Map();
    filteredRecords.forEach(record => {
        const lat = record.latitude || record.geometry?.coordinates[1];
        const lon = record.longitude || record.geometry?.coordinates[0];
        if (!lat || !lon) return;

        const gridKey = `${parseFloat(lat).toFixed(1)}-${parseFloat(lon).toFixed(1)}`;

        if (!gridMap.has(gridKey)) {
            gridMap.set(gridKey, {
                lat: parseFloat(lat),
                lon: parseFloat(lon),
                locality: record.locality || record.properties?.locality || "Regional Sector",
                types: []
            });
        }
        const dtype = record.disaster_type || record.properties?.disaster_type;
        if (dtype) gridMap.get(gridKey).types.push(dtype);
    });

    gridMap.forEach((data, gridKey) => {
        if (data.types.length === 0) return;

        const counts = {};
        data.types.forEach(t => counts[t] = (counts[t] || 0) + 1);

        let topThreat = "";
        let maxCount = 0;
        for (const [t, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                topThreat = t;
            }
        }

        const probability = Math.round((maxCount / data.types.length) * 100);

        if (probability >= 30) {
            let risk = 'low'; 
            if (probability >= 65) risk = 'high'; 
            else if (probability >= 40) risk = 'medium'; 

            const emojis = { "Wildfire": "🔥", "Flood": "🌊", "Storm": "🌪️", "Heatwave": "☀️", "Earthquake": "🌋", "Drought": "🏜️" };
            const emoji = emojis[topThreat] || '⚠️';
            const borderColor = risk === 'high' ? '#ef4444' : risk === 'medium' ? '#f59e0b' : '#10b981';

            const icon = L.divIcon({
                html: `<div style="background: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 3px solid ${borderColor}; box-shadow: 0 2px 5px rgba(0,0,0,0.15); cursor: pointer;" title="Seasonal Risk: ${probability}% ${topThreat}">${emoji}</div>`,
                className: '',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            const marker = L.marker([data.lat, data.lon], { 
                icon: icon,
                customRisk: risk,
                customEmoji: emoji
            });
            
            marker.on('click', () => {
                isMarkerClick = true;
                
                map.flyTo([data.lat, data.lon], 14, { duration: 1.2 });
                
                displayDetails({
                    locality: data.locality,
                    disaster_type: topThreat,
                    risk_level: risk,
                    emoji: emoji,
                    primary_reason: `Historical probability of ${probability}% for ${topThreat} in this sector during ${activeSeason}.`,
                    dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
                }, data.lat, data.lon);
            });

            markersClusterGroup.addLayer(marker);
        }
    });

    map.addLayer(markersClusterGroup);
}

async function displayDetails(props, lat, lon) {
    const panel = document.getElementById('info-panel');
    const season = document.getElementById('season-filter').value || "Current";
    
    panel.innerHTML = `
        <div class="info-card ${props.risk_level}">
            <h3>📍 ${props.locality}</h3>
            <p><strong>Season:</strong> ${season}</p>
            <p style="color: ${props.risk_level === 'high' ? '#dc3545' : props.risk_level === 'medium' ? '#d97706' : '#28a745'};">
                <strong>⚠️ Seasonal Advisory: ${props.risk_level.charAt(0).toUpperCase() + props.risk_level.slice(1)} probability of ${props.disaster_type}.</strong>
            </p>
            <div style="margin-top: 15px; background: #fff5f5; padding: 12px; border-radius: 6px; border: 1px solid #ffc9c9;">
                <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Reason:</strong> ${props.primary_reason}</p>
                <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Precautions:</p>
                <ul style="padding-left: 18px; margin: 0; font-size: 13px;">
                    ${props.dynamic_precautions.map(t => `<li>${t}</li>`).join('')}
                </ul>
            </div>
        </div>
    `;
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
                
            } else {
                alert("Location not found. Please try a different search term.");
            }
        } catch (err) {
            console.error("Search failed:", err);
        }
    }
}

async function fetchAndDisplayDynamicPrediction(lat, lon, locationName) {
    const season = document.getElementById('season-filter').value || getCurrentSeason();
    const panel = document.getElementById('info-panel');
    
    panel.innerHTML = '<div class="info-card low"><p style="color: #64748b;">📡 Analyzing live regional ML forecast...</p></div>';

    try {
        const url = `/api/v1/predict?lat=${lat}&lon=${lon}&region=Dynamic&season=${season}`;
        const res = await fetch(url);
        
        if (res.ok) {
            const data = await res.json();
            if (data.predictions && data.predictions.length > 0) {
                const topThreat = data.predictions[0];
                const probability = parseInt(topThreat.probability_percentage);
                let risk = probability >= 65 ? 'high' : (probability >= 40 ? 'medium' : 'low');
                
                const emojis = { "Wildfire": "🔥", "Flood": "🌊", "Storm": "🌪️", "Heatwave": "☀️", "Earthquake": "🌋", "Drought": "🏜️" };
                const emoji = emojis[topThreat.disaster_type] || '⚠️';

                displayDetails({
                    locality: locationName,
                    disaster_type: topThreat.disaster_type,
                    risk_level: risk,
                    emoji: emoji,
                    primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type}.`,
                    dynamic_precautions: ["Monitor local meteorological bulletins and regional safety warnings."]
                }, lat, lon);
                return;
            }
        }
        
        panel.innerHTML = `
            <div class="info-card low">
                <h3>📍 ${locationName}</h3>
                <p style="color: #10b981;"><strong>✅ Low seasonal risk profile.</strong></p>
                <p style="font-size: 13px;">No significant threats predicted for this sector during ${season}.</p>
            </div>`;
            
    } catch (err) {
        console.error("Dynamic prediction failed:", err);
        panel.innerHTML = `<div class="info-card low"><h3>📍 ${locationName}</h3><p>Error retrieving prediction.</p></div>`;
    }
}
document.addEventListener('DOMContentLoaded', initApp);