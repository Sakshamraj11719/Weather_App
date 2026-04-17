/* ==========================
QUICK START – IMPORTANT
1) OpenWeather API key for weather data
2) Windy API key for animated map
3) News API key for location news (using free tier)
========================== */
const OPENWEATHER_API_KEY = "b596a757840492bbee2590c527f7d091";
const WINDY_API_KEY = ""; // Add your Windy API key here if you have one; empty = uses Leaflet fallback
const Geoapify_API_KEY = "6edeaf9783ba4e94bbaa4f9466fa12de";
const NEWS_API_KEY = "93b4eae8222b40be0e15b1397545f86b";

// Basic helpers
const $ = (sel) => document.querySelector(sel);
const fmtInt = (n) => Math.round(n).toString();
const toKmh = (ms) => (ms * 3.6).toFixed(0);
const toMph = (ms) => (ms * 2.23694).toFixed(0);
const dtFmt = (ts, tz) => new Date((ts + tz) * 1000);
const pad = (n) => String(n).padStart(2, "0");

// State
const state = {
  windyAPI: null,
  windyMap: null,
  leafletMap: null,
  leafletMarker: null,
  units: localStorage.getItem("units") || "metric",
  last: JSON.parse(localStorage.getItem("lastCoord") || "null") || {
    lat: 12.9716,
    lon: 77.5946,
  },
  lastName: localStorage.getItem("lastName") || "Bengaluru, IN",
  theme: localStorage.getItem("theme") || "night",
  chart: null,
  currentCity: null,
  clockInterval: null,
};

// Theme handling
function applyTheme() {
  const isDay = state.theme === "day";
  document.body.classList.toggle("day", isDay);
  const btn = $("#btnTheme");
  btn.textContent = isDay ? "☀️ Day" : "🌙 Night";
  btn.setAttribute("aria-pressed", String(isDay));
}

$("#btnTheme").addEventListener("click", () => {
  state.theme = state.theme === "day" ? "night" : "day";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});
applyTheme();

// Init units UI
$("#units").value = state.units;

// Initialize Windy Map
function initWindy() {
  const options = {
    key: WINDY_API_KEY,
    verbose: false,
    lat: state.last.lat,
    lon: state.last.lon,
    zoom: 9,
  };

  windyInit(options, (windyAPI) => {
    // Windy exposes: map, store, broadcast, picker, utils, overlays, products, timeline
    const { map, store, broadcast } = windyAPI;
    state.windyAPI = windyAPI;
    state.windyMap = map;

    // Set wind overlay with correct API keys
    store.set('overlay', 'wind');        // layer type
    store.set('particlesAnim', 'on');    // correct key for wind particle animation
    store.set('acTime', 'next24h');      // show next 24h timeline

    // Force a redraw after setting store values
    broadcast.fire('redrawLayer');

    // Invalidate map size so tiles render correctly in the layout
    setTimeout(() => {
      map.invalidateSize();
      // Trigger timeline to start playing automatically
      broadcast.fire('rqstOpen', 'detail');
    }, 400);

    // Re-center if coords already loaded
    if (state.last) {
      map.setView([state.last.lat, state.last.lon], 9);
    }

    // Sync the dropdown UI to match initial state
    const layerSelect = document.getElementById('windyLayer');
    if (layerSelect) layerSelect.value = 'wind';

    console.log('✅ Windy map initialized');
  });
}

// Retry waiting for windyInit to be available (handles slow CDN loads)
function waitForWindyAndInit(retries = 20, delay = 500) {
  if (!WINDY_API_KEY) {
    // No Windy key configured — use Leaflet immediately
    console.warn('⚠️ No WINDY_API_KEY set — using Leaflet fallback map');
    const windyEl = document.getElementById('windy');
    if (windyEl) windyEl.style.display = 'none';
    initLeafletFallback();
  } else if (typeof windyInit === 'function') {
    initWindy();
  } else if (retries > 0) {
    setTimeout(() => waitForWindyAndInit(retries - 1, delay), delay);
  } else {
    console.warn('⚠️ Windy API unavailable — switching to Leaflet fallback map');
    const windyEl = document.getElementById('windy');
    if (windyEl) windyEl.style.display = 'none';
    initLeafletFallback();
  }
}

// Leaflet fallback map (used when Windy API key is invalid/unavailable)
function initLeafletFallback() {
  const container = document.getElementById('leafletFallbackMap');
  if (!container || !window.L) return;

  container.style.display = 'block';

  // Update the section header note
  const note = document.querySelector('.section.note');
  if (note) note.textContent = '🗺️ Map powered by Geoapify + OpenWeatherMap layers';

  const lat = state.last?.lat || 20.5937;
  const lon = state.last?.lon || 78.9629;

  // If already initialized, just re-center
  if (state.leafletMap) {
    state.leafletMap.setView([lat, lon], 9);
    if (state.leafletMarker) state.leafletMarker.setLatLng([lat, lon]);
    return;
  }

  const map = L.map('leafletFallbackMap', { zoomControl: true }).setView([lat, lon], 9);
  state.leafletMap = map;

  // Geoapify tile layer
  L.tileLayer('https://maps.geoapify.com/v1/tile/carto/{z}/{x}/{y}.png?&apiKey=6edeaf9783ba4e94bbaa4f9466fa12de', {
    attribution: '© <a href="https://www.geoapify.com/">Geoapify</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 20,
  }).addTo(map);

  // OpenWeatherMap weather layer overlay
  const weatherLayer = document.getElementById('windyLayer')?.value || 'wind';
  const owmLayerMap = { wind: 'wind', rain: 'precipitation_new', clouds: 'clouds_new', temp: 'temp_new', pressure: 'pressure_new', waves: 'wind' };
  const owmLayer = owmLayerMap[weatherLayer] || 'wind';

  let currentOWMLayer = L.tileLayer(`https://tile.openweathermap.org/map/${owmLayer}/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`, {
    opacity: 0.6,
    maxZoom: 18,
  }).addTo(map);

  // City marker
  state.leafletMarker = L.marker([lat, lon]).addTo(map);

  // Update OWM layer when dropdown changes
  document.getElementById('windyLayer')?.addEventListener('change', (e) => {
    if (!state.leafletMap) return;
    const newOwmLayer = owmLayerMap[e.target.value] || 'wind';
    if (currentOWMLayer) state.leafletMap.removeLayer(currentOWMLayer);
    currentOWMLayer = L.tileLayer(`https://tile.openweathermap.org/map/${newOwmLayer}/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`, {
      opacity: 0.6, maxZoom: 18,
    }).addTo(state.leafletMap);
  });
}

// Change Windy layer
$("#windyLayer")?.addEventListener("change", (e) => {
  if (!state.windyAPI) return;
  const { store, broadcast } = state.windyAPI;
  const layer = e.target.value;

  store.set('overlay', layer);

  // Particle animation only makes sense on wind and waves layers
  const hasParticles = layer === 'wind' || layer === 'waves';
  store.set('particlesAnim', hasParticles ? 'on' : 'off');

  // Force Windy to redraw with the new layer
  broadcast.fire('redrawLayer');
});

// API helpers
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("API error " + r.status);
  return r.json();
}

async function geocodeCity(q) {
  const url = `/api/geocode?q=${encodeURIComponent(q)}`;
  const [hit] = await getJSON(url);
  if (!hit) throw new Error("City not found");
  const name = `${hit.name}${hit.state ? ", " + hit.state : ""}, ${hit.country}`;
  return { lat: hit.lat, lon: hit.lon, name, country: hit.country, state: hit.state, cityName: hit.name };
}

async function reverseGeocode(lat, lon) {
  const url = `/api/reverse-geocode?lat=${lat}&lon=${lon}`;
  const [hit] = await getJSON(url);
  if (hit) {
    return `${hit.name}${hit.state ? ", " + hit.state : ""}, ${hit.country}`;
  }
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

async function fetchAll(lat, lon) {
  const units = state.units;
  // Use backend proxy routes — keeps API key server-side and handles auth
  const cur = `/api/weather?lat=${lat}&lon=${lon}&units=${units}`;
  const fc  = `/api/forecast?lat=${lat}&lon=${lon}&units=${units}`;
  const aqi = `/api/air-pollution?lat=${lat}&lon=${lon}`;
  const [cw, fw, aq] = await Promise.all([getJSON(cur), getJSON(fc), getJSON(aqi)]);
  return { cw, fw, aq };
}

// UI update
function weatherEmoji(id) {
  if (id >= 200 && id < 300) return "⛈️";
  if (id >= 300 && id < 600) return "🌧️";
  if (id >= 600 && id < 700) return "❄️";
  if (id === 711) return "🌫️";
  if (id >= 700 && id < 800) return "🌫";
  if (id === 800) return "☀️";
  if (id === 801) return "🌤️";
  if (id === 802) return "⛅";
  if (id >= 803) return "☁️";
  return "🌡️";
}

function setCurrent(cw) {
  const u = state.units;
  $("#city").textContent = `${cw.name}, ${cw.sys.country}`;
  $("#temp").textContent = `${fmtInt(cw.main.temp)}°${u === "metric" ? "C" : "F"}`;
  $("#desc").textContent = cw.weather?.[0]?.description || "";
  $("#wIcon").textContent = weatherEmoji(cw.weather?.[0]?.id || 800);
  $("#feels").textContent = `${fmtInt(cw.main.feels_like)}°`;
  $("#hum").textContent = `${cw.main.humidity}%`;
  const wind = u === "imperial" ? `${toMph(cw.wind.speed)} mph` : `${toKmh(cw.wind.speed)} km/h`;
  $("#wind").textContent = `${wind} ${cw.wind.deg != null ? "• " + cw.wind.deg + "°" : ""}`;
  $("#press").textContent = `${cw.main.pressure} hPa`;
  $("#vis").textContent = `${(cw.visibility / 1000).toFixed(1)} km`;
  const tz = cw.timezone || 0;
  const sr = dtFmt(cw.sys.sunrise, tz);
  const ss = dtFmt(cw.sys.sunset, tz);
  $("#sun").textContent = `${pad(sr.getHours())}:${pad(sr.getMinutes())} / ${pad(ss.getHours())}:${pad(ss.getMinutes())}`;
}

function setAQI(aq) {
  const val = aq?.list?.[0]?.main?.aqi || 0;
  const comps = aq?.list?.[0]?.components || {};
  const label = ["—", "Good", "Fair", "Moderate", "Poor", "Very Poor"][val] || "—";
  const bg = ["#0b1220", "#065f46", "#065f46", "#92400e", "#7f1d1d", "#7f1d1d"][val] || "#0b1220";
  const fg = ["#e5e7eb", "#a7f3d0", "#a7f3d0", "#fde68a", "#fecaca", "#fecaca"][val] || "#e5e7eb";
  const el = $("#aqiBadge");
  el.textContent = `AQI ${val || "—"} — ${label}`;
  el.style.background = bg;
  el.style.color = fg;
  el.style.borderColor = "var(--border)";
  $("#pm25").textContent = comps.pm2_5 != null ? comps.pm2_5.toFixed(1) : "—";
  $("#pm10").textContent = comps.pm10 != null ? comps.pm10.toFixed(1) : "—";
  $("#no2").textContent = comps.no2 != null ? comps.no2.toFixed(1) : "—";
  $("#o3").textContent = comps.o3 != null ? comps.o3.toFixed(1) : "—";
  $("#so2").textContent = comps.so2 != null ? comps.so2.toFixed(1) : "—";
  $("#co").textContent = comps.co != null ? (comps.co * 1).toFixed(1) : "—";
}

function setForecast(fw) {
  const hours = fw.list.slice(0, 8);
  const labels = hours.map((x) => x.dt_txt.slice(11, 16));
  const temps = hours.map((x) => x.main.temp);
  if (state.chart) state.chart.destroy();
  const ctx = document.getElementById("hourlyChart");
  state.chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Temp", data: temps, tension: 0.35, fill: true }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: "rgba(0,0,0,.15)" } } },
    },
  });
  const byDay = {};
  for (const item of fw.list) {
    const d = item.dt_txt.slice(0, 10);
    byDay[d] = byDay[d] || { temps: [], icons: [] };
    byDay[d].temps.push(item.main.temp);
    byDay[d].icons.push(item.weather?.[0]?.id || 800);
  }
  const days = Object.entries(byDay).slice(0, 5);
  const fc = $("#forecast");
  fc.innerHTML = "";
  for (const [date, obj] of days) {
    const tmin = Math.min(...obj.temps);
    const tmax = Math.max(...obj.temps);
    const counts = obj.icons.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});
    const id = Object.entries(counts).sort((a, b) => a[1] - b[1]).pop()[0];
    const d = new Date(date);
    const day = d.toLocaleDateString(undefined, { weekday: "short" });
    const el = document.createElement("div");
    el.className = "fcard";
    el.innerHTML = `<div class="day">${day}</div><div class="ix">${weatherEmoji(Number(id))}</div><div>${fmtInt(tmin)}° / ${fmtInt(tmax)}°</div>`;
    fc.appendChild(el);
  }
}

