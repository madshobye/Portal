for (const host of document.querySelectorAll('[data-example]')) {
  const id = host.dataset.example;
  const example = uiGuideExamples[id];
  const intro = document.createElement('p');
  intro.textContent = example.intro;
  host.append(intro);
  const frame = document.createElement('iframe');
  frame.title = `${example.title}: interactive canvas example`;
  frame.loading = 'lazy';
  frame.height = example.height;
  const controls = document.createElement('div');
  controls.className = 'example-controls';
  const label = document.createElement('label');
  label.textContent = 'Theme ';
  const select = document.createElement('select');
  for (const theme of Object.keys(uiGuideThemes)) {
    const option = document.createElement('option');
    option.value = theme;
    option.textContent = theme[0].toUpperCase() + theme.slice(1);
    select.append(option);
  }
  label.append(select);
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'Copy sketch';
  controls.append(label, copy);
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'View complete sketch';
  const pre = document.createElement('pre');
  const code = document.createElement('code'); pre.append(code);
  details.append(summary, pre);
  function update() {
    frame.src = `docs/ui-slim/demo.html?example=${id}&theme=${select.value}`;
    code.textContent = uiGuideSketch(id, select.value);
  }
  select.addEventListener('change', update);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy sketch'; }, 1800);
    } catch {
      details.open = true;
      const selection = window.getSelection();
      const range = document.createRange(); range.selectNodeContents(code);
      selection.removeAllRanges(); selection.addRange(range);
      copy.textContent = 'Code selected — copy manually';
    }
  });
  update(); host.append(controls, frame, details);
}
