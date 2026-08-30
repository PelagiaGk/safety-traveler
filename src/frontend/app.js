let map;
let markersClusterGroup;
let isMarkerClick = false;
let currentRegionName = "Regional View";
let plottedMarkersCache = [];
window.isMapScanning = false;
window.currentScanController = null;

document.addEventListener("DOMContentLoaded", () => {
    if (map !== undefined && map !== null) {
        map.remove();
    }

    const worldBounds = [[-90, -180], [90, 180]];

    map = L.map('map', {
        maxBounds: worldBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 3
    }).setView([38.0, 24.0], 6);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19,
        minZoom: 3,
        noWrap: true,
        bounds: worldBounds
    }).addTo(map);

    markersClusterGroup = L.featureGroup().addTo(map);
    const seasonFilter = document.getElementById('season-filter');
    
    if (seasonFilter) {
        seasonFilter.addEventListener('change', () => {
            markersClusterGroup.clearLayers();
            plottedMarkersCache = [];
            scanVisibleArea();
        });
    }

    async function loadInitialData() {
        try {
            const res = await fetch('/api/v1/default-view');
            if (res.ok) {
                const data = await res.json();
                if (data.active_seasonal_features && data.active_seasonal_features.features) {
                    data.active_seasonal_features.features.forEach(feat => {
                        const props = feat.properties;
                        const geom = feat.geometry;
                        if (geom && geom.coordinates && props.risk_level !== "Low") {
                            const threatData = {
                                disaster_type: props.disaster_type || "Wildfire",
                                probability_percentage: props.probability || 85,
                                primary_reason: props.description || "Seasonal risk profile matches historical precedents.",
                                dynamic_precautions: ["Monitor local safety warnings."]
                            };
                            plotDynamicMarker(geom.coordinates[1], geom.coordinates[0], threatData, props.region);
                        }
                    });
                }
            }
        } catch (err) {
            console.warn("Failed to load default view.", err);
        }
        scanVisibleArea(); 
    }

    map.on('click', async (e) => {
        if (isMarkerClick) { isMarkerClick = false; return; }

        const popup = L.popup({ offset: [0, -5], className: 'custom-glass-wrapper' })
            .setLatLng(e.latlng)
            .setContent('<div class="glass-popup empty-state"><h3>📡 Analyzing ML data...</h3></div>')
            .openOn(map);

        try {
            const season = document.getElementById('season-filter')?.value || getCurrentSeason();
            let clickName = "Regional Sector"; 
            let nomZoom = map.getZoom() < 5 ? 3 : (map.getZoom() < 7 ? 5 : 10);
            
            const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${e.latlng.lat}&lon=${e.latlng.lng}&zoom=${nomZoom}&accept-language=en`);
            
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                
                if (isWaterFromGeoData(geoData)) {
                    popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                    return;
                }
                
                if (!geoData.error && geoData.address) {
                    clickName = geoData.address.municipality || geoData.address.town || geoData.address.city || geoData.address.county || geoData.address.region || "Regional Sector";
                }
            }

            const res = await fetch(`/api/v1/predict?lat=${e.latlng.lat}&lon=${e.latlng.lng}&region=${encodeURIComponent(clickName)}&season=${season}`);
            
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
                    const validThreats = data.predictions.filter(p => parseFloat(p.probability_percentage) >= 30);
                    if (validThreats.length > 0) {
                        let combinedHTML = `<div class="multi-threat-scroll" style="max-height: 280px; overflow-y: auto; padding-right: 5px;">`;
                        validThreats.forEach(threat => {
                            threat.locality = clickName;
                            combinedHTML += buildPopupCard(threat, e.latlng.lat, e.latlng.lng);
                        });
                        combinedHTML += `</div>`;
                        popup.setContent(combinedHTML);
                        return;
                    }
                }
            }
            popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
        } catch (err) {
            popup.setContent('<div class="glass-popup empty-state"><h3>⚠️ ML Service unavailable. Please try again.</h3></div>');
        }
    });

    let scanTimeout;
    map.on('moveend', () => {
        isMarkerClick = false;
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
            const center = map.getBounds().getCenter();
            if (typeof updateRegionMeta === 'function') updateRegionMeta(center.lat, center.lng);
            scanVisibleArea();
        }, 800); 
    });
    
    map.on('zoomend', () => {
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanVisibleArea, 800); 
    });

    loadInitialData();
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
    const type = (geoData.addresstype || geoData.type || "").toLowerCase();
    if (['city', 'town', 'village', 'municipality'].includes(type)) return "";

    const targetLat = parseFloat(lat);
    const targetLon = parseFloat(lon);
    const southLat = parseFloat(geoData.boundingbox[0]);
    const northLat = parseFloat(geoData.boundingbox[1]);
    const westLon = parseFloat(geoData.boundingbox[2]);
    const eastLon = parseFloat(geoData.boundingbox[3]);

    const latSpan = northLat - southLat;
    const lonSpan = eastLon - westLon;
    if (latSpan < 0.1 || lonSpan < 0.1) return "";

    const latThird = latSpan / 3;
    const lonThird = lonSpan / 3;
    let v = "", h = "";

    if (targetLat >= northLat - latThird) v = "North";
    else if (targetLat <= southLat + latThird) v = "South";

    if (targetLon >= eastLon - lonThird) h = "East";
    else if (targetLon <= westLon + lonThird) h = "West";

    if (v && h) return `${v}${h.toLowerCase()}ern `;
    if (v || h) return `${v || h}ern `;
    return "Central ";
}

function isWaterFromGeoData(geoData) {
    if (!geoData || geoData.error) return false;
    
    const type = (geoData.addresstype || geoData.type || "").toLowerCase();
    if (['city', 'town', 'village', 'municipality', 'county', 'state'].includes(type)) return false;

    const isWaterMeta = (geoData.class === 'natural' && geoData.type === 'water') ||
        geoData.class === 'waterway' || geoData.type === 'sea' ||
        (geoData.address && (geoData.address.sea || geoData.address.ocean));

    const dispName = (geoData.display_name || "").toLowerCase();
    const waterRegex = /\b(sea|ocean|gulf|marine|bay|strait|lake)\b/i;
    
    return isWaterMeta || waterRegex.test(dispName);
}

function buildPopupCard(data, lat, lon) {
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    let reasonText = data.primary_reason || `Live ML forecast indicates a ${data.probability_percentage}% probability for ${data.disaster_type} in the surrounding area.`;
    if (data.years_of_data) reasonText += ` (Derived from ${data.years_of_data} years of historical data).`;

    const precautionsList = data.dynamic_precautions && data.dynamic_precautions.length > 0 
        ? data.dynamic_precautions.map(p => `<li>${p}</li>`).join('')
        : `<li>Monitor local meteorological bulletins and regional safety warnings.</li>`;

    return `
        <div class="glass-popup" style="margin-bottom: 10px;">
            <h2>${data.locality || 'User Selected Area'}</h2>
            <p class="season-tag">Season: <strong>${season}</strong></p>
            <div class="advisory-section">
                <p><strong>Seasonal Advisory:</strong> ${data.risk_rating || 'Medium'} probability of ${data.disaster_type}.</p>
                <p><strong>Reason:</strong> ${reasonText}</p>
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
    if (regionTextEl) regionTextEl.innerHTML = `<span style="opacity: 0.5;">Scanning Area...</span>`;

    const currentZoom = map.getZoom();
    let nomZoom = currentZoom < 5 ? 3 : (currentZoom < 7 ? 5 : 8);

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${nomZoom}&accept-language=en`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'Public-Safety-Dashboard/1.0' }
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
        currentRegionName = "Regional View";
    }

    if (regionTextEl) regionTextEl.innerText = currentRegionName;
}

async function scanVisibleArea() {
    if (window.currentScanController) window.currentScanController.abort();
    window.currentScanController = new AbortController();
    const globalSignal = window.currentScanController.signal;

    const bounds = map.getBounds();
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    
    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();
    const latStep = (n - s) / 3;
    const lonStep = (e - w) / 3;
    
    let gridPoints = [];
    for (let i = 1; i <= 2; i++) {
        for (let j = 1; j <= 2; j++) {
            gridPoints.push({ lat: s + (latStep * i), lon: w + (lonStep * j) });
        }
    }
    gridPoints.push({ lat: bounds.getCenter().lat, lon: bounds.getCenter().lng });

    let predictionsList = [];
    
    const mlPromises = gridPoints.map(async (pt) => {
        try {
            const url = `/api/v1/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent("Unknown")}&season=${season}`;
            const res = await fetch(url, { signal: globalSignal });
            if (res.ok) {
                const data = await res.json();
                if (data.predictions && data.predictions.length > 0) {
                    data.predictions.forEach(pred => {
                        if (parseFloat(pred.probability_percentage) >= 30) {
                            predictionsList.push({ 
                                lat: data.resolved_lat || pt.lat, 
                                lon: data.resolved_lon || pt.lon, 
                                name: data.resolved_region || "Regional Sector", 
                                threat: pred 
                            });
                        }
                    });
                }
            }
        } catch (err) {
        }
    });

    await Promise.all(mlPromises);
    if (globalSignal.aborted) return;

    predictionsList.sort((a, b) => parseFloat(b.threat.probability_percentage) - parseFloat(a.threat.probability_percentage));

    for (const pt of predictionsList) {
        const uniqueKey = `${pt.name}-${pt.threat.disaster_type}`;
        const isDuplicate = plottedMarkersCache.some(cachedPt => cachedPt.uniqueKey === uniqueKey);
        
        if (!isDuplicate) {
            let finalLat = pt.lat;
            let finalLon = pt.lon;

            if (pt.threat.disaster_type.toLowerCase().includes('fire')) {
                finalLat += 0.008; 
                finalLon -= 0.008;
            }

            const visualOverlap = plottedMarkersCache.some(c => Math.hypot(finalLat - c.lat, finalLon - c.lon) < 0.03);
            if (visualOverlap) finalLon += 0.04;

            plottedMarkersCache.push({ lat: finalLat, lon: finalLon, type: pt.threat.disaster_type, name: pt.name, uniqueKey: uniqueKey });
            plotDynamicMarker(finalLat, finalLon, pt.threat, pt.name);
        }
    }
}

function plotDynamicMarker(lat, lon, topThreat, cityName) {
    const probability = parseFloat(topThreat.probability_percentage);
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

    const marker = L.marker([lat, lon], { icon: icon });

    marker.on('click', async (e) => {
        isMarkerClick = true;
        L.DomEvent.stopPropagation(e);
        map.flyTo([lat, lon], 10, { duration: 1.2 });

        const popupDetails = {
            locality: cityName || "Resolving region...",
            disaster_type: topThreat.disaster_type,
            risk_rating: risk,
            probability_percentage: probability,
            primary_reason: topThreat.primary_reason || `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type}.`,
            dynamic_precautions: topThreat.dynamic_precautions || ["Monitor local safety warnings."]
        };

        const popup = L.popup({ offset: [0, -10], className: 'custom-glass-wrapper' })
            .setLatLng([lat, lon])
            .setContent(buildPopupCard(popupDetails, lat, lon))
            .openOn(map);

        try {
            let nomZoom = map.getZoom() < 5 ? 3 : (map.getZoom() < 7 ? 5 : 8);
            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${nomZoom}&accept-language=en`);

            if (geo.ok) {
                const geoData = await geo.json();
                if (geoData.address) {
                    const addr = geoData.address;
                    let finalName = cityName;
                    
                    if (nomZoom === 3) finalName = addr.country || "International Space";
                    else if (nomZoom === 5) finalName = addr.state || addr.region || addr.country || finalName;
                    else finalName = addr.county || addr.municipality || addr.city || finalName;
                    
                    const directionPrefix = getCompassDirection(lat, lon, geoData);
                    popupDetails.locality = `${directionPrefix}${finalName}`;
                    popup.setContent(buildPopupCard(popupDetails, lat, lon));
                }
            }
        } catch (err) {
            console.warn("Background name resolution failed, retaining cache.");
        }
    });

    markersClusterGroup.addLayer(marker);
}