// NEWS FUNCTIONS
async function fetchNews(cityName, countryCode) {
  console.log('📰 fetchNews called for:', cityName, countryCode);
  
  const newsContainer = $("#newsContainer");
  if (!newsContainer) {
    console.error('News container not found!');
    return;
  }

  // Update city label in the news section header
  const cityLabel = document.getElementById('newsCityLabel');
  if (cityLabel) cityLabel.textContent = `📍 ${cityName}${countryCode ? ', ' + countryCode : ''}`;

  newsContainer.innerHTML = '<div class="news-loading">Loading news...</div>';

  if (!NEWS_API_KEY || NEWS_API_KEY === "YOUR_GNEWS_API_KEY") {
    newsContainer.innerHTML = `
      <div class="news-placeholder">
        <p>📰 To view latest news for ${cityName}, please configure a news API key.</p>
        <p style="font-size: 12px; color: var(--muted); margin-top: 8px;">
          Get a free API key from <a href="https://gnews.io" target="_blank" class="link">GNews.io</a> 
          and add it to script.js
        </p>
      </div>`;
    return;
  }

  try {
    const query = encodeURIComponent(cityName);
    const url = `https://gnews.io/api/v4/search?q=${query}&lang=en&max=5&apikey=${NEWS_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.errors && data.errors.length > 0) {
      console.error('GNews API errors:', data.errors);
      newsContainer.innerHTML = `
        <div class="news-error">
          <p>API Error: ${data.errors[0]}</p>
          <p style="font-size: 12px; margin-top: 8px;">Please check your API key</p>
        </div>`;
      return;
    }

    if (data.articles && data.articles.length > 0) {
      displayNews(data.articles);
    } else {
      newsContainer.innerHTML = `
        <div class="news-placeholder">
          <p>📰 No recent news found for ${cityName}</p>
          <p style="font-size: 12px; color: var(--muted); margin-top: 8px;">
            Try a larger city or different location
          </p>
        </div>`;
    }
  } catch (error) {
    console.error('News fetch error:', error);
    newsContainer.innerHTML = `
      <div class="news-error">
        <p>Unable to load news</p>
        <p style="font-size: 12px; margin-top: 8px;">${error.message}</p>
      </div>`;
  }
}

function displayNews(articles) {
  const newsContainer = $("#newsContainer");
  newsContainer.innerHTML = "";
  newsContainer.className = "news-container news-container-grid";
  
  articles.slice(0, 5).forEach(article => {
    const newsItem = document.createElement("div");
    newsItem.className = "news-item";
    const timeAgo = getTimeAgo(new Date(article.publishedAt));
    newsItem.innerHTML = `
      <div class="news-content">
        ${article.image ? `<img src="${article.image}" alt="${article.title}" class="news-image" onerror="this.style.display='none'">` : ''}
        <div class="news-text">
          <h4 class="news-title">
            <a href="${article.url}" target="_blank" rel="noopener noreferrer">${article.title}</a>
          </h4>
          <p class="news-description">${article.description || ''}</p>
          <div class="news-meta">
            <span class="news-source">${article.source.name}</span>
            <span class="news-time">${timeAgo}</span>
          </div>
        </div>
      </div>`;
    newsContainer.appendChild(newsItem);
  });
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  const intervals = { year: 31536000, month: 2592000, week: 604800, day: 86400, hour: 3600, minute: 60 };
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
  }
  return 'Just now';
}

// ========================================
// CITY INFORMATION FUNCTIONS
// ========================================

// City database with comprehensive information
const cityDatabase = {
  // Format: "City, Country" or just "City"
  "London": {
    country: "United Kingdom",
    population: "9,002,000",
    currency: "British Pound (£)",
    language: "English",
    capital: "London (itself)",
    region: "England",
    callingCode: "+44",
    domain: ".uk",
    climate: "Temperate oceanic",
    bestTime: "May to September",
    avgTemp: "11°C (52°F)",
    attractions: [
      { icon: "🏰", name: "Tower of London", desc: "Historic castle on the Thames" },
      { icon: "🎡", name: "London Eye", desc: "Giant Ferris wheel with city views" },
      { icon: "🏛️", name: "British Museum", desc: "World-famous history museum" },
      { icon: "👑", name: "Buckingham Palace", desc: "Royal residence" },
    ],
    funFacts: [
      "London has over 170 museums, more than any other city",
      "The London Underground is the oldest subway system in the world (1863)",
      "Big Ben is actually the name of the bell, not the clock tower",
      "London was founded by the Romans around 43 AD as 'Londinium'",
    ]
  },
  "New York": {
    country: "United States",
    population: "8,336,000",
    currency: "US Dollar ($)",
    language: "English",
    capital: "Albany (state capital)",
    region: "New York State",
    callingCode: "+1",
    domain: ".us",
    climate: "Humid subtropical",
    bestTime: "April to June, September to November",
    avgTemp: "13°C (55°F)",
    attractions: [
      { icon: "🗽", name: "Statue of Liberty", desc: "Iconic symbol of freedom" },
      { icon: "🌳", name: "Central Park", desc: "843-acre urban park" },
      { icon: "🏙️", name: "Empire State Building", desc: "Art Deco skyscraper" },
      { icon: "🎭", name: "Times Square", desc: "Bright lights and Broadway" },
    ],
    funFacts: [
      "New York City has over 800 languages spoken, making it the most linguistically diverse city",
      "Central Park is larger than Monaco",
      "The Federal Reserve Bank in Manhattan holds 25% of the world's gold",
      "NYC's subway system is the largest in the world by number of stations (472)",
    ]
  },
  "Tokyo": {
    country: "Japan",
    population: "14,094,000",
    currency: "Japanese Yen (¥)",
    language: "Japanese",
    capital: "Tokyo (itself)",
    region: "Kantō",
    callingCode: "+81",
    domain: ".jp",
    climate: "Humid subtropical",
    bestTime: "March to May, September to November",
    avgTemp: "16°C (61°F)",
    attractions: [
      { icon: "⛩️", name: "Senso-ji Temple", desc: "Ancient Buddhist temple" },
      { icon: "🗼", name: "Tokyo Tower", desc: "Communications tower" },
      { icon: "🏯", name: "Imperial Palace", desc: "Emperor's residence" },
      { icon: "🌸", name: "Shinjuku Gyoen", desc: "Beautiful garden park" },
    ],
    funFacts: [
      "Tokyo is the world's largest metropolitan economy",
      "The city has a vending machine for every 23 people",
      "Tokyo's Tsukiji Fish Market is the largest wholesale fish market",
      "More than 3.5 million people use Tokyo's subway daily",
    ]
  },
  "Paris": {
    country: "France",
    population: "2,161,000",
    currency: "Euro (€)",
    language: "French",
    capital: "Paris (itself)",
    region: "Île-de-France",
    callingCode: "+33",
    domain: ".fr",
    climate: "Oceanic",
    bestTime: "April to June, September to October",
    avgTemp: "12°C (54°F)",
    attractions: [
      { icon: "🗼", name: "Eiffel Tower", desc: "Iconic iron lattice tower" },
      { icon: "🖼️", name: "Louvre Museum", desc: "World's largest art museum" },
      { icon: "⛪", name: "Notre-Dame", desc: "Gothic cathedral" },
      { icon: "🎨", name: "Montmartre", desc: "Artistic hilltop neighborhood" },
    ],
    funFacts: [
      "Paris has only one stop sign in the entire city",
      "The Louvre is the world's most visited museum",
      "There are more than 470,000 trees in Paris",
      "The Eiffel Tower was supposed to be temporary",
    ]
  },
  "Dubai": {
    country: "United Arab Emirates",
    population: "3,604,000",
    currency: "UAE Dirham (AED)",
    language: "Arabic",
    capital: "Abu Dhabi (UAE capital)",
    region: "Dubai Emirate",
    callingCode: "+971",
    domain: ".ae",
    climate: "Desert",
    bestTime: "November to March",
    avgTemp: "27°C (81°F)",
    attractions: [
      { icon: "🏙️", name: "Burj Khalifa", desc: "World's tallest building" },
      { icon: "🏖️", name: "Palm Jumeirah", desc: "Artificial archipelago" },
      { icon: "🛍️", name: "Dubai Mall", desc: "Largest shopping mall" },
      { icon: "⛲", name: "Dubai Fountain", desc: "Choreographed fountain" },
    ],
    funFacts: [
      "Dubai has no street addresses - directions are based on landmarks",
      "20% of the world's cranes are in Dubai",
      "The Burj Khalifa is so tall you can watch two sunsets from it",
      "Dubai's police force has Lamborghinis and Ferraris",
    ]
  },
  "Bengaluru": {
    country: "India",
    population: "12,765,000",
    currency: "Indian Rupee (₹)",
    language: "Kannada, English",
    capital: "Bengaluru (Karnataka capital)",
    region: "Karnataka",
    callingCode: "+91",
    domain: ".in",
    climate: "Tropical savanna",
    bestTime: "October to February",
    avgTemp: "24°C (75°F)",
    attractions: [
      { icon: "🏛️", name: "Lalbagh Botanical Garden", desc: "Historic garden" },
      { icon: "🕌", name: "Bangalore Palace", desc: "Royal Tudor-style palace" },
      { icon: "🌳", name: "Cubbon Park", desc: "Green lung of the city" },
      { icon: "🛕", name: "ISKCON Temple", desc: "Spiritual landmark" },
    ],
    funFacts: [
      "Bangalore is called the 'Silicon Valley of India'",
      "The city has more pubs and breweries than any other Indian city",
      "Bangalore is at an elevation of 3,000 feet, giving it a pleasant climate",
      "It's one of India's fastest-growing major metropolises",
    ]
  },
  "Sydney": {
    country: "Australia",
    population: "5,312,000",
    currency: "Australian Dollar ($)",
    language: "English",
    capital: "Canberra (Australia capital)",
    region: "New South Wales",
    callingCode: "+61",
    domain: ".au",
    climate: "Humid subtropical",
    bestTime: "September to November, March to May",
    avgTemp: "18°C (64°F)",
    attractions: [
      { icon: "🎭", name: "Sydney Opera House", desc: "Iconic performing arts venue" },
      { icon: "🌉", name: "Sydney Harbour Bridge", desc: "Steel arch bridge" },
      { icon: "🏖️", name: "Bondi Beach", desc: "Famous beach" },
      { icon: "🦘", name: "Taronga Zoo", desc: "Harbor-side zoo" },
    ],
    funFacts: [
      "Sydney is the oldest city in Australia",
      "The Sydney Opera House took 14 years to build",
      "Sydney has over 100 beaches",
      "It's home to the world's largest natural harbor",
    ]
  },
  // Add more cities as needed
};

// Get city info from database or generate generic info
function getCityInfo(cityName, countryCode) {
  // Try exact match first
  if (cityDatabase[cityName]) {
    return cityDatabase[cityName];
  }
  
  // Try without country code
  const baseName = cityName.split(',')[0].trim();
  if (cityDatabase[baseName]) {
    return cityDatabase[baseName];
  }
  
  // Return generic info
  return generateGenericCityInfo(cityName, countryCode);
}

function generateGenericCityInfo(cityName, countryCode) {
  const countryInfo = getCountryInfo(countryCode);
  
  return {
    country: countryInfo.name,
    population: "Data unavailable",
    currency: countryInfo.currency,
    language: countryInfo.language,
    capital: countryInfo.capital,
    region: "—",
    callingCode: countryInfo.callingCode,
    domain: countryInfo.domain,
    climate: "Varies by season",
    bestTime: "Research recommended",
    avgTemp: "—",
    attractions: null, // Will be AI-generated
    funFacts: [
      `${cityName} is located in ${countryInfo.name}`,
      `The official currency is ${countryInfo.currency}`,
      `Primary language spoken is ${countryInfo.language}`,
    ]
  };
}

// ========================================
// AI-POWERED ATTRACTIONS (Claude API)
// ========================================

async function fetchAIAttractions(cityName, countryName) {
  const container = $("#attractionsContainer");
  container.innerHTML = `
    <div class="ai-loading">
      <div class="ai-spinner"></div>
      <span>Discovering places in ${cityName}...</span>
    </div>`;

  try {
    const res = await fetch('/api/ai/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: 'You are a travel expert. Always respond with valid JSON only. No markdown, no explanation, no code fences. Never include any text outside the JSON array.',
        messages: [{
          role: 'user',
          content: `List exactly 6 real tourist attractions for ${cityName}, ${countryName}. Return ONLY a JSON array, nothing else: [{"icon":"emoji","name":"Place Name","desc":"One sentence under 12 words"},...]`
        }],
        max_tokens: 600
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(typeof data.error === 'object' ? JSON.stringify(data.error) : data.error);

    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/gi, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in response');

    const attractions = JSON.parse(match[0]);
    displayAttractions(attractions);

    // Also fetch AI fun facts
    fetchAIFunFacts(cityName, countryName);

  } catch (err) {
    console.warn("AI attractions failed:", err);
    container.innerHTML = `<div class="ai-error">⚠️ Could not load attractions: ${err.message}</div>`;
  }
}

async function fetchAIFunFacts(cityName, countryName) {
  try {
    const res = await fetch('/api/ai/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: 'You are a travel expert. Always respond with valid JSON only. No markdown, no explanation, no code fences. Never include any text outside the JSON array.',
        messages: [{
          role: 'user',
          content: `Give 4 surprising, specific fun facts about ${cityName}, ${countryName}. Return ONLY a JSON array of strings, nothing else: ["fact1","fact2","fact3","fact4"]`
        }],
        max_tokens: 400
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(typeof data.error === 'object' ? JSON.stringify(data.error) : data.error);

    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/gi, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');

    const facts = JSON.parse(match[0]);
    displayFunFacts(facts);
  } catch (err) {
    console.warn("AI fun facts failed:", err);
    // Silently fail — generic facts remain visible
  }
}

function getCountryInfo(countryCode) {
  const countries = {
    "US": { name: "United States", currency: "US Dollar ($)", language: "English", capital: "Washington D.C.", callingCode: "+1", domain: ".us" },
    "GB": { name: "United Kingdom", currency: "British Pound (£)", language: "English", capital: "London", callingCode: "+44", domain: ".uk" },
    "IN": { name: "India", currency: "Indian Rupee (₹)", language: "Hindi, English", capital: "New Delhi", callingCode: "+91", domain: ".in" },
    "FR": { name: "France", currency: "Euro (€)", language: "French", capital: "Paris", callingCode: "+33", domain: ".fr" },
    "DE": { name: "Germany", currency: "Euro (€)", language: "German", capital: "Berlin", callingCode: "+49", domain: ".de" },
    "JP": { name: "Japan", currency: "Japanese Yen (¥)", language: "Japanese", capital: "Tokyo", callingCode: "+81", domain: ".jp" },
    "CN": { name: "China", currency: "Chinese Yuan (¥)", language: "Mandarin", capital: "Beijing", callingCode: "+86", domain: ".cn" },
    "AU": { name: "Australia", currency: "Australian Dollar ($)", language: "English", capital: "Canberra", callingCode: "+61", domain: ".au" },
    "CA": { name: "Canada", currency: "Canadian Dollar ($)", language: "English, French", capital: "Ottawa", callingCode: "+1", domain: ".ca" },
    "BR": { name: "Brazil", currency: "Brazilian Real (R$)", language: "Portuguese", capital: "Brasília", callingCode: "+55", domain: ".br" },
    "IT": { name: "Italy", currency: "Euro (€)", language: "Italian", capital: "Rome", callingCode: "+39", domain: ".it" },
    "ES": { name: "Spain", currency: "Euro (€)", language: "Spanish", capital: "Madrid", callingCode: "+34", domain: ".es" },
    "AE": { name: "United Arab Emirates", currency: "UAE Dirham (AED)", language: "Arabic", capital: "Abu Dhabi", callingCode: "+971", domain: ".ae" },
    "SG": { name: "Singapore", currency: "Singapore Dollar ($)", language: "English, Malay, Mandarin", capital: "Singapore", callingCode: "+65", domain: ".sg" },
  };
  
  return countries[countryCode] || { 
    name: countryCode, 
    currency: "—", 
    language: "—", 
    capital: "—", 
    callingCode: "—", 
    domain: "—" 
  };
}

// Display city information
async function displayCityInfo(cityData, weatherData) {
  const section = $("#cityInfoSection");
  const cityName = cityData.cityName || cityData.name;
  const countryCode = weatherData.sys.country;
  
  // Get city info
  const info = getCityInfo(cityName, countryCode);
  
  // Update header
  $("#cityInfoName").textContent = cityName;
  
  // Update basic info
  $("#infoCountry").textContent = info.country;
  $("#infoPopulation").textContent = info.population;
  $("#infoCoords").textContent = `${weatherData.coord.lat.toFixed(4)}°, ${weatherData.coord.lon.toFixed(4)}°`;
  $("#infoElevation").textContent = "—"; // Would need additional API
  $("#infoTimezone").textContent = `UTC${weatherData.timezone >= 0 ? '+' : ''}${(weatherData.timezone / 3600).toFixed(0)}`;
  
  // Update travel info
  $("#infoCurrency").textContent = info.currency;
  $("#infoLanguage").textContent = info.language;
  $("#infoCapital").textContent = info.capital;
  $("#infoRegion").textContent = info.region;
  $("#infoCallingCode").textContent = info.callingCode;
  $("#infoDomain").textContent = info.domain;
  
  // Update climate info
  $("#infoClimate").textContent = info.climate;
  $("#infoBestTime").textContent = info.bestTime;
  $("#infoAvgTemp").textContent = info.avgTemp;
  
  // Start live clock
  updateLocalTime(weatherData.timezone);
  if (state.clockInterval) clearInterval(state.clockInterval);
  state.clockInterval = setInterval(() => updateLocalTime(weatherData.timezone), 1000);
  
  // Display attractions - use hardcoded data for known cities, AI for unknown
  if (info.attractions) {
    displayAttractions(info.attractions);
    displayFunFacts(info.funFacts);
  } else {
    // AI-powered: fetch real attractions for any city
    fetchAIAttractions(cityName, info.country);
    displayFunFacts(info.funFacts); // Show basic facts immediately, AI will enhance them
  }
  
  // Try to load images from Unsplash
  loadCityImages(cityName);
  
  // Show the section
  section.style.display = 'block';
  
  // Smooth scroll to section
  setTimeout(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}

function updateLocalTime(timezoneOffset) {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const localTime = new Date(utc + (timezoneOffset * 1000));
  
  const hours = String(localTime.getHours()).padStart(2, '0');
  const minutes = String(localTime.getMinutes()).padStart(2, '0');
  const seconds = String(localTime.getSeconds()).padStart(2, '0');
  
  const dateStr = localTime.toLocaleDateString('en-US', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
  
  $("#infoLocalTime").textContent = `${hours}:${minutes}:${seconds} (${dateStr})`;
}

function displayAttractions(attractions) {
  const container = $("#attractionsContainer");
  container.innerHTML = "";
  
  attractions.forEach(attr => {
    const card = document.createElement("div");
    card.className = "attraction-card";
    card.innerHTML = `
      <div class="attraction-icon">${attr.icon}</div>
      <div class="attraction-name">${attr.name}</div>
      <div class="attraction-desc">${attr.desc}</div>
    `;
    container.appendChild(card);
  });
}

function displayFunFacts(facts) {
  const container = $("#funFactsContainer");
  container.innerHTML = "";
  
  const icons = ["💡", "🌟", "✨", "🎯", "🔥", "⭐"];
  
  facts.forEach((fact, index) => {
    const factEl = document.createElement("div");
    factEl.className = "fun-fact";
    factEl.innerHTML = `
      <div class="fun-fact-text">
        <span class="fun-fact-icon">${icons[index % icons.length]}</span>
        ${fact}
      </div>
    `;
    container.appendChild(factEl);
  });
}

async function loadCityImages(cityName) {
  const container = $("#cityGallery");
  container.innerHTML = '<div class="gallery-loading">Loading images...</div>';

  try {
    // Step 1: Search Wikipedia for pages related to the city
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cityName)}&srlimit=6&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    const pages = searchData?.query?.search || [];

    if (pages.length === 0) {
      throw new Error("No Wikipedia results found");
    }

    // Step 2: Get images for each page
    const pageIds = pages.map(p => p.pageid).join("|");
    const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageIds}&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*`;
    const imgRes = await fetch(imgUrl);
    const imgData = await imgRes.json();

    const queryPages = imgData?.query?.pages || {};

    // Step 3: Collect images that have thumbnails
    const images = [];
    for (const page of pages) {
      const pageInfo = queryPages[page.pageid];
      if (pageInfo?.thumbnail?.source) {
        images.push({
          url: pageInfo.thumbnail.source,
          caption: pageInfo.title,
        });
      }
      if (images.length >= 6) break;
    }

    container.innerHTML = "";

    if (images.length === 0) {
      throw new Error("No images found");
    }

    images.forEach(img => {
      const item = document.createElement("div");
      item.className = "gallery-item";
      item.innerHTML = `
        <img src="${img.url}" alt="${img.caption}" class="gallery-img" loading="lazy" onerror="this.parentElement.style.display='none'">
        <div class="gallery-caption">${img.caption}</div>
      `;
      container.appendChild(item);
    });

  } catch (err) {
    console.warn("Wikipedia images failed, using placeholders:", err.message);
    container.innerHTML = "";

    // Fallback: colored placeholder cards with city name
    const captions = ["Landmark", "Skyline", "Architecture", "Streets", "Culture", "Cuisine"];
    captions.forEach((cap, i) => {
      const item = document.createElement("div");
      item.className = "gallery-item";
      item.style.cssText = "background: linear-gradient(135deg, var(--panel), var(--bg)); display:flex; align-items:center; justify-content:center; flex-direction:column; gap:8px;";
      item.innerHTML = `
        <div style="font-size:36px">${["🏛️","🌆","🏗️","🛤️","🎭","🍽️"][i]}</div>
        <div style="font-size:13px; color:var(--muted); font-weight:600">${cityName} ${cap}</div>
        <div class="gallery-caption">${cityName} ${cap}</div>
      `;
      container.appendChild(item);
    });
  }
}

