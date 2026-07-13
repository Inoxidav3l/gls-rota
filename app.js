"use strict";

/* =========================================================
   Definições persistentes (chave API, depósito, notas)
   ========================================================= */

const STORAGE_KEY = "gls-rota-settings-v1";
const GEOCODE_CACHE_KEY = "gls-rota-geocode-cache-v1";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveGeocodeCache(cache) {
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
}

let settings = loadSettings();
let geocodeCache = loadGeocodeCache();

/* =========================================================
   Elementos DOM
   ========================================================= */

const viewInput = document.getElementById("view-input");
const viewLoading = document.getElementById("view-loading");
const viewRoute = document.getElementById("view-route");

const addressInput = document.getElementById("address-input");
const depotChip = document.getElementById("depot-chip");
const depotChipText = document.getElementById("depot-chip-text");
const btnCalc = document.getElementById("btn-calc");
const inputError = document.getElementById("input-error");

const loadingText = document.getElementById("loading-text");
const loadingDetail = document.getElementById("loading-detail");

const routeSummary = document.getElementById("route-summary");
const stopList = document.getElementById("stop-list");
const btnNewRoute = document.getElementById("btn-new-route");
const notesBanner = document.getElementById("notes-banner");
const notesBannerText = document.getElementById("notes-banner-text");

const settingsOverlay = document.getElementById("settings-overlay");
const btnSettings = document.getElementById("btn-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const settingsApiKey = document.getElementById("settings-apikey");
const settingsDepot = document.getElementById("settings-depot");
const settingsNotes = document.getElementById("settings-notes");
const btnSaveSettings = document.getElementById("btn-save-settings");
const settingsSaved = document.getElementById("settings-saved");

/* =========================================================
   Navegação entre ecrãs
   ========================================================= */

function showView(view) {
  for (const v of [viewInput, viewLoading, viewRoute]) v.hidden = true;
  view.hidden = false;
}

function setLoading(text, detail) {
  loadingText.textContent = text;
  loadingDetail.textContent = detail || "";
  showView(viewLoading);
}

/* =========================================================
   Definições — abrir/fechar/guardar
   ========================================================= */

function refreshDepotChip() {
  if (settings.depotAddress) {
    depotChipText.textContent = "Depósito: " + settings.depotAddress;
    depotChip.classList.add("is-set");
  } else {
    depotChipText.textContent = "Sem depósito definido — configura nas Definições";
    depotChip.classList.remove("is-set");
  }
}

function refreshNotesBanner() {
  if (settings.notes && settings.notes.trim()) {
    notesBannerText.textContent = settings.notes.trim();
    notesBanner.hidden = false;
  } else {
    notesBanner.hidden = true;
  }
}

btnSettings.addEventListener("click", () => {
  settingsApiKey.value = settings.apiKey || "";
  settingsDepot.value = settings.depotAddress || "";
  settingsNotes.value = settings.notes || "";
  settingsSaved.hidden = true;
  settingsOverlay.hidden = false;
});

btnCloseSettings.addEventListener("click", () => {
  settingsOverlay.hidden = true;
});

btnSaveSettings.addEventListener("click", () => {
  const depotChanged = settings.depotAddress !== settingsDepot.value.trim();
  settings.apiKey = settingsApiKey.value.trim();
  settings.depotAddress = settingsDepot.value.trim();
  settings.notes = settingsNotes.value;
  if (depotChanged) {
    // depot address changed: drop cached coordinates so it gets re-geocoded
    delete settings.depotLat;
    delete settings.depotLng;
  }
  saveSettings(settings);
  refreshDepotChip();
  refreshNotesBanner();
  settingsSaved.hidden = false;
  setTimeout(() => { settingsOverlay.hidden = true; }, 700);
});

refreshDepotChip();
refreshNotesBanner();

/* =========================================================
   Geocoding (Google Geocoding API), com cache local
   ========================================================= */

function normalizeAddressKey(addr) {
  return addr.trim().toLowerCase().replace(/\s+/g, " ");
}

async function geocodeAddress(address, apiKey) {
  const key = normalizeAddressKey(address);
  if (geocodeCache[key]) return geocodeCache[key];

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(address) +
    "&region=pt&language=pt-PT&key=" +
    encodeURIComponent(apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha de rede a geocodificar: " + address);
  const data = await res.json();

  if (data.status !== "OK" || !data.results || !data.results.length) {
    throw new Error(
      "Não foi possível localizar: \"" + address + "\" (" + data.status + ")"
    );
  }

  const loc = data.results[0].geometry.location;
  const result = {
    lat: loc.lat,
    lng: loc.lng,
    formatted: data.results[0].formatted_address,
  };

  geocodeCache[key] = result;
  saveGeocodeCache(geocodeCache);
  return result;
}

/* =========================================================
   Ordenação da rota: nearest-neighbor + 2-opt (linha reta)
   ========================================================= */

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestNeighborOrder(depot, points) {
  const remaining = points.slice();
  const order = [];
  let current = depot;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    order.push(current);
  }
  return order;
}

function pathLength(depot, order) {
  let total = 0;
  let prev = depot;
  for (const p of order) {
    total += haversineMeters(prev, p);
    prev = p;
  }
  return total;
}

function twoOptImprove(depot, order) {
  let improved = true;
  let bestOrder = order.slice();
  let bestLen = pathLength(depot, bestOrder);
  let guard = 0;

  while (improved && guard < 60) {
    improved = false;
    guard++;
    for (let i = 0; i < bestOrder.length - 1; i++) {
      for (let j = i + 1; j < bestOrder.length; j++) {
        const candidate = bestOrder.slice(0, i)
          .concat(bestOrder.slice(i, j + 1).reverse())
          .concat(bestOrder.slice(j + 1));
        const candLen = pathLength(depot, candidate);
        if (candLen < bestLen - 0.5) {
          bestOrder = candidate;
          bestLen = candLen;
          improved = true;
        }
      }
    }
  }
  return bestOrder;
}

function optimizeOrder(depot, points) {
  const nn = nearestNeighborOrder(depot, points);
  return twoOptImprove(depot, nn);
}

/* =========================================================
   Routes API — percurso real com trânsito, com fragmentação
   automática para não ultrapassar o limite de waypoints
   por pedido (usamos blocos de 23 intermédios).
   ========================================================= */

const MAX_INTERMEDIATES_PER_CALL = 23;

function decodePolyline(encoded) {
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < encoded.length) {
    let result = 1, shift = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat * 1e-5, lng * 1e-5]);
  }
  return coords;
}

