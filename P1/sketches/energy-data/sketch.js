// Paste into a Portal base sketch. Portal calls pSetup() for you.
let priceText = "Loading…";

async function setup() {
  createCanvas(windowWidth, windowHeight);

  try {
    const now = new Date();
    const day = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Copenhagen",
    }).format(now);
    const [year, month, date] = day.split("-");
    const url = `https://www.elprisenligenu.dk/api/v1/prices/${year}/${month}-${date}_DK2.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Price request failed");
    const prices = await response.json();
    const current = prices.find(p =>
      new Date(p.time_start) <= now && now < new Date(p.time_end)
    );
    priceText = current
      ? `${current.DKK_per_kWh.toFixed(2)} DKK/kWh`
      : "No price available";
  } catch (error) {
    priceText = "Could not load price";
    console.error(error);
  }
}

function draw() {
  background(255);
  fill(0);
  noStroke();
  textSize(24);
  text("Electricity price · DK2", 24, 50);
  text(priceText, 24, 90);
  textSize(14);
  text("Price at load time, excluding VAT and fees", 24, 125);
  text("Source: elprisenligenu.dk", 24, 150);
}