// Close city info section
$("#closeCityInfo")?.addEventListener("click", () => {
  $("#cityInfoSection").style.display = "none";
  if (state.clockInterval) {
    clearInterval(state.clockInterval);
    state.clockInterval = null;
  }
});

// ========================================
// MAIN UPDATE FUNCTION
// ========================================

async function updateAll(lat, lon, label, cityData = null) {
  try {
    const { cw, fw, aq } = await fetchAll(lat, lon);
    setCurrent(cw);
    setAQI(aq);
    setForecast(fw);
    fetchNews(cw.name, cw.sys.country);

    // Save snapshot to history DB
    saveWeatherSnapshot(cw, state.units);

    // Update favorite button state
    favState.currentLat = lat;
    favState.currentLon = lon;
    favState.currentCityName = cw.name;
    favState.currentCountry = cw.sys?.country || '';
    checkIsFavorite(lat, lon);

    // Load history chart
    loadHistoryChart(cw.name);
    const histCityEl = document.getElementById('historyChartCity');
    if (histCityEl) histCityEl.textContent = `${cw.name}, ${cw.sys.country}`;

    // Run weather alerts
    checkWeatherAlerts(cw, aq);

    // Update chatbot context and city name
    chatState.weatherContext = { cw, fw, aq };
    const chatCityEl = document.getElementById('chatCityName');
    if (chatCityEl) chatCityEl.textContent = `${cw.name}, ${cw.sys.country}`;

    // Display city information
    if (cityData) {
      displayCityInfo(cityData, cw);
    } else {
      displayCityInfo({ cityName: cw.name, name: cw.name }, cw);
    }
    
    if (state.windyMap) {
      state.windyMap.setView([lat, lon], 9);
      state.windyMap.invalidateSize();
      if (state.windyAPI) state.windyAPI.broadcast.fire('redrawLayer');
    } else if (state.leafletMap) {
      state.leafletMap.setView([lat, lon], 9);
      state.leafletMap.invalidateSize();
      if (state.leafletMarker) state.leafletMarker.setLatLng([lat, lon]);
    }
    state.last = { lat, lon };
    localStorage.setItem("lastCoord", JSON.stringify(state.last));
    const name = label || `${cw.name}, ${cw.sys.country}`;
    state.lastName = name;
    localStorage.setItem("lastName", name);
  } catch (err) {
    alert("Failed to load weather data. Check your API key and network.\n" + err.message);
  }
}

// Events
$("#btnSearch").addEventListener("click", async () => {
  const q = $("#q").value.trim();
  if (!q) return;
  try {
    const g = await geocodeCity(q);
    await updateAll(g.lat, g.lon, g.name, g);
  } catch (err) {
    alert(err.message);
  }
});