async function computeRouteChunk(origin, destination, intermediates, apiKey) {
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    polylineQuality: "OVERVIEW",
    computeAlternativeRoutes: false,
  };
  if (intermediates.length) {
    body.intermediates = intermediates.map((p) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    }));
  }

  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Routes API falhou (" + res.status + "): " + errText.slice(0, 200));
  }
  const data = await res.json();
  if (!data.routes || !data.routes.length) {
    throw new Error("Routes API não devolveu nenhuma rota.");
  }
  return data.routes[0];
}

// Recebe [depot, stop1, stop2, ...] (já na ordem final) e devolve
// { polyline: [[lat,lng],...], distanceMeters, durationSeconds }
async function computeFullRoute(orderedPointsWithDepot, apiKey, onProgress) {
  const pts = orderedPointsWithDepot;
  let fullCoords = [];
  let totalDistance = 0;
  let totalDuration = 0;

  let i = 0;
  let chunkNum = 0;
  const totalChunks = Math.ceil((pts.length - 1) / (MAX_INTERMEDIATES_PER_CALL + 1)) || 1;

  while (i < pts.length - 1) {
    chunkNum++;
    const chunkEnd = Math.min(i + MAX_INTERMEDIATES_PER_CALL + 1, pts.length - 1);
    const origin = pts[i];
    const destination = pts[chunkEnd];
    const intermediates = pts.slice(i + 1, chunkEnd);

    if (onProgress) onProgress(chunkNum, totalChunks);

    const route = await computeRouteChunk(origin, destination, intermediates, apiKey);
    const coords = decodePolyline(route.polyline.encodedPolyline);
    fullCoords = fullCoords.concat(coords);
    totalDistance += route.distanceMeters || 0;
    const durSeconds = parseFloat((route.duration || "0s").replace("s", ""));
    totalDuration += durSeconds || 0;

    i = chunkEnd;
  }

  return { polyline: fullCoords, distanceMeters: totalDistance, durationSeconds: totalDuration };
}

/* =========================================================
   Mapa (Leaflet)
   ========================================================= */

let map = null;
let mapLayers = [];

