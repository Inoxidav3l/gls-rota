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
   Carregamento da biblioteca Maps JavaScript API

   Importante: as APIs REST "clássicas" (Geocoding, Directions)
   só aceitam chaves SEM restrição de site, ou restritas por IP —
   não funcionam com chaves restritas por "Sites" (referenciador
   HTTP), que é o que configurámos por segurança. A biblioteca
   Maps JavaScript API é a via pensada para correr no browser e
   funciona corretamente com chaves restritas por site.
   ========================================================= */

let googleMapsBootstrapped = false;

function bootstrapGoogleMaps(apiKey) {
  if (googleMapsBootstrapped) return;
  googleMapsBootstrapped = true;

  // Bootstrap loader oficial da Google (define google.maps.importLibrary
  // sem carregar nada da API até este ser chamado pela primeira vez).
  (function (g) {
    var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__",
      m = document, b = window;
    b = b[c] || (b[c] = {});
    var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
      u = () => h || (h = new Promise(async (f, n) => {
        await (a = m.createElement("script"));
        e.set("libraries", [...r] + "");
        for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
        e.set("callback", c + ".maps." + q);
        a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
        d[q] = f;
        a.onerror = () => (h = n(Error(p + " could not load.")));
        a.nonce = m.querySelector("script[nonce]")?.nonce || "";
        m.head.append(a);
      }));
    d[l] ? console.warn(p + " only loads once. Ignoring:", g) : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({
    key: apiKey,
    v: "weekly",
    language: "pt-PT",
    region: "PT",
  });
}

const libraryImportPromises = {};

function importGoogleLibrary(apiKey, name) {
  bootstrapGoogleMaps(apiKey);
  if (!libraryImportPromises[name]) {
    libraryImportPromises[name] = google.maps.importLibrary(name);
  }
  return libraryImportPromises[name];
}

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

// Portugal não tem um único tipo de componente "freguesia" fiável no
// Geocoding API — tenta os tipos mais prováveis, do mais específico
// para o mais genérico, e usa o primeiro que encontrar.
const PARISH_COMPONENT_PRIORITY = [
  "sublocality_level_1",
  "sublocality",
  "administrative_area_level_3",
  "postal_town",
  "locality",
];

function extractParish(addressComponents) {
  if (!addressComponents) return "Sem freguesia identificada";
  for (const type of PARISH_COMPONENT_PRIORITY) {
    const match = addressComponents.find((c) => c.types.includes(type));
    if (match) return match.long_name;
  }
  return "Sem freguesia identificada";
}

let geocoderInstance = null;

async function geocodeAddress(address, apiKey) {
  const key = normalizeAddressKey(address);
  if (geocodeCache[key]) return geocodeCache[key];

  if (!geocoderInstance) {
    const { Geocoder } = await importGoogleLibrary(apiKey, "geocoding");
    geocoderInstance = new Geocoder();
  }

  const result = await new Promise((resolve, reject) => {
    geocoderInstance.geocode({ address, region: "PT" }, (results, status) => {
      if (status !== "OK" || !results || !results.length) {
        reject(new Error("Não foi possível localizar: \"" + address + "\" (" + status + ")"));
        return;
      }
      const loc = results[0].geometry.location;
      resolve({
        lat: loc.lat(),
        lng: loc.lng(),
        formatted: results[0].formatted_address,
        parish: extractParish(results[0].address_components),
      });
    });
  });

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

function optimizeWithinGroup(entryPoint, points) {
  const nn = nearestNeighborOrder(entryPoint, points);
  return twoOptImprove(entryPoint, nn);
}

// Agrupa as paragens por freguesia, decide a ordem das freguesias pela
// proximidade (a partir do depósito, depois de freguesia em freguesia),
// e dentro de cada freguesia otimiza a sequência das paragens. Isto
// garante que a carrinha pode ser carregada por ordem de visita sem
// misturar freguesias, mesmo que isso não seja o caminho geometricamente
// mais curto possível.
function optimizeOrderByParish(depot, points) {
  const groups = new Map();
  for (const p of points) {
    const label = p.parish || "Sem freguesia identificada";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  }

  const remainingGroups = new Map(groups);
  const orderedGroups = []; // [{ parish, stops: [...] }]
  let cursor = depot;

  while (remainingGroups.size) {
    // escolhe a próxima freguesia pela distância do seu ponto mais
    // próximo ao cursor atual (fim da freguesia anterior, ou depósito)
    let bestLabel = null;
    let bestPoint = null;
    let bestDist = Infinity;
    for (const [label, pts] of remainingGroups) {
      for (const p of pts) {
        const d = haversineMeters(cursor, p);
        if (d < bestDist) {
          bestDist = d;
          bestLabel = label;
          bestPoint = p;
        }
      }
    }

    const groupPoints = remainingGroups.get(bestLabel);
    remainingGroups.delete(bestLabel);

    const orderedStops = optimizeWithinGroup(cursor, groupPoints);
    orderedGroups.push({ parish: bestLabel, stops: orderedStops });
    cursor = orderedStops[orderedStops.length - 1];
  }

  return orderedGroups;
}

/* =========================================================
   Routes API — percurso real com trânsito, com fragmentação
   automática para não ultrapassar o limite de waypoints
   por pedido (usamos blocos de 23 intermédios).
   ========================================================= */

const MAX_INTERMEDIATES_PER_CALL = 23;

let directionsServiceInstance = null;

async function computeRouteChunk(origin, destination, intermediates, apiKey) {
  const { DirectionsService, TravelMode } = await importGoogleLibrary(apiKey, "routes");
  if (!directionsServiceInstance) {
    directionsServiceInstance = new DirectionsService();
  }

  const request = {
    origin: { lat: origin.lat, lng: origin.lng },
    destination: { lat: destination.lat, lng: destination.lng },
    waypoints: intermediates.map((p) => ({
      location: { lat: p.lat, lng: p.lng },
      stopover: true,
    })),
    optimizeWaypoints: false,
    travelMode: TravelMode.DRIVING,
    drivingOptions: {
      departureTime: new Date(),
      trafficModel: "bestguess",
    },
  };

  return new Promise((resolve, reject) => {
    directionsServiceInstance.route(request, (result, status) => {
      if (status !== "OK" || !result.routes || !result.routes.length) {
        reject(new Error("Não foi possível traçar este troço da rota (" + status + ")"));
        return;
      }
      resolve(result.routes[0]);
    });
  });
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

    for (const leg of route.legs) {
      for (const step of leg.steps) {
        for (const pt of step.path) {
          fullCoords.push([pt.lat(), pt.lng()]);
        }
      }
      totalDistance += leg.distance ? leg.distance.value : 0;
      totalDuration += leg.duration_in_traffic
        ? leg.duration_in_traffic.value
        : leg.duration
        ? leg.duration.value
        : 0;
    }

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
  map.invalidateSize();
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

function renderStopList(depot, orderedGroups) {
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

  const totalStops = orderedGroups.reduce((sum, g) => sum + g.stops.length, 0);
  let globalIdx = 0;

  orderedGroups.forEach((group) => {
    const header = document.createElement("li");
    header.className = "stop-group-header";
    header.innerHTML =
      escapeHtml(group.parish) +
      '<span class="stop-group-header__count">' + group.stops.length +
      (group.stops.length === 1 ? " paragem" : " paragens") + "</span>";
    stopList.appendChild(header);

    group.stops.forEach((s) => {
      globalIdx++;
      const li = document.createElement("li");
      li.className = "stop-item";
      li.innerHTML =
        '<span class="stop-item__badge">' + globalIdx + "</span>" +
        '<span class="stop-item__text">' +
        '<div class="stop-item__addr">' + escapeHtml(s.formatted || s.original) + "</div>" +
        '<div class="stop-item__meta">Paragem ' + globalIdx + " de " + totalStops + "</div>" +
        "</span>" +
        '<span class="stop-item__go">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M9 18l6-6-6-6"/></svg></span>';
      li.addEventListener("click", () => window.open(navigationUrl(s), "_blank"));
      stopList.appendChild(li);
    });
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

    // 3. Ordenar por freguesia (para facilitar o carregamento da
    //    carrinha), e dentro de cada freguesia otimizar a sequência
    setLoading("A agrupar por freguesia e a calcular a sequência...", validPoints.length + " paragens");
    const orderedGroups = optimizeOrderByParish(depot, validPoints);
    const orderedStops = orderedGroups.flatMap((g) => g.stops);

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

    // 5. Render — mostrar o ecrã ANTES de inicializar o Leaflet, senão
    //    o mapa nasce com tamanho zero (container ainda escondido) e
    //    os tiles nunca chegam a aparecer.
    showView(viewRoute);
    renderMap(depot, orderedStops, routeResult ? routeResult.polyline : null);
    renderStopList(depot, orderedGroups);

    let summary = orderedStops.length + " paragens";
    if (routeResult) {
      summary += " · " + formatDistance(routeResult.distanceMeters) + " · " + formatDuration(routeResult.durationSeconds);
    }
    if (failedPoints.length) {
      summary += " · " + failedPoints.length + " não localizadas";
    }
    routeSummary.textContent = summary;
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