$("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btnSearch").click();
});

$("#btnLocate").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Geolocation not supported on this browser.");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const name = await reverseGeocode(lat, lon);
      updateAll(lat, lon, name);
    },
    (err) => alert("Location error: " + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

$("#units").addEventListener("change", () => {
  state.units = $("#units").value;
  localStorage.setItem("units", state.units);
  if (state.last) updateAll(state.last.lat, state.last.lon, state.lastName);
});

// Initialize
window.addEventListener('load', function() {
  // Start retrying immediately — no fixed timeout needed
  waitForWindyAndInit();

  // Load initial weather after a short delay to let auth settle
  setTimeout(() => {
    updateAll(state.last.lat, state.last.lon, state.lastName);
  }, 800);
});

// ========================================
// WEATHER ALERTS SYSTEM
// ========================================

const alertState = {
  enabled: { temp: true, wind: true, aqi: true, storm: true },
  pushGranted: false,
  shownAlerts: new Set(), // avoid duplicate toasts per city load
};

// Load saved alert preferences
(function loadAlertPrefs() {
  const saved = JSON.parse(localStorage.getItem('alertPrefs') || '{}');
  if (saved.temp !== undefined) alertState.enabled.temp = saved.temp;
  if (saved.wind !== undefined) alertState.enabled.wind = saved.wind;
  if (saved.aqi  !== undefined) alertState.enabled.aqi  = saved.aqi;
  if (saved.storm !== undefined) alertState.enabled.storm = saved.storm;
  alertState.pushGranted = Notification.permission === 'granted';
})();

function saveAlertPrefs() {
  localStorage.setItem('alertPrefs', JSON.stringify(alertState.enabled));
}

// Sync toggles with state on page load
window.addEventListener('DOMContentLoaded', () => {
  ['temp','wind','aqi','storm'].forEach(key => {
    const el = document.getElementById(`alert${key.charAt(0).toUpperCase()+key.slice(1)}`);
    if (el) {
      el.checked = alertState.enabled[key];
      el.addEventListener('change', () => {
        alertState.enabled[key] = el.checked;
        saveAlertPrefs();
      });
    }
  });
  updatePushButtonUI();
});

function updatePushButtonUI() {
  const btn = document.getElementById('btnEnablePush');
  const txt = document.getElementById('pushStatusText');
  if (!btn || !txt) return;
  if (Notification.permission === 'granted') {
    btn.textContent = '✓ Enabled';
    btn.disabled = true;
    txt.textContent = 'Push notifications are active';
    alertState.pushGranted = true;
  } else if (Notification.permission === 'denied') {
    btn.textContent = 'Blocked';
    btn.disabled = true;
    txt.textContent = 'Blocked by browser — check site settings';
  } else {
    btn.textContent = 'Enable';
    btn.disabled = false;
    txt.textContent = 'Click to enable browser push alerts';
  }
}

document.getElementById('btnEnablePush')?.addEventListener('click', async () => {
  const perm = await Notification.requestPermission();
  alertState.pushGranted = perm === 'granted';
  updatePushButtonUI();
});

// Alert settings panel toggle
document.getElementById('btnAlertSettings')?.addEventListener('click', () => {
  const panel = document.getElementById('alertSettingsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('closeAlertSettings')?.addEventListener('click', () => {
  document.getElementById('alertSettingsPanel').style.display = 'none';
});

function showAlertToast(icon, title, message, level = 'warning') {
  const container = document.getElementById('alertsContainer');
  const toast = document.createElement('div');
  toast.className = `alert-toast alert-${level}`;
  toast.innerHTML = `
    <div class="alert-toast-icon">${icon}</div>
    <div class="alert-toast-body">
      <div class="alert-toast-title">${title}</div>
      <div class="alert-toast-msg">${message}</div>
    </div>
    <button class="alert-toast-close" title="Dismiss">✕</button>
  `;

  const dismissToast = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 320);
  };

  toast.querySelector('.alert-toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    dismissToast();
  });
  toast.addEventListener('click', dismissToast);

  container.appendChild(toast);
  setTimeout(dismissToast, 7000);

  // Browser push notification
  if (alertState.pushGranted && Notification.permission === 'granted') {
    try {
      new Notification(`${icon} ${title}`, {
        body: message,
        icon: '/favicon.ico',
        tag: title, // prevent duplicate push notifs
      });
    } catch (_) {}
  }
}

function checkWeatherAlerts(cw, aq) {
  // Reset shown alerts for new city load
  alertState.shownAlerts.clear();

  const u = state.units;
  const temp = cw.main.temp;
  const windSpeed = cw.wind.speed; // m/s
  const windKmh = windSpeed * 3.6;
  const weatherId = cw.weather?.[0]?.id || 800;
  const aqi = aq?.list?.[0]?.main?.aqi || 0;
  const cityName = `${cw.name}, ${cw.sys.country}`;

  // 1. Extreme temperature
  if (alertState.enabled.temp) {
    const tempC = u === 'imperial' ? (temp - 32) * 5/9 : temp;
    if (tempC >= 40) {
      showAlertToast('🔥', 'Extreme Heat Warning', `${cityName} is at ${Math.round(temp)}°${u==='metric'?'C':'F'} — stay hydrated and avoid direct sun.`, 'danger');
    } else if (tempC <= 0) {
      showAlertToast('🥶', 'Freezing Temperature Alert', `${cityName} is at ${Math.round(temp)}°${u==='metric'?'C':'F'} — dress warmly and watch for ice.`, 'info');
    }
  }

  // 2. High wind
  if (alertState.enabled.wind && windKmh >= 50) {
    const windDisplay = u === 'imperial' ? `${(windSpeed * 2.23694).toFixed(0)} mph` : `${windKmh.toFixed(0)} km/h`;
    showAlertToast('💨', 'High Wind Speed Alert', `Wind speeds of ${windDisplay} in ${cityName} — secure loose items outdoors.`, 'warning');
  }

  // 3. Poor air quality
  if (alertState.enabled.aqi && aqi >= 4) {
    const labels = ['','Good','Fair','Moderate','Poor','Very Poor'];
    showAlertToast('😷', 'Poor Air Quality Alert', `Air quality is ${labels[aqi]} (AQI ${aqi}) in ${cityName} — wear a mask if going outside.`, 'danger');
  }

  // 4. Storm / heavy rain
  if (alertState.enabled.storm) {
    const isThunderstorm = weatherId >= 200 && weatherId < 300;
    const isHeavyRain = weatherId >= 502 && weatherId < 600;
    if (isThunderstorm) {
      showAlertToast('⛈️', 'Thunderstorm Warning', `Thunderstorm conditions in ${cityName} — avoid open areas and stay indoors.`, 'danger');
    } else if (isHeavyRain) {
      showAlertToast('🌧️', 'Heavy Rain Alert', `Heavy rainfall expected in ${cityName} — carry an umbrella and watch for flooding.`, 'warning');
    }
  }
}

// ========================================
// AI WEATHER CHATBOT
// ========================================

const chatState = {
  history: [], // { role: 'user'|'assistant', content: string }
  weatherContext: null,
  isTyping: false,
};

function buildWeatherContext() {
  if (!chatState.weatherContext) return '';
  const { cw, fw, aq } = chatState.weatherContext;
  const u = state.units;
  const deg = u === 'metric' ? '°C' : '°F';
  const windUnit = u === 'metric' ? 'km/h' : 'mph';
  const windSpeed = u === 'metric' ? (cw.wind.speed * 3.6).toFixed(1) : (cw.wind.speed * 2.23694).toFixed(1);
  const aqi = aq?.list?.[0]?.main?.aqi || 0;
  const aqiLabels = ['','Good','Fair','Moderate','Poor','Very Poor'];

  // Build 5-day summary from forecast
  const byDay = {};
  for (const item of (fw?.list || [])) {
    const d = item.dt_txt.slice(0, 10);
    byDay[d] = byDay[d] || { temps: [], descs: [] };
    byDay[d].temps.push(item.main.temp);
    byDay[d].descs.push(item.weather?.[0]?.description || '');
  }
  const forecastSummary = Object.entries(byDay).slice(0, 5).map(([date, obj]) => {
    const tmin = Math.min(...obj.temps).toFixed(0);
    const tmax = Math.max(...obj.temps).toFixed(0);
    const desc = obj.descs[Math.floor(obj.descs.length / 2)];
    return `${date}: ${tmin}${deg}–${tmax}${deg}, ${desc}`;
  }).join('\n');

  return `Current weather in ${cw.name}, ${cw.sys.country}:
- Temperature: ${Math.round(cw.main.temp)}${deg} (feels like ${Math.round(cw.main.feels_like)}${deg})
- Condition: ${cw.weather?.[0]?.description || 'N/A'}
- Humidity: ${cw.main.humidity}%
- Wind: ${windSpeed} ${windUnit}
- Pressure: ${cw.main.pressure} hPa
- Visibility: ${(cw.visibility / 1000).toFixed(1)} km
- Air Quality Index: ${aqi} (${aqiLabels[aqi] || 'N/A'})
5-Day Forecast:
${forecastSummary}`;
}

function getChatUserInitial() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return (user.name || 'U').charAt(0).toUpperCase();
  } catch { return 'U'; }
}

function appendMessage(role, content, isTyping = false) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;

  const avatarContent = role === 'assistant' ? '🤖' : getChatUserInitial();

  div.innerHTML = `
    <div class="chat-avatar">${avatarContent}</div>
    <div class="chat-bubble">${isTyping
      ? `<div class="chat-bubble-typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`
      : formatChatContent(content)
    }</div>
  `;

  if (isTyping) div.id = 'typingIndicator';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function formatChatContent(text) {
  // Convert markdown-ish text to HTML
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

async function sendChatMessage(userMsg) {
  if (chatState.isTyping || !userMsg.trim()) return;

  // Hide suggestions after first use
  document.getElementById('chatSuggestions').style.display = 'none';

  appendMessage('user', userMsg);
  chatState.history.push({ role: 'user', content: userMsg });

  chatState.isTyping = true;
  document.getElementById('btnChatSend').disabled = true;

  const typingEl = appendMessage('assistant', '', true);

  try {
    const weatherCtx = buildWeatherContext();
    const systemPrompt = weatherCtx
      ? `You are a friendly and knowledgeable AI weather assistant embedded in a weather dashboard. Be concise, helpful, and conversational. Use emojis sparingly.

Here is the current weather data for the user's selected city:
${weatherCtx}

Answer questions about this weather data, give practical advice (what to wear, activities, travel tips), and explain weather phenomena. Keep answers under 150 words unless the user asks for detail.`
      : `You are a friendly AI weather assistant. The user hasn't searched for a city yet. Encourage them to search for a city to get personalized weather insights. Answer general weather questions if asked.`;

    // Send clean history — no context injected into message content
    const res = await fetch('/api/ai/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: systemPrompt,
        messages: chatState.history.map(m => ({ role: m.role, content: m.content })),
        max_tokens: 400
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const replyText = data.content?.[0]?.text || 'Sorry, I could not get a response.';

    typingEl.remove();
    appendMessage('assistant', replyText);
    chatState.history.push({ role: 'assistant', content: replyText });

    // Keep history manageable (last 10 exchanges)
    if (chatState.history.length > 20) {
      chatState.history = chatState.history.slice(-20);
    }

  } catch (err) {
    typingEl.remove();
    appendMessage('assistant', `⚠️ Sorry, I ran into an error: ${err.message}. Please try again.`);
  } finally {
    chatState.isTyping = false;
    document.getElementById('btnChatSend').disabled = false;
    document.getElementById('chatInput').focus();
  }
}

// Chat UI events
document.getElementById('btnChatSend')?.addEventListener('click', () => {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  sendChatMessage(msg);
});

document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('btnChatSend').click();
  }
});

document.getElementById('btnClearChat')?.addEventListener('click', () => {
  chatState.history = [];
  const container = document.getElementById('chatMessages');
  container.innerHTML = `
    <div class="chat-message assistant">
      <div class="chat-avatar">🤖</div>
      <div class="chat-bubble">
        <p>Chat cleared! Ask me anything about the current weather or forecasts.</p>
      </div>
    </div>`;
  document.getElementById('chatSuggestions').style.display = 'flex';
});

// Suggestion chips
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    sendChatMessage(chip.dataset.msg);
  });
});


// ========================================
// FAVORITE CITIES
// ========================================

const favState = {
  currentFavId: null,
  currentLat: null,
  currentLon: null,
  currentCityName: null,
  currentCountry: null,
};

