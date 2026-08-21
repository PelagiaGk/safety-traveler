let map;
let geojsonLayer;
let locationHierarchy = {};

async function initApp() {
    const panel = document.getElementById('info-panel');
    panel.innerHTML = '<p>Acquiring location and loading map...</p>';

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => fetchDefaultView(position.coords.latitude, position.coords.longitude),
            (error) => {
                console.warn("Geolocation denied or failed. Using fallback.");
                fetchDefaultView(null, null);
            }
        );
    } else {
        fetchDefaultView(null, null);
    }
}

async function fetchDefaultView(lat, lon) {
    let url = '/api/v1/default-view';
    if (lat !== null && lon !== null) {
        url += `?lat=${lat}&lon=${lon}`;
    }

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        map = L.map('map').setView([data.default_center.lat, data.default_center.lon], data.default_center.zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);

        document.getElementById('season-filter').value = data.current_season;
        
        await loadFilters(data.matched_country);
        renderPoints(data.active_seasonal_features);
        
        document.getElementById('info-panel').innerHTML = '<p>Select a region on the map to see disaster probabilities and safety tips.</p>';
    } catch (error) {
        console.error("Initialization Error:", error);
        document.getElementById('info-panel').innerHTML = '<p>Error loading the application. Please check the backend connection.</p>';
    }
}

async function loadFilters(defaultCountry) {
    const res = await fetch('/api/v1/hierarchy');
    const data = await res.json();
    locationHierarchy = data.hierarchy;

    const countrySelect = document.getElementById('country-filter');
    const regionSelect = document.getElementById('region-filter');
    
    countrySelect.innerHTML = '<option value="">All Countries</option>';
    
    for (const country in locationHierarchy) {
        const option = new Option(country, country);
        if (country === defaultCountry) option.selected = true;
        countrySelect.add(option);
    }
    
    updateRegionDropdown(defaultCountry);

    countrySelect.addEventListener('change', (e) => {
        updateRegionDropdown(e.target.value);
    });
}

function updateRegionDropdown(selectedCountry) {
    const regionSelect = document.getElementById('region-filter');
    regionSelect.innerHTML = '<option value="">All Regions</option>';
    
    if (selectedCountry && locationHierarchy[selectedCountry]) {
        for (const region in locationHierarchy[selectedCountry]) {
            regionSelect.add(new Option(region, region));
        }
    }
}

async function loadMapData() {
    const country = document.getElementById('country-filter').value;
    const region = document.getElementById('region-filter').value;
    const season = document.getElementById('season-filter').value;
    
    let url = '/api/v1/disasters?';
    if (country) url += `country=${country}&`;
    if (region) url += `region=${region}&`;
    if (season) url += `season=${season}&`;

    const res = await fetch(url);
    const data = await res.json();
    renderPoints(data);
}

function renderPoints(featureCollection) {
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    geojsonLayer = L.geoJSON(featureCollection, {
        pointToLayer: function (feature, latlng) {
            const risk = feature.properties.risk_level;
            const sizeClass = risk === 'High' ? 'high-risk' : '';
            const icon = L.divIcon({
                html: `<div class="emoji-marker ${sizeClass}">${feature.properties.emoji}</div>`,
                className: '',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
            return L.marker(latlng, { icon: icon });
        },
        onEachFeature: function (feature, layer) {
            layer.on('click', () => showDetails(feature.properties));
        }
    }).addTo(map);

    if (featureCollection.features && featureCollection.features.length > 0) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [50, 50], maxZoom: 9 });
    }
}

async function showDetails(props) {
    const panel = document.getElementById('info-panel');
    panel.innerHTML = '<p>Loading predictive models...</p>';

    const season = document.getElementById('season-filter').value || props.season;
    
    try {
        const predRes = await fetch(`/api/v1/predict?region=${props.region}&season=${season}`);
        const predData = await predRes.json();
        
        let html = `
            <div class="info-card ${props.risk_level.toLowerCase()}">
                <h3>${props.locality}, ${props.region}</h3>
                <p><strong>Primary Concern:</strong> ${props.emoji} ${props.disaster_type}</p>
                <p><strong>Reason:</strong> ${props.primary_reason}</p>
                
                <h4>ML Probability Forecast:</h4>
                <ul>
        `;
        
        predData.predictions.forEach(p => {
            html += `<li>${p.disaster_type}: <strong>${p.probability_percentage}</strong></li>`;
        });

        html += `
                </ul>
                <h4>Safety Precautions:</h4>
                <ul>
        `;
        props.static_safety_tips.forEach(t => html += `<li>${t}</li>`);
        props.dynamic_precautions.forEach(t => html += `<li><strong>Watch out:</strong> ${t}</li>`);
        html += `</ul></div>`;
        
        panel.innerHTML = html;
    } catch (error) {
        panel.innerHTML = '<p>Error fetching predictions.</p>';
    }
}

initApp();