function ensureMap() {
  if (map) return map;
  map = L.map("map", { zoomControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  return map;
}

function clearMapLayers() {
  for (const l of mapLayers) map.removeLayer(l);
  mapLayers = [];
}

function pinIcon(label, isDepot) {
  return L.divIcon({
    className: "",
    html:
      '<div class="stop-pin' + (isDepot ? " stop-pin--depot" : "") + '"><span>' +
      label +
      "</span></div>",
    iconSize: [28, 28],
    iconAnchor: [14, 26],
  });
}

function renderMap(depot, orderedStops, polylineCoords) {
  ensureMap();
  clearMapLayers();

  const depotMarker = L.marker([depot.lat, depot.lng], {
    icon: pinIcon("D", true),
  }).addTo(map);
  mapLayers.push(depotMarker);

  orderedStops.forEach((s, idx) => {
    const marker = L.marker([s.lat, s.lng], { icon: pinIcon(String(idx + 1)) }).addTo(map);
    mapLayers.push(marker);
  });

  if (polylineCoords && polylineCoords.length) {
    const line = L.polyline(polylineCoords, { color: "#FF5A1F", weight: 4, opacity: 0.9 }).addTo(map);
    mapLayers.push(line);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
  } else {
    const bounds = L.latLngBounds([[depot.lat, depot.lng], ...orderedStops.map((s) => [s.lat, s.lng])]);
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/* =========================================================
   Lista de paragens + navegação
   ========================================================= */

function navigationUrl(point) {
  return (
    "https://www.google.com/maps/dir/?api=1&destination=" +
    point.lat + "," + point.lng +
    "&travelmode=driving"
  );
}

function renderStopList(depot, orderedStops) {
  stopList.innerHTML = "";

  const depotLi = document.createElement("li");
  depotLi.className = "stop-item stop-item--depot";
  depotLi.innerHTML =
    '<span class="stop-item__badge">D</span>' +
    '<span class="stop-item__text">' +
    '<div class="stop-item__addr">' + escapeHtml(depot.formatted || settings.depotAddress) + '</div>' +
    '<div class="stop-item__meta">Ponto de partida</div>' +
    "</span>";
  stopList.appendChild(depotLi);

  orderedStops.forEach((s, idx) => {
    const li = document.createElement("li");
    li.className = "stop-item";
    li.innerHTML =
      '<span class="stop-item__badge">' + (idx + 1) + "</span>" +
      '<span class="stop-item__text">' +
      '<div class="stop-item__addr">' + escapeHtml(s.formatted || s.original) + "</div>" +
      '<div class="stop-item__meta">Paragem ' + (idx + 1) + " de " + orderedStops.length + "</div>" +
      "</span>" +
      '<span class="stop-item__go">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M9 18l6-6-6-6"/></svg></span>';
    li.addEventListener("click", () => window.open(navigationUrl(s), "_blank"));
    stopList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? h + "h " + m + "min" : m + " min";
}

function formatDistance(meters) {
  return (meters / 1000).toFixed(1) + " km";
}

/* =========================================================
   Fluxo principal: calcular rota
   ========================================================= */

btnCalc.addEventListener("click", async () => {
  inputError.hidden = true;

  if (!settings.apiKey) {
    inputError.textContent = "Falta configurar a chave da API nas Definições.";
    inputError.hidden = false;
    return;
  }
  if (!settings.depotAddress) {
    inputError.textContent = "Falta configurar a morada do depósito nas Definições.";
    inputError.hidden = false;
    return;
  }

  const lines = addressInput.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    inputError.textContent = "Cola pelo menos uma morada.";
    inputError.hidden = false;
    return;
  }

  try {
    // 1. Geocodificar depósito (cache em settings, só refaz se mudou)
    setLoading("A localizar o depósito...");
    let depot;
    if (settings.depotLat && settings.depotLng) {
      depot = { lat: settings.depotLat, lng: settings.depotLng, formatted: settings.depotAddress };
    } else {
      depot = await geocodeAddress(settings.depotAddress, settings.apiKey);
      settings.depotLat = depot.lat;
      settings.depotLng = depot.lng;
      saveSettings(settings);
    }

    // 2. Geocodificar todas as moradas
    const points = [];
    for (let i = 0; i < lines.length; i++) {
      setLoading("A localizar moradas...", "Morada " + (i + 1) + " de " + lines.length);
      try {
        const geo = await geocodeAddress(lines[i], settings.apiKey);
        points.push({ ...geo, original: lines[i] });
      } catch (err) {
        console.warn(err);
        points.push({ lat: null, lng: null, original: lines[i], failed: true });
      }
    }

    const validPoints = points.filter((p) => !p.failed);
    const failedPoints = points.filter((p) => p.failed);

    if (validPoints.length === 0) {
      throw new Error("Não foi possível localizar nenhuma das moradas coladas.");
    }

    // 3. Ordenar (nearest-neighbor + 2-opt, linha reta)
    setLoading("A calcular a melhor sequência...", validPoints.length + " paragens");
    const orderedStops = optimizeOrder(depot, validPoints);

    // 4. Percurso real com trânsito (fragmentado se necessário)
    let routeResult = null;
    try {
      setLoading("A traçar o percurso real...", "Isto pode levar alguns segundos");
      routeResult = await computeFullRoute(
        [depot, ...orderedStops],
        settings.apiKey,
        (chunk, total) => {
          if (total > 1) {
            setLoading("A traçar o percurso real...", "Troço " + chunk + " de " + total);
          }
        }
      );
    } catch (err) {
      console.warn("Routes API falhou, a mostrar só a ordenação:", err);
    }

    // 5. Render
    renderMap(depot, orderedStops, routeResult ? routeResult.polyline : null);
    renderStopList(depot, orderedStops);

    let summary = orderedStops.length + " paragens";
    if (routeResult) {
      summary += " · " + formatDistance(routeResult.distanceMeters) + " · " + formatDuration(routeResult.durationSeconds);
    }
    if (failedPoints.length) {
      summary += " · " + failedPoints.length + " não localizadas";
    }
    routeSummary.textContent = summary;

    showView(viewRoute);
  } catch (err) {
    console.error(err);
    showView(viewInput);
    inputError.textContent = err.message || "Ocorreu um erro a calcular a rota.";
    inputError.hidden = false;
  }
});

btnNewRoute.addEventListener("click", () => {
  showView(viewInput);
});

/* =========================================================
   PWA: registar service worker
   ========================================================= */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker não registado:", err);
    });
  });
}