async function checkIsFavorite(lat, lon) {
  try {
    const res = await fetch(`/api/favorites/check?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    favState.currentFavId = data.isFavorite ? data.id : null;
    updateFavButton(data.isFavorite);
  } catch (_) {}
}

function updateFavButton(isFav) {
  const btn = document.getElementById('btnFavorite');
  if (!btn) return;
  btn.textContent = isFav ? '❤️ Saved' : '🤍 Save City';
  btn.classList.toggle('active', isFav);
}

async function toggleFavorite() {
  const { currentLat: lat, currentLon: lon, currentCityName: city, currentCountry: country } = favState;
  if (lat == null) return;

  if (favState.currentFavId) {
    await fetch('/api/favorites/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: favState.currentFavId })
    });
    favState.currentFavId = null;
    updateFavButton(false);
    loadFavoritesList();
  } else {
    await fetch('/api/favorites/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city_name: city, country, lat, lon })
    });
    await checkIsFavorite(lat, lon);
    loadFavoritesList();
  }
}

async function loadFavoritesList() {
  const container = document.getElementById('favoritesListContainer');
  if (!container) return;
  try {
    const res = await fetch('/api/favorites');
    const data = await res.json();
    const favs = data.favorites || [];

    if (favs.length === 0) {
      container.innerHTML = '<div class="fav-empty">No saved cities yet. Search a city and click 🤍 Save City.</div>';
      return;
    }

    container.innerHTML = favs.map(f => `
      <div class="fav-item" data-lat="${f.lat}" data-lon="${f.lon}" data-name="${f.city_name}, ${f.country}">
        <div class="fav-item-info">
          <div class="fav-item-name">${f.city_name}</div>
          <div class="fav-item-country">${f.country}</div>
        </div>
        <div class="fav-item-actions">
          <button class="btn fav-load-btn" onclick="loadFavoriteCity(${f.lat}, ${f.lon}, '${f.city_name}, ${f.country}')">Load</button>
          <button class="btn fav-remove-btn" onclick="removeFavoriteById(${f.id})">✕</button>
        </div>
      </div>
    `).join('');
  } catch (_) {}
}

async function removeFavoriteById(id) {
  await fetch('/api/favorites/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  if (favState.currentFavId === id) {
    favState.currentFavId = null;
    updateFavButton(false);
  }
  loadFavoritesList();
}

async function loadFavoriteCity(lat, lon, name) {
  await updateAll(lat, lon, name);
}

document.getElementById('btnFavorite')?.addEventListener('click', toggleFavorite);

// Load favorites panel on page load
window.addEventListener('load', () => {
  loadFavoritesList();
});

// ========================================
// WEATHER HISTORY CHARTS
// ========================================

let historyChart = null;

async function saveWeatherSnapshot(cw, units) {
  try {
    await fetch('/api/history/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city_name: cw.name,
        country: cw.sys?.country || '',
        lat: cw.coord?.lat,
        lon: cw.coord?.lon,
        temp: cw.main.temp,
        feels_like: cw.main.feels_like,
        humidity: cw.main.humidity,
        wind_speed: cw.wind.speed,
        weather_id: cw.weather?.[0]?.id || 800,
        description: cw.weather?.[0]?.description || '',
        units
      })
    });
  } catch (_) {}
}

async function loadHistoryChart(cityName) {
  const container = document.getElementById('historyChartContainer');
  const canvas = document.getElementById('historyChart');
  if (!container || !canvas) return;

  container.innerHTML = '<div class="history-loading">Loading history...</div>';

  try {
    const res = await fetch(`/api/history?city=${encodeURIComponent(cityName)}&limit=14`);
    const data = await res.json();
    const history = (data.history || []).reverse(); // oldest first

    container.innerHTML = '';
    container.appendChild(canvas);
    canvas.style.display = 'block';

    if (history.length < 2) {
      container.innerHTML = '<div class="history-empty">Not enough history yet. Search this city a few more times to see the trend.</div>';
      return;
    }

    const labels = history.map(h => {
      const d = new Date(h.recorded_at);
      return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    });
    const temps = history.map(h => parseFloat(h.temp.toFixed(1)));
    const humidity = history.map(h => h.humidity);
    const unit = history[history.length - 1]?.units === 'imperial' ? '°F' : '°C';

    if (historyChart) historyChart.destroy();

    historyChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `Temperature (${unit})`,
            data: temps,
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34,211,238,0.1)',
            tension: 0.4,
            fill: true,
            yAxisID: 'y',
          },
          {
            label: 'Humidity (%)',
            data: humidity,
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96,165,250,0.08)',
            tension: 0.4,
            fill: false,
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
          y: { position: 'left',  title: { display: true, text: `Temp (${unit})` } },
          y1: { position: 'right', title: { display: true, text: 'Humidity (%)' }, grid: { drawOnChartArea: false }, min: 0, max: 100 }
        }
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="history-error">Could not load history: ${err.message}</div>`;
  }
}

// ========================================
// API USAGE TRACKER
// ========================================

async function loadUsageStats() {
  const container = document.getElementById('usageStatsContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/usage/stats');
    const data = await res.json();

    // Build endpoint breakdown
    const endpointMap = {};
    for (const row of (data.summary || [])) {
      if (!endpointMap[row.endpoint]) endpointMap[row.endpoint] = 0;
      endpointMap[row.endpoint] += row.count;
    }

    const endpointRows = Object.entries(endpointMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ep, count]) => `
        <div class="usage-row">
          <span class="usage-endpoint">${ep}</span>
          <span class="usage-bar-wrap"><span class="usage-bar" style="width:${Math.min(100, (count / (data.total || 1)) * 400)}%"></span></span>
          <span class="usage-count">${count}</span>
        </div>`).join('');

    container.innerHTML = `
      <div class="usage-summary">
        <div class="usage-stat-box">
          <div class="usage-stat-val">${data.today}</div>
          <div class="usage-stat-label">Calls Today</div>
        </div>
        <div class="usage-stat-box">
          <div class="usage-stat-val">${data.total}</div>
          <div class="usage-stat-label">Total Calls</div>
        </div>
      </div>
      <div class="usage-breakdown">
        <div class="usage-breakdown-title">By Endpoint</div>
        ${endpointRows || '<div class="usage-empty">No usage data yet</div>'}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="usage-error">Could not load usage stats</div>`;
  }
}

// Load stats when panel tab is activated
document.getElementById('tabUsage')?.addEventListener('click', loadUsageStats);
document.getElementById('tabFavorites')?.addEventListener('click', loadFavoritesList);

// ════════════════════════════════════════════════════════════
// NEW FEATURES
// ════════════════════════════════════════════════════════════

// ── 1. ANIMATED WEATHER PARTICLES ──────────────────────────
const particleCanvas = document.getElementById('weatherParticles');
const pCtx = particleCanvas ? particleCanvas.getContext('2d') : null;
let particleType = 'none'; // 'rain', 'snow', 'none'
let particles = [];
let particleAnimId = null;

function resizeParticleCanvas() {
  if (!particleCanvas) return;
  particleCanvas.width  = window.innerWidth;
  particleCanvas.height = window.innerHeight;
}
resizeParticleCanvas();
window.addEventListener('resize', resizeParticleCanvas);

function createParticle() {
  return {
    x: Math.random() * particleCanvas.width,
    y: -10,
    size: particleType === 'snow' ? Math.random() * 4 + 2 : Math.random() * 1.5 + 0.5,
    speedY: particleType === 'snow' ? Math.random() * 1 + 0.5 : Math.random() * 6 + 4,
    speedX: particleType === 'snow' ? (Math.random() - 0.5) * 1.5 : (Math.random() - 0.5) * 0.5,
    opacity: Math.random() * 0.5 + 0.2,
    wobble: Math.random() * Math.PI * 2,
  };
}

function drawParticles() {
  if (!pCtx || particleType === 'none') return;
  pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

  // Add new particles
  if (particles.length < 120) particles.push(createParticle());

  particles.forEach((p, i) => {
    p.y += p.speedY;
    p.x += p.speedX;
    p.wobble += 0.05;
    if (particleType === 'snow') p.x += Math.sin(p.wobble) * 0.6;

    pCtx.beginPath();
    pCtx.globalAlpha = p.opacity;
    if (particleType === 'rain') {
      pCtx.strokeStyle = '#7dd3fc';
      pCtx.lineWidth = p.size;
      pCtx.moveTo(p.x, p.y);
      pCtx.lineTo(p.x + p.speedX * 2, p.y + p.speedY * 2);
      pCtx.stroke();
    } else if (particleType === 'snow') {
      pCtx.fillStyle = '#e2e8f0';
      pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      pCtx.fill();
    }
    pCtx.globalAlpha = 1;

    // Remove off-screen
    if (p.y > particleCanvas.height + 20 || p.x < -20 || p.x > particleCanvas.width + 20) {
      particles.splice(i, 1);
    }
  });

  particleAnimId = requestAnimationFrame(drawParticles);
}

function setParticleEffect(weatherId) {
  if (particleAnimId) cancelAnimationFrame(particleAnimId);
  particles = [];
  if (!pCtx) return;
  pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

  if (weatherId >= 300 && weatherId < 700) {
    particleType = weatherId >= 600 && weatherId < 700 ? 'snow' : 'rain';
    drawParticles();
  } else {
    particleType = 'none';
  }
}

// ── 2. UV INDEX CARD ───────────────────────────────────────
function updateUVIndex(lat, lon) {
  // OpenWeather One Call for UV (uses direct API since backend doesn't have this route yet)
  // Fall back to an estimate from weather ID and time of day
  const uvEl    = document.getElementById('uvValue');
  const catEl   = document.getElementById('uvCategory');
  const ptrEl   = document.getElementById('uvPointer');
  const advEl   = document.getElementById('uvAdvice');
  if (!uvEl) return;

  // Estimate UV from current hour & weather
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour >= 20;

  if (isNight) {
    uvEl.textContent = '0';
    catEl.textContent = 'Night — No UV';
    catEl.style.color = 'var(--muted)';
    if (ptrEl) ptrEl.style.left = '0%';
    if (advEl) advEl.textContent = '🌙 No UV radiation at night. Rest easy!';
    return;
  }

  // Try to fetch from One Call via our weather endpoint proxy
  // We'll derive a reasonable UV estimate from the weather condition + latitude/time
  const latAbs = Math.abs(lat);
  const hourFactor = 1 - Math.abs(hour - 13) / 7; // peak at 1pm
  let baseUV = (1 - latAbs / 90) * 12 * Math.max(0, hourFactor);

  // Reduce for clouds
  const cw = chatState.weatherContext?.cw;
  if (cw) {
    const clouds = cw.clouds?.all || 0;
    baseUV *= (1 - clouds / 100 * 0.8);
  }

  const uv = Math.max(0, Math.round(baseUV * 10) / 10);
  const pct = Math.min(100, (uv / 13) * 100);

  const categories = [
    { max: 3,  label: 'Low',      color: '#22c55e', advice: '🌿 Low UV. Sunscreen optional for short exposure.' },
    { max: 6,  label: 'Moderate', color: '#eab308', advice: '🧴 Wear SPF 30+, sunglasses, and a hat at midday.' },
    { max: 8,  label: 'High',     color: '#f97316', advice: '⚠️ SPF 50+ essential. Limit sun exposure 10am–4pm.' },
    { max: 11, label: 'Very High',color: '#ef4444', advice: '🚨 Stay in shade during peak hours. SPF 50+ required.' },
    { max: 99, label: 'Extreme',  color: '#a855f7', advice: '🔴 Extreme UV! Avoid sun exposure. Full protection needed.' },
  ];
  const cat = categories.find(c => uv <= c.max) || categories[categories.length - 1];

  uvEl.textContent = uv.toFixed(1);
  catEl.textContent = cat.label;
  catEl.style.color = cat.color;
  if (ptrEl) ptrEl.style.left = `${pct}%`;
  if (advEl) advEl.textContent = cat.advice;
}

