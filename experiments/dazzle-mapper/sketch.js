const SURFACE_W = 1280;
const SURFACE_H = 720;
const STORAGE_PREFIX = "dazzle_mapper_surface";
const WEATHER_URL =
  "https://api.openweathermap.org/data/2.5/weather?q=roskilde,dk&APPID=d28e0b6cfa6d48a373d2359ff966fbad&units=metric";
const WEATHER_REFRESH_MS = 10 * 60 * 1000;

let mapper;
let surfaces = [];
let weatherInfo = {
  loading: true,
  error: "",
  city: "Roskilde",
  temp: null,
  feelsLike: null,
  description: "",
  wind: null,
  humidity: null,
  rain1h: null,
};
let lastWeatherFetchMs = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  imageMode(CENTER);
  noStroke();

  await loadScript("portal/mapper.js");
  await loadScript("portal/uiSlim2.js");

  mapper = new ProjectionMapper();
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
  }

  addSurface();
  mapper.loadAll();
  await fetchWeather();
}

function draw() {
  background("#070707");

  maybeRefreshWeather();

  for (let i = 0; i < surfaces.length; i++) {
    drawDazzleSurface(surfaces[i].pg, i);
  }

  mapper?.render();
}

function addSurface() {
  const index = surfaces.length;
  const name = `${STORAGE_PREFIX}_${index + 1}`;
  const pg = mapper.add(SURFACE_W, SURFACE_H, name);
  pg.imageMode(CENTER);
  surfaces.push({ name, pg });
}

function drawDazzleSurface(pg, index) {
  if (!pg) return;

  const t = millis() * 0.001;
  const stripeW = 84;
  const phase = t * (0.8 + index * 0.15);
  const bandOffset = sin(phase) * 140;
  const pulse = (sin(t * 1.7 + index) * 0.5 + 0.5);
  const bgA = "#fff7fb";
  const bgB = "#140816";
  const accentA = "#ff4db8";
  const accentB = "#8b5cf6";
  const inkDark = "#210a1f";
  const inkLight = "#fde7ff";

  pg.background(index % 2 === 0 ? bgA : bgB);
  pg.push();
  pg.translate(pg.width * 0.5, pg.height * 0.5);
  pg.rotate((index % 2 === 0 ? 1 : -1) * 0.09 * sin(t * 0.6 + index));
  pg.translate(-pg.width * 0.5, -pg.height * 0.5);

  pg.noStroke();
  for (let x = -pg.height; x < pg.width + pg.height; x += stripeW) {
    const odd = ((x / stripeW) | 0) % 2 === 0;
    pg.fill(odd ? accentA : accentB);
    pg.quad(
      x + bandOffset, 0,
      x + stripeW + bandOffset, 0,
      x + stripeW - bandOffset, pg.height,
      x - bandOffset, pg.height
    );
  }
  pg.pop();

  pg.noFill();
  pg.stroke(index % 2 === 0 ? inkDark : inkLight);
  pg.strokeWeight(18);
  pg.rect(
    42 + pulse * 30,
    42 + pulse * 20,
    pg.width - 84 - pulse * 60,
    pg.height - 84 - pulse * 40
  );

  pg.stroke(index % 2 === 0 ? inkDark : inkLight);
  pg.strokeWeight(10);
  pg.line(0, pg.height * 0.35 + sin(t + index) * 80, pg.width, pg.height * 0.65 + cos(t * 1.3 + index) * 90);
  pg.line(pg.width * 0.25, 0, pg.width * 0.75, pg.height);
  pg.line(pg.width * 0.75, 0, pg.width * 0.25, pg.height);

  pg.noStroke();
  pg.fill(index % 2 === 0 ? inkDark : inkLight);
  pg.textAlign(LEFT, TOP);
  pg.textSize(44);
  pg.text(`Dazzle Mapper ${index + 1}`, 34, 26);
  pg.textSize(24);
  pg.text("Add more surfaces and map each one independently.", 34, 82);

  if (index === 0) {
    renderUiOnSurface(pg);
  }
}

