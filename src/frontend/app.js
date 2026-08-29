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

    const worldBounds = [
        [-90, -180],
        [90, 180]
    ];

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

    map.on('click', async (e) => {
        if (isMarkerClick) { isMarkerClick = false; return; }

        const popup = L.popup({ offset: [0, -5], className: 'custom-glass-wrapper' })
            .setLatLng(e.latlng)
            .setContent('<div class="glass-popup empty-state"><h3>📡 Analyzing ML data...</h3></div>')
            .openOn(map);

        try {
            const season = document.getElementById('season-filter')?.value || (typeof getCurrentSeason === 'function' ? getCurrentSeason() : 'Summer');
            
            let clickName = "Regional Sector"; 
            let isProvenWater = false;
            let nomZoom = map.getZoom() < 5 ? 3 : (map.getZoom() < 7 ? 5 : 10);
            
            try {
                const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${e.latlng.lat}&lon=${e.latlng.lng}&zoom=${nomZoom}`);
                if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    if (!geoData.error) {
                        if (isWaterFromGeoData(geoData)) {
                            isProvenWater = true;
                        } else if (geoData.address) {
                            clickName = geoData.address.municipality || geoData.address.town || geoData.address.city || geoData.address.county || "Regional Sector";
                        }
                    }
                }
            } catch (err) {
                console.warn("Geocode rate-limited. Proceeding with default land assumption.");
            }

            if (isProvenWater) {
                popup.setContent('<div class="glass-popup empty-state"><h3>Data says nothing to worry about! 🌿</h3></div>');
                return;
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
        }, 1500); 
    });
    
    map.on('zoomend', () => {
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanVisibleArea, 1500); 
    });

    scanVisibleArea();
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

    const type = geoData.addresstype || geoData.type || "";
    if (['city', 'town', 'village', 'municipality'].includes(type.toLowerCase())) return "";

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

    const type = geoData.addresstype || geoData.type || "";
    if (['city', 'town', 'village', 'municipality'].includes(type.toLowerCase())) return false;

    const isWaterMeta = (geoData.class === 'natural' && geoData.type === 'water') ||
        geoData.class === 'waterway' || geoData.type === 'sea' ||
        (geoData.address && (geoData.address.sea || geoData.address.ocean));

    const dispName = (geoData.display_name || "").toLowerCase();
    const waterRegex = /\b(sea|ocean|gulf|strait)\b/;
    
    return isWaterMeta || waterRegex.test(dispName);
}

function buildPopupCard(data, lat, lon) {
    const season = document.getElementById('season-filter')?.value || getCurrentSeason();
    let reasonText = data.primary_reason || `Live ML forecast indicates a ${data.probability_percentage} probability for ${data.disaster_type} in the surrounding area.`;

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

async function scanVisibleArea() {
    if (window.currentScanController) window.currentScanController.abort();
    
    window.currentScanController = new AbortController();
    const globalSignal = window.currentScanController.signal;

    const bounds = map.getBounds();
    const season = document.getElementById('season-filter')?.value || (typeof getCurrentSeason === 'function' ? getCurrentSeason() : 'Summer');

    const center = bounds.getCenter();
    const latOff = (bounds.getNorth() - bounds.getSouth()) * 0.25;
    const lonOff = (bounds.getEast() - bounds.getWest()) * 0.25;
    
    const fallbackPoints = [
        { lat: center.lat, lon: center.lng },
        { lat: center.lat + latOff, lon: center.lng - lonOff }, 
        { lat: center.lat + latOff, lon: center.lng + lonOff }, 
        { lat: center.lat - latOff, lon: center.lng - lonOff }, 
        { lat: center.lat - latOff, lon: center.lng + lonOff }
    ];

    let predictionsList = [];

    for (const pt of fallbackPoints) {
        if (globalSignal.aborted) return;

        let isValidLand = false;
        let regionName = "Regional Sector"; 

        try {
            const geoRes = await fetch(`/api/v1/nominatim-proxy?lat=${pt.lat}&lon=${pt.lon}&zoom=10`, { signal: globalSignal });
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                if (!geoData.error && !isWaterFromGeoData(geoData)) {
                    isValidLand = true;
                    if (geoData.address) {
                        regionName = geoData.address.municipality || geoData.address.town || geoData.address.county || "Regional Sector";
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
        }

        if (isValidLand) {
            try {
                const url = `/api/v1/predict?lat=${pt.lat}&lon=${pt.lon}&region=${encodeURIComponent(regionName)}&season=${season}`;
                const res = await fetch(url, { signal: globalSignal });
                if (res.ok) {
                    const data = await res.json();
                    if (data.predictions && data.predictions.length > 0) {
                        data.predictions.forEach(pred => {
                            if (parseFloat(pred.probability_percentage) >= 30) {
                                predictionsList.push({ lat: pt.lat, lon: pt.lon, name: regionName, threat: pred });
                            }
                        });
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }

        await new Promise(resolve => {
            const timer = setTimeout(resolve, 1100);
            globalSignal.addEventListener('abort', () => { clearTimeout(timer); resolve(); });
        });
    }

    if (globalSignal.aborted) return;

    predictionsList.sort((a, b) => parseFloat(b.threat.probability_percentage) - parseFloat(a.threat.probability_percentage));
    const dedupeDistance = map.getZoom() < 7 ? 0.6 : (map.getZoom() < 10 ? 0.3 : 0.1); 

    for (const pt of predictionsList) {
        const uniqueKey = `${pt.name}-${pt.threat.disaster_type}`;
        const isDuplicate = plottedMarkersCache.some(cachedPt => cachedPt.uniqueKey === uniqueKey);
        
        if (!isDuplicate) {
            let finalLat = pt.lat;
            let finalLon = pt.lon;

            if (pt.threat.disaster_type.toLowerCase().includes('fire')) {
                const hash = (Math.abs(pt.lat) * 100 + Math.abs(pt.lon) * 100) % 4;
                if (hash < 1) { finalLat += 0.05; finalLon += 0.05; }
                else if (hash < 2) { finalLat += 0.05; finalLon -= 0.05; }
                else if (hash < 3) { finalLat -= 0.05; finalLon += 0.05; }
                else { finalLat -= 0.05; finalLon -= 0.05; }
            }

            const spatialOverlap = plottedMarkersCache.some(c => Math.hypot(finalLat - c.lat, finalLon - c.lon) < dedupeDistance);
            if (spatialOverlap) {
                finalLon += 0.05;
            }

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

        const initialDetails = {
            locality: "⏳ Resolving Region...",
            disaster_type: topThreat.disaster_type,
            risk_level: risk,
            emoji: emoji,
            primary_reason: `Live ML forecast indicates a ${probability}% probability for ${topThreat.disaster_type}.`,
            dynamic_precautions: ["Monitor local safety warnings."]
        };

        const popup = L.popup({ offset: [0, -10], className: 'custom-glass-wrapper' })
            .setLatLng([lat, lon])
            .setContent(buildPopupCard(initialDetails, lat, lon))
            .openOn(map);

        let finalName = cityName;
        let directionPrefix = "";

        try {
            await new Promise(resolve => setTimeout(resolve, 600));
            let nomZoom = map.getZoom() < 5 ? 3 : (map.getZoom() < 7 ? 5 : 8);
            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${nomZoom}&accept-language=en`);

            if (geo.ok) {
                const geoData = await geo.json();
                if (geoData.address) {
                    const addr = geoData.address;
                    if (nomZoom === 3) finalName = addr.country || "International Space";
                    else if (nomZoom === 5) finalName = addr.state || addr.region || addr.country || finalName;
                    else finalName = addr.county || addr.municipality || addr.city || finalName;
                    
                    directionPrefix = getCompassDirection(lat, lon, geoData);
                }
            }
        } catch (err) {
            console.warn("Failed to resolve popup name.");
        }

        const resolvedDetails = { ...initialDetails, locality: `${directionPrefix}${finalName}` };
        popup.setContent(buildPopupCard(resolvedDetails, lat, lon));
    });

    markersClusterGroup.addLayer(marker);
}