// ── 3. WIND COMPASS ────────────────────────────────────────
function degreesToCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function msToBeaufort(ms) {
  const scale = [0.3, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
  const desc  = ['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze','Fresh breeze',
                 'Strong breeze','Near gale','Gale','Severe gale','Storm','Violent storm','Hurricane'];
  for (let i = 0; i < scale.length; i++) {
    if (ms < scale[i]) return `${i} – ${desc[i]}`;
  }
  return `12 – ${desc[12]}`;
}

function updateWindCompass(cw) {
  const deg   = cw.wind?.deg ?? 0;
  const speed = cw.wind?.speed ?? 0;
  const gust  = cw.wind?.gust ?? null;
  const u     = state.units;

  const arrow = document.getElementById('compassArrow');
  if (arrow) arrow.style.transform = `translateX(-50%) rotate(${deg}deg)`;

  const dispSpeed = u === 'imperial' ? `${(speed * 2.237).toFixed(1)} mph` : `${(speed * 3.6).toFixed(1)} km/h`;
  const dispGust  = gust ? (u === 'imperial' ? `${(gust * 2.237).toFixed(1)} mph` : `${(gust * 3.6).toFixed(1)} km/h`) : 'N/A';

  const dirEl = document.getElementById('windDirText');
  const spdEl = document.getElementById('windSpeedText');
  const gstEl = document.getElementById('windGustText');
  const bftEl = document.getElementById('windBeaufort');

  if (dirEl) dirEl.textContent = `${degreesToCardinal(deg)} (${deg}°)`;
  if (spdEl) spdEl.textContent = dispSpeed;
  if (gstEl) gstEl.textContent = dispGust;
  if (bftEl) bftEl.textContent = msToBeaufort(speed);
}

// ── 4. SEARCH AUTOCOMPLETE ─────────────────────────────────
let autocompleteTimeout = null;
let autocompleteIndex = -1;

const qInput   = document.getElementById('q');
const acDropdown = document.getElementById('autocompleteDropdown');

const POPULAR_CITIES = [
  { name:'Bengaluru', country:'IN', flag:'🇮🇳' },
  { name:'Mumbai',    country:'IN', flag:'🇮🇳' },
  { name:'Delhi',     country:'IN', flag:'🇮🇳' },
  { name:'London',    country:'GB', flag:'🇬🇧' },
  { name:'New York',  country:'US', flag:'🇺🇸' },
  { name:'Tokyo',     country:'JP', flag:'🇯🇵' },
  { name:'Paris',     country:'FR', flag:'🇫🇷' },
  { name:'Dubai',     country:'AE', flag:'🇦🇪' },
  { name:'Sydney',    country:'AU', flag:'🇦🇺' },
  { name:'Singapore', country:'SG', flag:'🇸🇬' },
  { name:'Berlin',    country:'DE', flag:'🇩🇪' },
  { name:'Toronto',   country:'CA', flag:'🇨🇦' },
  { name:'Lagos',     country:'NG', flag:'🇳🇬' },
  { name:'Cairo',     country:'EG', flag:'🇪🇬' },
  { name:'Seoul',     country:'KR', flag:'🇰🇷' },
  { name:'Bangkok',   country:'TH', flag:'🇹🇭' },
  { name:'Istanbul',  country:'TR', flag:'🇹🇷' },
  { name:'Moscow',    country:'RU', flag:'🇷🇺' },
  { name:'São Paulo', country:'BR', flag:'🇧🇷' },
  { name:'Kolkata',   country:'IN', flag:'🇮🇳' },
  { name:'Chennai',   country:'IN', flag:'🇮🇳' },
  { name:'Patna',     country:'IN', flag:'🇮🇳' },
  { name:'Hyderabad', country:'IN', flag:'🇮🇳' },
  { name:'Pune',      country:'IN', flag:'🇮🇳' },
];

const COUNTRY_FLAGS = { IN:'🇮🇳',US:'🇺🇸',GB:'🇬🇧',JP:'🇯🇵',FR:'🇫🇷',AE:'🇦🇪',AU:'🇦🇺',
  DE:'🇩🇪',CA:'🇨🇦',SG:'🇸🇬',NG:'🇳🇬',EG:'🇪🇬',KR:'🇰🇷',TH:'🇹🇭',TR:'🇹🇷',RU:'🇷🇺',BR:'🇧🇷' };

qInput?.addEventListener('input', () => {
  const q = qInput.value.trim();
  clearTimeout(autocompleteTimeout);
  autocompleteIndex = -1;

  if (q.length < 2) {
    acDropdown?.classList.remove('show');
    return;
  }

  // Instant local suggestions
  const local = POPULAR_CITIES.filter(c => c.name.toLowerCase().startsWith(q.toLowerCase())).slice(0, 5);
  showAutocompleteSuggestions(local, q);

  // Debounced API suggestions
  autocompleteTimeout = setTimeout(async () => {
    try {
      const url = `/api/geocode?q=${encodeURIComponent(q)}`;
      const results = await getJSON(url);
      if (!results || results.length === 0) return;
      const apiSuggestions = results.slice(0, 5).map(r => ({
        name: r.name,
        country: r.country,
        state: r.state,
        lat: r.lat,
        lon: r.lon,
        flag: COUNTRY_FLAGS[r.country] || '🌍',
      }));
      showAutocompleteSuggestions(apiSuggestions, q, true);
    } catch (_) {}
  }, 350);
});

function showAutocompleteSuggestions(suggestions, query, fromAPI = false) {
  if (!acDropdown || suggestions.length === 0) {
    if (!fromAPI) acDropdown?.classList.remove('show');
    return;
  }
  acDropdown.innerHTML = suggestions.map((s, i) => `
    <div class="autocomplete-item" data-index="${i}" data-name="${s.name}" data-country="${s.country}" data-state="${s.state || ''}" data-lat="${s.lat || ''}" data-lon="${s.lon || ''}">
      <span class="autocomplete-item-flag">${s.flag || '🌍'}</span>
      <span class="autocomplete-item-info">
        <span class="autocomplete-item-name">${s.name}</span><br>
        <span class="autocomplete-item-sub">${s.state ? s.state + ', ' : ''}${s.country}</span>
      </span>
    </div>`).join('');
  acDropdown.classList.add('show');

  acDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      const country = item.dataset.country;
      const state = item.dataset.state;
      qInput.value = name;
      acDropdown.classList.remove('show');
      if (item.dataset.lat && item.dataset.lon) {
        const label = `${name}${state ? ', ' + state : ''}, ${country}`;
        updateAll(parseFloat(item.dataset.lat), parseFloat(item.dataset.lon), label, { cityName: name, name });
      } else {
        document.getElementById('btnSearch').click();
      }
    });
  });
}

qInput?.addEventListener('keydown', (e) => {
  const items = acDropdown?.querySelectorAll('.autocomplete-item') || [];
  if (e.key === 'ArrowDown') {
    autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle('selected', i === autocompleteIndex));
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    autocompleteIndex = Math.max(autocompleteIndex - 1, -1);
    items.forEach((it, i) => it.classList.toggle('selected', i === autocompleteIndex));
    e.preventDefault();
  } else if (e.key === 'Escape') {
    acDropdown?.classList.remove('show');
  } else if (e.key === 'Enter' && autocompleteIndex >= 0) {
    items[autocompleteIndex]?.click();
    e.preventDefault();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) acDropdown?.classList.remove('show');
});

// ── 5. SHARE WEATHER CARD ──────────────────────────────────
function openShareModal() {
  const cw = chatState.weatherContext?.cw;
  if (!cw) { alert('Search a city first!'); return; }

  const u   = state.units;
  const deg = u === 'metric' ? '°C' : '°F';
  const wSpd = u === 'metric' ? `${(cw.wind.speed * 3.6).toFixed(0)} km/h` : `${(cw.wind.speed * 2.237).toFixed(0)} mph`;

  document.getElementById('shareEmoji').textContent  = weatherEmoji(cw.weather?.[0]?.id || 800);
  document.getElementById('shareCity').textContent   = `${cw.name}, ${cw.sys.country}`;
  document.getElementById('shareTemp').textContent   = `${Math.round(cw.main.temp)}${deg}`;
  document.getElementById('shareDesc').textContent   = cw.weather?.[0]?.description || '';
  document.getElementById('shareHum').textContent    = `${cw.main.humidity}%`;
  document.getElementById('shareWind').textContent   = wSpd;
  document.getElementById('shareFeels').textContent  = `${Math.round(cw.main.feels_like)}${deg}`;

  document.getElementById('sharePreviewModal').classList.add('open');
}

document.getElementById('btnShare')?.addEventListener('click', openShareModal);
document.getElementById('btnCloseShare')?.addEventListener('click', () => {
  document.getElementById('sharePreviewModal').classList.remove('open');
});
document.getElementById('sharePreviewModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('sharePreviewModal'))
    document.getElementById('sharePreviewModal').classList.remove('open');
});

