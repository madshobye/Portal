/* Shared by the guide and the live frames: displayed code is the code being run. */
const uiGuideThemes = {
  paper: {
    common: { font: 'sans-serif', fontSize: 15, height: 38, padding: 12, margin: 10,
      rounding: 8, textColor: '#21211f', bgColor: '#e9e5dc',
      stroke: { weight: 0 }, hover: { bgColor: '#ded8cc' }, pressed: { bgColor: '#cbc2b2' } },
    text: { bgColor: false }, button: { hAlign: 'center' },
    slider: { trackColor: '#e9e5dc', fillColor: '#f2aa8e' },
    toggle: { onBgColor: '#bce2ca', offBgColor: '#e9e5dc' }
  },
  midnight: {
    common: { font: 'monospace', fontSize: 14, height: 38, padding: 12, margin: 10,
      rounding: 5, textColor: '#f0f3ff', bgColor: '#293247',
      stroke: { weight: 0 }, hover: { bgColor: '#3c4963' }, pressed: { bgColor: '#526383' } },
    text: { bgColor: false }, button: { hAlign: 'center' },
    slider: { trackColor: '#293247', fillColor: '#465ab7' },
    toggle: { onBgColor: '#286450', offBgColor: '#293247' }
  },
  signal: {
    common: { font: 'sans-serif', fontSize: 16, height: 38, padding: 12, margin: 10,
      rounding: 0, textColor: '#101010', bgColor: '#ffffff',
      stroke: { weight: 2, color: '#101010', alpha: 255 },
      hover: { bgColor: '#ffe779' }, pressed: { bgColor: '#ffbf47' } },
    text: { bgColor: false }, button: { hAlign: 'left' },
    slider: { trackColor: '#e6e6df', fillColor: '#ffe779' },
    toggle: { onBgColor: '#ffe779', offBgColor: '#ffffff' }
  }
};
const uiGuideBackgrounds = { paper: '#fffdf8', midnight: '#151b29', signal: '#f5f5ec' };
const uiGuideExamples = {
  components: {
    title: 'A small control panel', height: 380,
    intro: 'Click the button, drag the slider, switch the toggle, and open the text prompt. All controls are drawn directly on the p5 canvas.',
    draw: function () {
      uiListStart({ x: 20, y: 20, width: width - 40 });
      uiText('CONTROL PANEL', { fontSize: 12 });
      if (uiButton('Count a click').clicked) {
        uiSet('guide-clicks', uiGet('guide-clicks', 0) + 1);
      }
      const level = uiSlider('guide-level', 'Level', { min: 0, max: 100, init: 35 }, { persist: false }).value;
      const enabled = uiToggle('guide-enabled', 'Output', { showStateText: true, persist: false }).value;
      const name = uiPromptText('guide-name', 'Name', { persist: false }).value;
      uiText(`${uiGet('guide-clicks', 0)} clicks / level ${Math.round(level)}`);
      uiText(`${name || 'Visitor'} / output ${enabled ? 'on' : 'off'}`);
      uiListEnd();
    }
  },
  states: {
    title: 'Style one control', height: 300,
    intro: 'Hover or press the red button to see its state styles. A transparent button needs transparent hover and pressed styles too, because styles merge.',
    draw: function () {
      uiListStart({ x: 20, y: 20, width: width - 40 });
      uiButton('Primary action', {
        bgColor: '#c62630', textColor: '#ffffff', rounding: 20,
        stroke: { weight: 0 },
        hover: { bgColor: '#a91d28' },
        pressed: { bgColor: '#74141c' }
      });
      uiButton('Outline action', {
        bgColor: false, stroke: { weight: 1, color: '#b77743' },
        hover: { bgColor: false, textColor: '#b77743' },
        pressed: { bgColor: false, textColor: '#c62630' }
      });
      uiButton('Unavailable', {
        disabled: true, bgColor: '#dedede', textColor: '#666666',
        stroke: { weight: 0 }
      });
      uiText('Left / top', { height: 60, hAlign: 'left', vAlign: 'top', fontSize: 18 });
      uiText('Right aligned', { hAlign: 'right', font: 'monospace' });
      uiListEnd();
    }
  },
  themes: {
    title: 'One panel, three themes', height: 230,
    intro: 'Use the theme selector to change the shared stylesheet. The widget calls stay the same. Copy the sketch to get the selected theme in setup().',
    draw: function () {
      uiListStart({ x: 20, y: 20, width: width - 40 });
      uiText('A SHARED VISUAL LANGUAGE', { fontSize: 12 });
      uiButton('Run experiment');
      uiSlider('guide-theme-speed', 'Speed', { init: 0.65 }, { persist: false });
      uiToggle('guide-theme-run', 'Running', { showStateText: true, persist: false });
      uiListEnd();
    }
  },
  layout: {
    title: 'Lists and absolute placement', height: 275,
    intro: 'A vertical list sets a shared width. A horizontal list uses each widget’s width. Separate lists make sections easy to position without relying on nested layout.',
    draw: function () {
      const panelWidth = width - 40;
      uiRect(12, 12, width - 24, 248, { bgColor: false, stroke: { weight: 1, color: '#a99e8c' }, rounding: 12 });
      uiListStart({ x: 20, y: 20, width: panelWidth, margin: 6 });
      uiText('VERTICAL LIST', { fontSize: 12 });
      uiButton('Full-width control');
      uiButton('Compact control', { height: 26, fontSize: 12 });
      uiListEnd();
      uiListStart({ x: 20, y: 158, dir: 'horizontal', margin: 8 });
      uiButton('Left', { width: (panelWidth - 8) / 2 });
      uiButton('Right', { width: (panelWidth - 8) / 2 });
      uiListEnd();
      uiText('Absolute position', { x: 20, y: 210, width: panelWidth, hAlign: 'right' });
    }
  },
  sliders: {
    title: 'Sliders as faders and meters', height: 300,
    intro: 'Drag relative to the current value; clicking a position does not directly set the value. Drag upward on the vertical fader. Round the returned value when you need whole numbers.',
    draw: function () {
      const fader = uiSlider('guide-fader', '', { min: 0, max: 1, init: 0.6 }, {
        x: 20, y: 20, width: 56, height: 240,
        vertical: true, hideText: true, rounding: 12, persist: false
      });
      uiListStart({ x: 96, y: 20, width: width - 116 });
      uiText(`Level ${Math.round(fader.value * 100)}%`);
      uiSlider('guide-rate', 'Rate', { min: 0, max: 10, init: 4 }, { hideValue: true, persist: false });
      uiSlider('guide-thin', '', { init: 0.75 }, { height: 12, hideText: true, persist: false });
      uiText('Drag to adjust', { fontSize: 12 });
      uiListEnd();
    }
  },
  plot: {
    title: 'Plot live data', height: 275,
    intro: 'Pass arrays of values or named series to uiPlot. This example generates a moving signal; replace it with readings from your sketch. Hover to see the cursor line.',
    draw: function () {
      const signal = Array.from({ length: 80 }, (_, i) => Math.sin(i / 9 + millis() / 900));
      uiPlot('guide-signal', [{ label: 'Signal', values: signal, color: '#f28d72', weight: 2 }], {
        x: 20, y: 20, width: width - 40, height: 230,
        bgColor: '#182131', textColor: '#edf2fa',
        gridColor: '#303d51', axisColor: '#61738e',
        yMin: -1.2, yMax: 1.2, padding: 30,
        headerItems: true, footerText: 'Live signal / 80 samples', rounding: 12
      });
    }
  }
};
function uiGuideSketch(id, theme = 'paper') {
  const example = uiGuideExamples[id];
  const body = example.draw.toString().replace(/^function\s*\(\)\s*\{\n/, '').replace(/\n    \}$/, '').replace(/^      /gm, '  ');
  return `// Paste into a Portal base sketch (uiSlim2 is already loaded).\nfunction setup() {\n  createCanvas(windowWidth, ${example.height});\n  uiSetBaseStyle(${JSON.stringify(uiGuideThemes[theme], null, 2).replace(/\n/g, '\n  ')});\n}\n\nfunction draw() {\n  background('${uiGuideBackgrounds[theme]}');\n${body}\n}\n`;
}