function renderUiOnSurface(pg) {
  if (typeof uiListStart !== "function") return;

  uiUseGraphics(pg);
  uiListStart({ x: 34, y: 180, width: 240, dir: "vertical" });
  uiText("Dazzle Mapper", {
    bgColor: "#fde7ff",
    hAlign: "center",
  });

  if (uiButton("+ Surface").clicked) {
    addSurface();
  }
  if (uiButton("Toggle Calibrate").clicked) {
    mapper?.toggleCalibrate();
  }
  if (uiButton("Save Mapping").clicked) {
    mapper?.saveAll();
  }
  if (uiButton("Load Mapping").clicked) {
    mapper?.loadAll();
  }
  if (uiButton("Reset Mapping").clicked) {
    mapper?.resetAll();
  }

  uiText(`surfaces: ${surfaces.length}`, {
    bgColor: "#fde7ff",
  });
  uiText(`calibrate: ${mapper?.isCalibrating() ? "on" : "off"}`, {
    bgColor: "#fde7ff",
  });
  uiText(weatherSummaryLine(), {
    bgColor: "#fde7ff",
  });
  uiListEnd();

  drawWeatherPanel(pg);
  uiEndUseGraphics();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

async function fetchWeather() {
  weatherInfo.loading = true;
  weatherInfo.error = "";

  try {
    const response = await fetch(WEATHER_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const primaryWeather = Array.isArray(data.weather) ? data.weather[0] : null;

    weatherInfo = {
      loading: false,
      error: "",
      city: data.name || "Roskilde",
      temp: data.main?.temp ?? null,
      feelsLike: data.main?.feels_like ?? null,
      description: primaryWeather?.description || "",
      wind: data.wind?.speed ?? null,
      humidity: data.main?.humidity ?? null,
      rain1h: data.rain?.["1h"] ?? 0,
    };
    lastWeatherFetchMs = millis();
  } catch (error) {
    weatherInfo.loading = false;
    weatherInfo.error = String(error?.message || error);
    lastWeatherFetchMs = millis();
  }
}

function maybeRefreshWeather() {
  if (weatherInfo.loading) return;
  if (millis() - lastWeatherFetchMs < WEATHER_REFRESH_MS) return;
  fetchWeather();
}

function weatherSummaryLine() {
  if (weatherInfo.loading) return "weather: loading...";
  if (weatherInfo.error) return `weather: ${weatherInfo.error}`;
  if (weatherInfo.temp == null) return "weather: no data";
  return `weather: ${round(weatherInfo.temp, 1)} C, ${weatherInfo.description || "unknown"}`;
}

function drawWeatherPanel(pg) {
  const x = 320;
  const y = 180;
  const w = 340;
  const h = 184;

  pg.push();
  pg.noStroke();
  pg.fill("#fde7ff");
  pg.rect(x, y, w, h, 18);

  pg.fill("#210a1f");
  pg.textAlign(LEFT, TOP);
  pg.textSize(26);
  pg.text(`${weatherInfo.city || "Roskilde"} Weather`, x + 18, y + 16);

  pg.textSize(20);
  if (weatherInfo.loading) {
    pg.text("Loading live weather...", x + 18, y + 58);
  } else if (weatherInfo.error) {
    pg.text(`Error: ${weatherInfo.error}`, x + 18, y + 58, w - 36);
  } else {
    pg.text(`Now: ${formatTemp(weatherInfo.temp)} C`, x + 18, y + 58);
    pg.text(`Feels: ${formatTemp(weatherInfo.feelsLike)} C`, x + 18, y + 86);
    pg.text(`Sky: ${weatherInfo.description || "-"}`, x + 18, y + 114, w - 36);
    pg.text(`Wind: ${formatValue(weatherInfo.wind)} m/s`, x + 18, y + 142);
    pg.text(`Humidity: ${formatValue(weatherInfo.humidity)}%`, x + 170, y + 142);
    pg.text(`Rain 1h: ${formatValue(weatherInfo.rain1h)} mm`, x + 18, y + 168);
  }
  pg.pop();
}

function formatTemp(value) {
  return value == null ? "-" : nf(value, 1, 1);
}

function formatValue(value) {
  return value == null ? "-" : value;
}