document.getElementById('btnDownloadCard')?.addEventListener('click', async () => {
  const preview = document.getElementById('shareCardPreview');
  if (!preview || !window.html2canvas) { alert('Download not available'); return; }
  try {
    const canvas = await html2canvas(preview, { scale: 3, useCORS: true, backgroundColor: '#0f172a' });
    const link = document.createElement('a');
    const city = document.getElementById('shareCity').textContent.replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `weather_${city}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    alert('Could not download card: ' + err.message);
  }
});

document.getElementById('btnCopyShareText')?.addEventListener('click', () => {
  const cw = chatState.weatherContext?.cw;
  if (!cw) return;
  const u = state.units;
  const deg = u === 'metric' ? '°C' : '°F';
  const txt = `🌤️ Weather in ${cw.name}, ${cw.sys.country}
🌡️ ${Math.round(cw.main.temp)}${deg} — ${cw.weather?.[0]?.description}
💧 Humidity: ${cw.main.humidity}%
💨 Wind: ${(cw.wind.speed * 3.6).toFixed(0)} km/h
📅 ${new Date().toLocaleDateString()}
— via Weather Dashboard`;
  navigator.clipboard.writeText(txt).then(() => {
    const btn = document.getElementById('btnCopyShareText');
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy Text', 2000);
  });
});

// ── 6. CITY COMPARE ────────────────────────────────────────
document.getElementById('btnCompare')?.addEventListener('click', compareCities);
document.getElementById('tabCompare')?.addEventListener('click', () => {
  document.getElementById('paneCompare').style.display = 'block';
});

async function compareCities() {
  const c1 = document.getElementById('compareCity1')?.value.trim();
  const c2 = document.getElementById('compareCity2')?.value.trim();
  const grid = document.getElementById('compareGrid');
  if (!c1 || !c2) { alert('Enter both city names'); return; }

  grid.innerHTML = `<div class="compare-loading" style="grid-column:1/-1">🔍 Fetching weather data...</div>`;

  try {
    const [g1, g2] = await Promise.all([geocodeCity(c1), geocodeCity(c2)]);
    const [d1, d2] = await Promise.all([fetchAll(g1.lat, g1.lon), fetchAll(g2.lat, g2.lon)]);

    const u   = state.units;
    const deg = u === 'metric' ? '°C' : '°F';
    const wUnit = u === 'metric' ? 'km/h' : 'mph';

    function wSpd(ms) { return u === 'metric' ? (ms * 3.6).toFixed(0) : (ms * 2.237).toFixed(0); }
    function aqiLabel(aq) { return ['—','Good','Fair','Moderate','Poor','Very Poor'][aq?.list?.[0]?.main?.aqi || 0] || '—'; }

    function buildCard(geo, d, side) {
      const cw  = d.cw;
      const aq  = d.aq;
      const t   = Math.round(cw.main.temp);
      const hum = cw.main.humidity;
      const ws  = wSpd(cw.wind.speed);
      const aqi = aqiLabel(aq);

      return `
        <div class="compare-city-card ${side}">
          <div class="compare-city-name">${weatherEmoji(cw.weather?.[0]?.id)} ${cw.name}, ${cw.sys.country}</div>
          <div class="compare-city-temp">${t}${deg}</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:12px;text-transform:capitalize">${cw.weather?.[0]?.description}</div>
          <div class="compare-detail-row"><span class="compare-detail-label">Feels Like</span><span class="compare-detail-value">${Math.round(cw.main.feels_like)}${deg}</span></div>
          <div class="compare-detail-row"><span class="compare-detail-label">Humidity</span><span class="compare-detail-value">${hum}%</span></div>
          <div class="compare-detail-row"><span class="compare-detail-label">Wind</span><span class="compare-detail-value">${ws} ${wUnit}</span></div>
          <div class="compare-detail-row"><span class="compare-detail-label">Pressure</span><span class="compare-detail-value">${cw.main.pressure} hPa</span></div>
          <div class="compare-detail-row"><span class="compare-detail-label">Visibility</span><span class="compare-detail-value">${(cw.visibility/1000).toFixed(1)} km</span></div>
          <div class="compare-detail-row"><span class="compare-detail-label">Air Quality</span><span class="compare-detail-value">${aqi}</span></div>
        </div>`;
    }

    const t1 = d1.cw.main.temp;
    const t2 = d2.cw.main.temp;

    grid.innerHTML = `
      ${buildCard(g1, d1, 'left')}
      <div class="compare-vs">VS</div>
      ${buildCard(g2, d2, 'right')}
      <div style="grid-column:1/-1;text-align:center;font-size:13px;color:var(--muted);padding-top:8px;">
        ${t1 > t2 ? `🌡️ <strong>${d1.cw.name}</strong> is ${(t1-t2).toFixed(1)}${deg} warmer` : t2 > t1 ? `🌡️ <strong>${d2.cw.name}</strong> is ${(t2-t1).toFixed(1)}${deg} warmer` : '🌡️ Both cities have the same temperature!'}
      </div>`;
  } catch (err) {
    grid.innerHTML = `<div class="compare-placeholder" style="grid-column:1/-1">⚠️ ${err.message}</div>`;
  }
}

// ── 7. KEYBOARD SHORTCUTS ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

  if (!inInput) {
    if (e.key === '/') {
      e.preventDefault();
      qInput?.focus();
    }
    if (e.key === 'r' || e.key === 'R') {
      if (state.last) updateAll(state.last.lat, state.last.lon, state.lastName);
    }
    if (e.key === '?') {
      document.getElementById('shortcutsPanel')?.classList.toggle('open');
    }
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      document.getElementById('btnLocate')?.click();
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      document.getElementById('btnTheme')?.click();
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      document.getElementById('btnFavorite')?.click();
    }
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      openShareModal();
    }
  }
});

// ── 8. FLOATING ACTION BUTTONS ────────────────────────────
document.getElementById('fabScrollTop')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('fabShortcuts')?.addEventListener('click', () => {
  document.getElementById('shortcutsPanel')?.classList.toggle('open');
});

// ── 9. AUTO-REFRESH with countdown ────────────────────────
const AUTO_REFRESH_SECS = 300; // 5 minutes
let refreshSecsLeft = AUTO_REFRESH_SECS;
let refreshInterval = null;

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshSecsLeft = AUTO_REFRESH_SECS;
  refreshInterval = setInterval(() => {
    refreshSecsLeft--;
    if (refreshSecsLeft <= 0) {
      if (state.last) updateAll(state.last.lat, state.last.lon, state.lastName);
      refreshSecsLeft = AUTO_REFRESH_SECS;
    }
  }, 1000);
}
startAutoRefresh();

// ── 10. HOOK INTO updateAll TO DRIVE NEW FEATURES ─────────
// Patch setCurrent to also update new cards
const _originalSetCurrent = setCurrent;
window.setCurrent = function(cw) {
  _originalSetCurrent(cw);
  updateWindCompass(cw);
  setParticleEffect(cw.weather?.[0]?.id || 800);
  if (state.last) updateUVIndex(state.last.lat, state.last.lon);
};


/* ═══════════════════════════════════════════════════════════════════
   NEW FEATURES  (appended — no existing code changed)
   1. Precipitation & Rain Probability Chart
   2. Astronomy Panel (moon phase, golden/blue hour)
   3. Marine & Outdoor Conditions
   4. Custom Weather Alerts
   5. Multi-City Tracker
   ═══════════════════════════════════════════════════════════════════ */

// ── SHARED STATE ───────────────────────────────────────────────────
let precipChart = null;
let precipMode  = 'bar';          // 'bar' | 'line'
let lastForecast = null;          // cached fw object
let lastCurrentWeather = null;    // cached cw object
let lastAqi = null;               // cached aq object
let trackedCities = JSON.parse(localStorage.getItem('trackedCities') || '[]');

// Hook into the existing updateAll flow by monkey-patching the render path.
// We listen for a custom event dispatched after each full data fetch.
document.addEventListener('weatherDataReady', (e) => {
  const { cw, fw, aq, lat, lon } = e.detail;
  lastCurrentWeather = cw;
  lastForecast       = fw;
  lastAqi            = aq;

  renderPrecipChart(fw);
  updateAstronomy(cw);
  updateOutdoorConditions(cw, aq);
  checkAlerts(cw, aq);
});

// Patch the existing updateAll so it fires our event.
// We wait until script.js is fully parsed before patching.
window.addEventListener('load', () => {
  if (typeof updateAll === 'function') {
    const _orig = updateAll;
    window.updateAll = async function(lat, lon, name, geo) {
      const result = await _orig(lat, lon, name, geo);
      // updateAll re-fetches; we grab state from the DOM after a short delay
      setTimeout(() => {
        if (lastCurrentWeather && lastForecast && lastAqi) {
          document.dispatchEvent(new CustomEvent('weatherDataReady', {
            detail: { cw: lastCurrentWeather, fw: lastForecast, aq: lastAqi, lat, lon }
          }));
        }
      }, 600);
      return result;
    };
  }

  // Also capture data from the original setCurrent / setForecast / setAQI calls
  const _sc = window.setCurrent;
  window.setCurrent = function(cw) { lastCurrentWeather = cw; _sc && _sc(cw); };

  const _sf = window.setForecast || (() => {});
  window.setForecast = function(fw) { lastForecast = fw; _sf(fw); };

  const _sa = window.setAQI || (() => {});
  window.setAQI = function(aq) { lastAqi = aq; _sa(aq); };

  // Restore tracked cities on load
  renderTrackedCities();
});


/* ════════════════════════════════════════════════════════════
   1. PRECIPITATION & RAIN PROBABILITY CHART
   ════════════════════════════════════════════════════════════ */
function switchPrecipTab(mode) {
  precipMode = mode;
  document.getElementById('precipTabBar').classList.toggle('active-tab-btn', mode === 'bar');
  document.getElementById('precipTabLine').classList.toggle('active-tab-btn', mode === 'line');
  if (lastForecast) renderPrecipChart(lastForecast);
}

function renderPrecipChart(fw) {
  if (!fw || !fw.list) return;
  const ctx = document.getElementById('precipChart');
  if (!ctx) return;

  const items  = fw.list.slice(0, 16); // next 48 h (3-hourly)
  const labels = items.map(x => x.dt_txt.slice(5, 16).replace(' ', '\n'));
  const rain   = items.map(x => (x.rain?.['3h'] || 0).toFixed(1));
  const pop    = items.map(x => Math.round((x.pop || 0) * 100));

  if (precipChart) precipChart.destroy();

  const isBar = precipMode === 'bar';
  precipChart = new Chart(ctx, {
    type: isBar ? 'bar' : 'line',
    data: {
      labels,
      datasets: isBar
        ? [{ label: 'Rain (mm)', data: rain, backgroundColor: 'rgba(34,211,238,.55)', borderColor: '#22d3ee', borderRadius: 6, borderWidth: 1 }]
        : [{ label: 'Rain Probability (%)', data: pop, tension: 0.4, fill: true,
             borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,.18)',
             pointBackgroundColor: '#60a5fa', pointRadius: 4 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#9ca3af', maxRotation: 0 } },
        y: {
          grid: { color: 'rgba(255,255,255,.06)' },
          ticks: { color: '#9ca3af', font: { size: 11 } },
          beginAtZero: true,
          max: isBar ? undefined : 100,
        }
      }
    }
  });

  // Summary
  const totalRain = rain.reduce((a, b) => a + parseFloat(b), 0).toFixed(1);
  const maxPop    = Math.max(...pop);
  const rainySlots = pop.filter(p => p >= 50).length;
  const summary = document.getElementById('precipSummary');
  if (summary) {
    summary.textContent = `Expected precipitation over next 48h: ${totalRain} mm · Max rain probability: ${maxPop}% · ${rainySlots} of ${items.length} time-slots have ≥50% rain chance.`;
  }
}


/* ════════════════════════════════════════════════════════════
   2. ASTRONOMY PANEL
   ════════════════════════════════════════════════════════════ */
function pad2(n) { return String(n).padStart(2, '0'); }
function hhmm(date) { return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`; }

function calcMoonPhase(date) {
  // Simple synodic calculation (accurate to ~1 day)
  const known  = new Date(Date.UTC(2000, 0, 6, 18, 14)); // known new moon
  const synodic = 29.530588853;
  const diff   = (date - known) / (1000 * 60 * 60 * 24);
  const phase  = ((diff % synodic) + synodic) % synodic;
  const illum  = Math.round((1 - Math.cos((2 * Math.PI * phase) / synodic)) / 2 * 100);
  let name;
  if      (phase < 1.85)  name = '🌑 New Moon';
  else if (phase < 7.38)  name = '🌒 Waxing Crescent';
  else if (phase < 9.22)  name = '🌓 First Quarter';
  else if (phase < 14.77) name = '🌔 Waxing Gibbous';
  else if (phase < 16.61) name = '🌕 Full Moon';
  else if (phase < 22.15) name = '🌖 Waning Gibbous';
  else if (phase < 23.99) name = '🌗 Last Quarter';
  else if (phase < 29.53) name = '🌘 Waning Crescent';
  else                    name = '🌑 New Moon';
  return { phase, illum, name };
}

function drawMoon(illumination, phase) {
  const canvas = document.getElementById('moonCanvas');
  if (!canvas) return;
  const ctx2 = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, R = 42;
  ctx2.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  // Dark side
  ctx2.beginPath();
  ctx2.arc(cx, cy, R, 0, Math.PI * 2);
  ctx2.fillStyle = '#1e293b';
  ctx2.fill();

  // Lit side (approximation)
  const waxing = phase < 14.77;
  const t = (illumination / 100);
  ctx2.save();
  ctx2.beginPath();
  ctx2.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2);
  ctx2.closePath();
  ctx2.clip();
  // ellipse width proportional to illumination
  const hw = R * (2 * t - 1);
  ctx2.beginPath();
  if (waxing) {
    ctx2.ellipse(cx, cy, Math.abs(hw), R, 0, 0, Math.PI * 2);
  } else {
    ctx2.ellipse(cx, cy, Math.abs(hw), R, 0, 0, Math.PI * 2);
  }
  ctx2.fillStyle = '#f1f5f9';
  ctx2.fill();
  ctx2.restore();

  // Rim
  ctx2.beginPath();
  ctx2.arc(cx, cy, R, 0, Math.PI * 2);
  ctx2.strokeStyle = '#334155';
  ctx2.lineWidth = 2;
  ctx2.stroke();
}

function updateAstronomy(cw) {
  if (!cw) return;
  const tz    = cw.timezone || 0;  // seconds
  const srTs  = cw.sys.sunrise;
  const ssTs  = cw.sys.sunset;

  // Work in UTC + tz offset to get local city time
  const toLocal = ts => new Date((ts + tz) * 1000);

  const sunrise = toLocal(srTs);
  const sunset  = toLocal(ssTs);

  // Golden hour: ~30 min after sunrise, ~30 min before sunset
  const goldenAMstart = new Date(sunrise.getTime());
  const goldenAMend   = new Date(sunrise.getTime() + 30 * 60000);
  const goldenPMstart = new Date(sunset.getTime()  - 30 * 60000);
  const goldenPMend   = new Date(sunset.getTime());

  // Blue hour: ~20 min before sunrise, ~20 min after sunset
  const blueAMstart = new Date(sunrise.getTime() - 20 * 60000);
  const blueAMend   = sunrise;
  const bluePMstart = sunset;
  const bluePMend   = new Date(sunset.getTime()  + 20 * 60000);

  const dayMs   = ssTs - srTs;
  const dayH    = Math.floor(dayMs / 3600);
  const dayM    = Math.floor((dayMs % 3600) / 60);

  const moon = calcMoonPhase(new Date());

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('astroSunrise',   hhmm(sunrise));
  set('astroSunset',    hhmm(sunset));
  set('astroGoldenAM',  `${hhmm(goldenAMstart)} – ${hhmm(goldenAMend)}`);
  set('astroGoldenPM',  `${hhmm(goldenPMstart)} – ${hhmm(goldenPMend)}`);
  set('astroBlueAM',    `${hhmm(blueAMstart)} – ${hhmm(blueAMend)}`);
  set('astroBluePM',    `${hhmm(bluePMstart)} – ${hhmm(bluePMend)}`);
  set('astroMoonIllum', `${moon.illum}%`);
  set('astroDayLen',    `${dayH}h ${dayM}m`);
  set('moonPhaseName',  moon.name);

  drawMoon(moon.illum, moon.phase);
}


/* ════════════════════════════════════════════════════════════
   3. MARINE & OUTDOOR CONDITIONS
   ════════════════════════════════════════════════════════════ */
function calcDewPoint(tempC, humidity) {
  const a = 17.27, b = 237.7;
  const alpha = ((a * tempC) / (b + tempC)) + Math.log(humidity / 100);
  return (b * alpha) / (a - alpha);
}

function beaufortFromMs(ms) {
  const scale = [0.3,1.5,3.3,5.4,7.9,10.7,13.8,17.1,20.7,24.4,28.4,32.6];
  const desc  = ['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze',
                 'Fresh breeze','Strong breeze','Near gale','Gale','Severe gale','Storm','Violent storm','Hurricane'];
  for (let i = 0; i < scale.length; i++) if (ms < scale[i]) return `${i} – ${desc[i]}`;
  return `12 – Hurricane`;
}

function updateOutdoorConditions(cw, aq) {
  if (!cw) return;
  const u      = state.units;
  const tempC  = u === 'imperial' ? (cw.main.temp - 32) * 5/9 : cw.main.temp;
  const hum    = cw.main.humidity;
  const windMs = cw.wind.speed;
  const windKmh = windMs * 3.6;
  const clouds = cw.clouds?.all || 0;
  const rain1h = cw.rain?.['1h'] || 0;

  const dewPoint = calcDewPoint(tempC, hum).toFixed(1);
  const beaufort = beaufortFromMs(windMs);

  // Running Index: 0 (terrible) to 10 (perfect)
  // Ideal: 10–18°C, wind < 20 km/h, no rain
  let runScore = 10;
  if (tempC > 30) runScore -= (tempC - 30) * 0.5;
  if (tempC < 5)  runScore -= (5 - tempC) * 0.5;
  if (windKmh > 25) runScore -= (windKmh - 25) * 0.1;
  if (rain1h > 0) runScore -= 3;
  if (hum > 85)   runScore -= 1;
  runScore = Math.max(0, Math.min(10, Math.round(runScore)));
  const runEmoji = runScore >= 8 ? '🟢 Great' : runScore >= 5 ? '🟡 OK' : '🔴 Poor';

  // Cycling Index
  let cycScore = 10;
  if (tempC > 32 || tempC < 3) cycScore -= 3;
  if (windKmh > 30) cycScore -= (windKmh - 30) * 0.15;
  if (rain1h > 0) cycScore -= 4;
  cycScore = Math.max(0, Math.min(10, Math.round(cycScore)));
  const cycEmoji = cycScore >= 8 ? '🟢 Great' : cycScore >= 5 ? '🟡 OK' : '🔴 Poor';

  // Laundry Score: good when warm, dry, some wind, no rain
  let laundry = 10;
  if (hum > 75)   laundry -= 2;
  if (rain1h > 0) laundry -= 5;
  if (clouds > 70) laundry -= 2;
  if (windKmh < 5) laundry -= 1;
  laundry = Math.max(0, Math.min(10, Math.round(laundry)));
  const laundryStr = laundry >= 8 ? '🟢 Perfect' : laundry >= 5 ? '🟡 OK' : '🔴 Stay indoors';

  const umbrella = (rain1h > 0 || (lastForecast?.list?.[0]?.pop || 0) > 0.4)
    ? '☂️ Yes' : '✅ No';

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('swellBeaufort', beaufort);
  set('swellDewPoint', `${dewPoint}°C`);
  set('swellRunIdx',   `${runScore}/10 ${runEmoji}`);
  set('swellCycleIdx', `${cycScore}/10 ${cycEmoji}`);
  set('swellLaundry',  laundryStr);
  set('swellUmbrella', umbrella);

  const advEl = document.getElementById('swellAdvice');
  if (advEl) {
    const tips = [];
    if (runScore >= 8) tips.push('🏃 Great conditions for a run!');
    if (cycScore >= 8) tips.push('🚴 Perfect cycling weather!');
    if (laundry >= 8)  tips.push('🧺 Ideal laundry day!');
    if (umbrella.includes('Yes')) tips.push('☂️ Carry an umbrella today.');
    if (dewPoint > 21) tips.push('😓 High dew point — it may feel muggy.');
    if (tempC > 35)    tips.push('🥵 Very hot — stay hydrated!');
    advEl.textContent = tips.length ? tips.join('  ·  ') : '😊 Conditions look comfortable overall.';
  }
}


/* ════════════════════════════════════════════════════════════
   4. CUSTOM WEATHER ALERTS
   ════════════════════════════════════════════════════════════ */
const ALERTS_KEY = 'weatherAlerts';

function saveAlerts() {
  const alerts = {
    maxTemp : parseFloat(document.getElementById('alertMaxTemp')?.value) || null,
    minTemp : parseFloat(document.getElementById('alertMinTemp')?.value) || null,
    maxWind : parseFloat(document.getElementById('alertMaxWind')?.value) || null,
    maxHum  : parseFloat(document.getElementById('alertMaxHum')?.value)  || null,
    maxAqi  : parseFloat(document.getElementById('alertMaxAqi')?.value)  || null,
  };
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  if (lastCurrentWeather && lastAqi) checkAlerts(lastCurrentWeather, lastAqi);
  // Flash button
  const btn = document.querySelector('[onclick="saveAlerts()"]');
  if (btn) { btn.textContent = '✅ Saved!'; setTimeout(() => btn.textContent = '💾 Save Alerts', 1500); }
}

function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(ALERTS_KEY) || '{}'); } catch { return {}; }
}

