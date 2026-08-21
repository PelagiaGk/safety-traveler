let map;
let geojsonLayer;
let allDisasterData = [];
let debounceTimer;

async function initApp() {
    const defaultCenter = [39.0, 22.0];
    map = L.map('map').setView(defaultCenter, 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

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
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const zoom = map.getZoom();
            const panel = document.getElementById('info-panel');
            
            if (zoom < 7) {
                panel.innerHTML = `
                    <div class="info-card low">
                        <h3>🌍 Global View</h3>
                        <p>You are zoomed out. Zoom in to a specific country or region to see local safety conditions and active alerts.</p>
                    </div>`;
                return;
            }

            const center = map.getCenter();
            await triggerAreaPrediction(center.lat, center.lng);
        }, 800); 
    });

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && searchInput.value.trim()) {
            await searchLocation(searchInput.value.trim());
        }
    });

    document.getElementById('season-filter').addEventListener('change', () => {
        renderMarkers();
        if (map.getZoom() >= 7) {
            const center = map.getCenter();
            triggerAreaPrediction(center.lat, center.lng);
        }
    });
}

async function fetchAllDisasters() {
    try {
        const res = await fetch('/api/v1/disasters');
        const data = await res.json();
        allDisasterData = data.features || [];
        renderMarkers();
    } catch (err) {
        console.error("Failed to load disaster data", err);
    }
}

function renderMarkers() {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    const selectedSeason = document.getElementById('season-filter').value;
    
    const filteredFeatures = allDisasterData.filter(f => {
        if (!selectedSeason) return true;
        return (f.properties.season || '').toLowerCase() === selectedSeason.toLowerCase();
    });

    geojsonLayer = L.geoJSON({ type: "FeatureCollection", features: filteredFeatures }, {
        pointToLayer: function (feature, latlng) {
            const risk = (feature.properties.risk_level || 'Low').toLowerCase();
            const emoji = feature.properties.emoji || '⚠️';
            const icon = L.divIcon({
                html: `<div class="emoji-marker risk-${risk}">${emoji}</div>`,
                className: '',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            return L.marker(latlng, { icon: icon });
        },
        onEachFeature: function (feature, layer) {
            layer.on('click', () => displayDetails(feature.properties));
        }
    }).addTo(map);
}

async function searchLocation(query) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const results = await res.json();
        if (results && results.length > 0) {
            const { lat, lon, display_name } = results[0];
            map.flyTo([parseFloat(lat), parseFloat(lon)], 9);
        }
    } catch (err) {
        console.error("Geocoding failed", err);
    }
}

async function triggerAreaPrediction(lat, lon, knownPlaceName = null) {
    const season = document.getElementById('season-filter').value;
    const panel = document.getElementById('info-panel');
    
    panel.innerHTML = '<p>Analyzing area...</p>';
    let placeName = knownPlaceName;

    if (!placeName) {
        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
            const geoData = await geoRes.json();
            if (geoData.error) {
                panel.innerHTML = `
                    <div class="info-card low">
                        <h3>🌊 Uncharted Area / Ocean</h3>
                        <p>No active alerts or historical data available for these coordinates.</p>
                    </div>`;
                return;
            }
            placeName = geoData.name || geoData.address.city || geoData.address.town || geoData.address.country;
        } catch (e) {
            placeName = "Selected Area";
        }
    }

    let url = `/api/v1/predict?lat=${lat}&lon=${lon}`;
    if (season) url += `&season=${season}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        const bounds = map.getBounds();
        let activeAlertsInView = 0;
        if (geojsonLayer) {
            geojsonLayer.eachLayer(layer => {
                if (bounds.contains(layer.getLatLng())) activeAlertsInView++;
            });
        }

        if (data.predictions) {
            updateSidebar(placeName, data.predictions, season || data.season, activeAlertsInView);
        }
    } catch (err) {
        console.error("Prediction fetch failed", err);
    }
}

function updateSidebar(locationTitle, predictions, season, activeAlertsCount) {
    const panel = document.getElementById('info-panel');
    
    let highestRisk = predictions[0].risk_rating.toLowerCase();
    let cardStyle = activeAlertsCount > 0 ? "high" : (highestRisk === "high" ? "medium" : "low");
    let listHtml = predictions.map(p => `<li>${p.disaster_type}: <strong>${p.probability_percentage}</strong> (${p.risk_rating})</li>`).join('');

    let alertStatus = activeAlertsCount > 0 
        ? `<p style="color: #dc3545;"><strong>⚠️ ${activeAlertsCount} active alert(s) in this map view.</strong> Click the emojis on the map for details.</p>`
        : `<p style="color: #28a745;"><strong>✅ No active disaster alerts reported in this immediate area right now.</strong></p>`;

    panel.innerHTML = `
        <div class="info-card ${cardStyle}">
            <h3>📍 ${locationTitle}</h3>
            <p><strong>Season:</strong> ${season}</p>
            ${alertStatus}
            <hr style="border: 0; border-top: 1px solid #eee; margin: 12px 0;">
            <h4>Historical Probability Forecast:</h4>
            <ul>${listHtml}</ul>
        </div>
    `;
}

function displayDetails(props) {
    const panel = document.getElementById('info-panel');
    let html = `
        <div class="info-card ${(props.risk_level || 'medium').toLowerCase()}">
            <h3>${props.locality || 'Incident Alert'}, ${props.region || props.country}</h3>
            <p><strong>Primary Concern:</strong> ${props.emoji} ${props.disaster_type}</p>
            <p><strong>Reason:</strong> ${props.primary_reason}</p>
            <h4>Static Safety Tips:</h4>
            <ul>${(props.static_safety_tips || []).map(t => `<li>${t}</li>`).join('')}</ul>
            <h4>Precautions:</h4>
            <ul>${(props.dynamic_precautions || []).map(t => `<li><strong>Watch out:</strong> ${t}</li>`).join('')}</ul>
        </div>
    `;
    panel.innerHTML = html;
}

initApp();