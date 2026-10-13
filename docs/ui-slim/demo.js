// These isolated frames load uiSlim directly; Portal normally supplies the font and input update.
const baseFont = 'sans-serif';
const params = new URLSearchParams(location.search);
const example = uiGuideExamples[params.get('example')] || uiGuideExamples.components;
const theme = Object.hasOwn(uiGuideThemes, params.get('theme')) ? params.get('theme') : 'paper';
function fullScreenToggle() { fullscreen(!fullscreen()); }
function setup() {
  createCanvas(windowWidth, example.height);
  pixelDensity(1);
  frameRate(30);
  uiSetBaseStyle(uiGuideThemes[theme]);
  describe(example.intro);
}
function draw() {
  uiUpdateSimple();
  background(uiGuideBackgrounds[theme]);
  example.draw();
}
function windowResized() { resizeCanvas(windowWidth, example.height); }
window.addEventListener('error', () => {
  const message = document.getElementById('error');
  message.hidden = false;
  message.textContent = 'The live example could not load. Check your connection and reload. The source code remains available in the guide.';
});
if (typeof p5 === 'undefined') window.dispatchEvent(new Event('error'));