// Pre-fill inputs on page load
window.addEventListener('load', () => {
  const a = loadAlerts();
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  set('alertMaxTemp', a.maxTemp);
  set('alertMinTemp', a.minTemp);
  set('alertMaxWind', a.maxWind);
  set('alertMaxHum',  a.maxHum);
  set('alertMaxAqi',  a.maxAqi);
});

function checkAlerts(cw, aq) {
  const alerts = loadAlerts();
  const container = document.getElementById('alertsTriggered');
  if (!container) return;

  const u     = state.units;
  const tempC = u === 'imperial' ? (cw.main.temp - 32) * 5/9 : cw.main.temp;
  const temp  = cw.main.temp;
  const windKmh = cw.wind.speed * 3.6;
  const hum   = cw.main.humidity;
  const aqi   = aq?.list?.[0]?.main?.aqi || 0;

  const triggered = [];

  if (alerts.maxTemp != null && temp > alerts.maxTemp)
    triggered.push({ cls: 'danger', icon: '🔥', msg: `Temperature ${Math.round(temp)}° exceeds your max threshold of ${alerts.maxTemp}°` });

  if (alerts.minTemp != null && temp < alerts.minTemp)
    triggered.push({ cls: 'warn', icon: '🥶', msg: `Temperature ${Math.round(temp)}° is below your min threshold of ${alerts.minTemp}°` });

  if (alerts.maxWind != null && windKmh > alerts.maxWind)
    triggered.push({ cls: 'warn', icon: '💨', msg: `Wind speed ${windKmh.toFixed(0)} km/h exceeds your limit of ${alerts.maxWind} km/h` });

  if (alerts.maxHum != null && hum > alerts.maxHum)
    triggered.push({ cls: 'warn', icon: '💧', msg: `Humidity ${hum}% exceeds your threshold of ${alerts.maxHum}%` });

  if (alerts.maxAqi != null && aqi > alerts.maxAqi)
    triggered.push({ cls: 'danger', icon: '🌫️', msg: `AQI ${aqi} is worse than your limit of ${alerts.maxAqi}` });

  if (triggered.length === 0) {
    const hasAny = Object.values(alerts).some(v => v != null);
    container.innerHTML = hasAny
      ? `<div class="alert-triggered ok">✅ All conditions are within your set thresholds — you're good!</div>`
      : '';
    return;
  }

  container.innerHTML = triggered.map(t =>
    `<div class="alert-triggered ${t.cls}">${t.icon} <span>${t.msg}</span></div>`
  ).join('');
}


/* ════════════════════════════════════════════════════════════
   5. MULTI-CITY TRACKER
   ════════════════════════════════════════════════════════════ */
async function addTrackedCity() {
  const input = document.getElementById('trackCityInput');
  const name  = input?.value.trim();
  if (!name) return;

  if (trackedCities.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    input.value = ''; return;
  }

  // Add a placeholder immediately
  trackedCities.push({ name, loading: true });
  saveTrackedCities();
  renderTrackedCities();
  input.value = '';

  try {
    const [geo] = await getJSON(`/api/geocode?q=${encodeURIComponent(name)}`);
    if (!geo) throw new Error('Not found');
    const u = state.units;
    const cw = await getJSON(`/api/weather?lat=${geo.lat}&lon=${geo.lon}&units=${u}`);
    const entry = {
      name:    `${geo.name}${geo.country ? ', ' + geo.country : ''}`,
      lat:     geo.lat,
      lon:     geo.lon,
      temp:    Math.round(cw.main.temp),
      desc:    cw.weather?.[0]?.description || '',
      icon:    cw.weather?.[0]?.id || 800,
      hum:     cw.main.humidity,
      wind:    (cw.wind.speed * 3.6).toFixed(0),
      units:   u,
    };
    // Replace placeholder
    const idx = trackedCities.findIndex(c => c.name.toLowerCase() === name.toLowerCase() || c.loading);
    if (idx >= 0) trackedCities[idx] = entry;
    else trackedCities.push(entry);
  } catch {
    const idx = trackedCities.findIndex(c => c.loading);
    if (idx >= 0) trackedCities[idx] = { name, error: true };
  }

  saveTrackedCities();
  renderTrackedCities();
}

function removeTrackedCity(name) {
  trackedCities = trackedCities.filter(c => c.name !== name);
  saveTrackedCities();
  renderTrackedCities();
}

function saveTrackedCities() {
  localStorage.setItem('trackedCities', JSON.stringify(trackedCities));
}

async function refreshTrackedCities() {
  const btn = document.querySelector('[onclick="refreshTrackedCities()"]');
  if (btn) btn.textContent = '⏳ Refreshing…';

  const u = state.units;
  const refreshed = await Promise.all(trackedCities.map(async c => {
    if (!c.lat) return c;
    try {
      const cw = await getJSON(`/api/weather?lat=${c.lat}&lon=${c.lon}&units=${u}`);
      return { ...c, temp: Math.round(cw.main.temp), desc: cw.weather?.[0]?.description || '', icon: cw.weather?.[0]?.id || 800, hum: cw.main.humidity, wind: (cw.wind.speed*3.6).toFixed(0), units: u };
    } catch { return c; }
  }));
  trackedCities = refreshed;
  saveTrackedCities();
  renderTrackedCities();
  if (btn) { btn.textContent = '✅ Updated'; setTimeout(() => btn.textContent = '🔄 Refresh All', 1500); }
}

const weatherEmojiLocal = (id) => {
  if (id >= 200 && id < 300) return '⛈️';
  if (id >= 300 && id < 600) return '🌧️';
  if (id >= 600 && id < 700) return '❄️';
  if (id >= 700 && id < 800) return '🌫️';
  if (id === 800) return '☀️';
  if (id === 801) return '🌤️';
  if (id === 802) return '⛅';
  return '☁️';
};

function renderTrackedCities() {
  const grid = document.getElementById('trackedCitiesGrid');
  if (!grid) return;

  if (trackedCities.length === 0) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px;text-align:center;">Add cities above to track them here ✨</div>`;
    return;
  }

  grid.innerHTML = trackedCities.map(c => {
    if (c.loading) return `<div class="tracked-city-card"><div class="tc-name">${c.name}</div><div class="tc-loading">⏳ Loading…</div></div>`;
    if (c.error)   return `<div class="tracked-city-card"><div class="tc-name">${c.name}</div><div class="tc-error">❌ Not found</div><button class="tc-remove" onclick="removeTrackedCity('${c.name.replace(/'/g,"\\'")}')">✕</button></div>`;
    const deg = c.units === 'imperial' ? '°F' : '°C';
    return `
      <div class="tracked-city-card" onclick="loadTrackedCity('${c.lat}','${c.lon}','${c.name.replace(/'/g,"\\'")}')">
        <button class="tc-remove" onclick="event.stopPropagation();removeTrackedCity('${c.name.replace(/'/g,"\\'")}')">✕</button>
        <div class="tc-name">${weatherEmojiLocal(c.icon)} ${c.name}</div>
        <div class="tc-temp">${c.temp}${deg}</div>
        <div class="tc-desc">${c.desc}</div>
        <div class="tc-stats">
          <span class="tc-stat">💧 ${c.hum}%</span>
          <span class="tc-stat">💨 ${c.wind} km/h</span>
        </div>
      </div>`;
  }).join('');
}

function loadTrackedCity(lat, lon, name) {
  if (typeof updateAll === 'function') {
    updateAll(parseFloat(lat), parseFloat(lon), name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Also trigger feature rendering on the initial page load after auto-load
setTimeout(() => {
  if (lastCurrentWeather && lastForecast && lastAqi) {
    renderPrecipChart(lastForecast);
    updateAstronomy(lastCurrentWeather);
    updateOutdoorConditions(lastCurrentWeather, lastAqi);
    checkAlerts(lastCurrentWeather, lastAqi);
  }
}, 3000);
