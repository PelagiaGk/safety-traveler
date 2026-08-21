let map;
let geojsonLayer;
let allDisasterData = [];
let debounceTimer;

async function initApp() {
    setupLanguageSelector();

    const defaultCenter = [39.0, 22.0];
    const bounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));

    map = L.map('map', {
        center: defaultCenter,
        zoom: 5,
        minZoom: 3,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
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
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const zoom = map.getZoom();
            if (zoom < 6) {
                document.getElementById('info-panel').innerHTML = `
                    <div class="info-card low">
                        <h3>🌍 Global View</h3>
                        <p>Zoom in to a specific region to see local safety conditions and active alerts.</p>
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
        if (map.getZoom() >= 6) {
            const center = map.getCenter();
            triggerAreaPrediction(center.lat, center.lng);
        }
    });
}

function setupLanguageSelector() {
    const langBtn = document.getElementById('lang-btn');
    const langMenu = document.getElementById('lang-menu');
    
    langBtn.addEventListener('click', () => {
        langMenu.classList.toggle('hidden');
    });

    document.querySelectorAll('.lang-option').forEach(option => {
        option.addEventListener('click', (e) => {
            const langCode = e.target.getAttribute('data-lang');
            document.cookie = `googtrans=${langCode}; path=/; domain=${window.location.hostname}`;
            document.cookie = `googtrans=${langCode}; path=/`; 
            window.location.reload();
        });
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

    const groupedAlerts = new Map();
    
    filteredFeatures.forEach(feature => {
        const locality = feature.properties.locality || feature.properties.region || "Unknown";
        if (!groupedAlerts.has(locality)) {
            groupedAlerts.set(locality, []);
        }
        
        const existing = groupedAlerts.get(locality);
        const isDuplicate = existing.some(e => e.properties.disaster_type === feature.properties.disaster_type);
        
        if (!isDuplicate) {
            existing.push(feature);
        }
    });

    const finalFeatures = [];
    
    groupedAlerts.forEach((alerts, locality) => {
        const radius = 0.08; 
        
        alerts.forEach((feature, index) => {
            const offsetFeature = JSON.parse(JSON.stringify(feature));
            
            if (offsetFeature.geometry && offsetFeature.geometry.coordinates) {
                const baseLon = offsetFeature.geometry.coordinates[0];
                const baseLat = offsetFeature.geometry.coordinates[1];
                
                if (alerts.length > 1) {
                    const angle = (index / alerts.length) * Math.PI * 2;
                    const lonOffset = Math.sin(angle) * radius;
                    const latOffset = Math.cos(angle) * radius;
                    
                    offsetFeature.geometry.coordinates[0] = baseLon + lonOffset;
                    offsetFeature.geometry.coordinates[1] = baseLat + latOffset;
                }
            }
            
            finalFeatures.push(offsetFeature);
        });
    });

    geojsonLayer = L.geoJSON({ type: "FeatureCollection", features: finalFeatures }, {
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
            layer.on('click', () => {
                const latlng = layer.getLatLng();
                map.flyTo(latlng, 9, { animate: true, duration: 0.5 });
                displayDetails(feature.properties, latlng.lat, latlng.lng);
            });
        }
    }).addTo(map);
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
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`);
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
        if (geojsonLayer) {
            geojsonLayer.eachLayer(layer => {
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
    let highestRisk = predictions.length > 0 ? predictions[0].risk_rating.toLowerCase() : 'low';
    let cardStyle = visibleAlerts.length > 0 ? "high" : (highestRisk === "high" ? "medium" : "low");
    let listHtml = predictions.map(p => `<li>${p.disaster_type}: <strong>${p.probability_percentage}</strong></li>`).join('');

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
    panel.innerHTML = '<p>Loading incident details and historical forecasts...</p>';

    const season = document.getElementById('season-filter').value || props.season || "Current";
    let placeName = props.locality || props.region || "Selected Area";

    let url = `/api/v1/predict?lat=${lat}&lon=${lon}&region=${encodeURIComponent(placeName)}`;
    if (season && season !== "Current") url += `&season=${season}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        let listHtml = "";
        if (data.predictions) {
            listHtml = data.predictions.map(p => `<li>${p.disaster_type}: <strong>${p.probability_percentage}</strong></li>`).join('');
        } else {
            listHtml = `<p style="color: #64748b; font-size: 13px;"><em>No historical ML training data available for this specific region.</em></p>`;
        }

        panel.innerHTML = `
            <div class="info-card ${(props.risk_level || 'medium').toLowerCase()}">
                <h3>📍 ${placeName}</h3>
                <p><strong>Season:</strong> ${season}</p>
                
                <div style="margin-top: 15px; background: #fff5f5; padding: 12px; border-radius: 6px; border: 1px solid #ffc9c9;">
                    <p style="margin: 0 0 8px 0; color: #dc3545; font-size: 15px;">
                        <strong>⚠️ Active Alert: ${props.emoji} ${props.disaster_type}</strong>
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Reason:</strong> ${props.primary_reason}</p>
                    <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Precautions:</p>
                    <ul style="padding-left: 18px; margin: 0; font-size: 13px;">
                        ${(props.dynamic_precautions || []).map(t => `<li>${t}</li>`).join('')}
                    </ul>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
                
                <h4>Historical Forecast:</h4>
                <ul>${listHtml}</ul>
            </div>
        `;
    } catch (err) {
        console.error("Failed to load details", err);
        panel.innerHTML = `<p>Error loading incident data.</p>`;
    }
}

initApp();