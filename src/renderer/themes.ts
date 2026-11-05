import type { Theme } from '../shared/contracts.js';

export type ThemeChoice = Theme;

const choices: ReadonlyArray<{ value: ThemeChoice; label: string; detail: string }> = [
  { value: 'ember', label: 'Ember', detail: 'Charcoal and orange' },
  { value: 'graphite', label: 'Graphite', detail: 'Neutral and silver' },
  { value: 'midnight', label: 'Midnight', detail: 'Deep blue' },
  { value: 'plum', label: 'Plum', detail: 'Dark violet' },
  { value: 'paper', label: 'Paper', detail: 'Warm light' },
  { value: 'system', label: 'System', detail: 'Follow your Mac' },
];

const systemAppearance = matchMedia('(prefers-color-scheme: dark)');
let currentChoice: ThemeChoice = 'ember';

export function applyTheme(choice: ThemeChoice): void {
  currentChoice = choice;
  document.documentElement.dataset.theme = choice === 'system'
    ? systemAppearance.matches ? 'ember' : 'paper'
    : choice;
}

systemAppearance.addEventListener('change', () => {
  if (currentChoice === 'system') applyTheme(currentChoice);
});

export function createThemePicker(
  selected: ThemeChoice,
  onChange: (theme: ThemeChoice) => void,
): HTMLElement {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'theme-options';
  const legend = document.createElement('legend');
  legend.textContent = 'Theme';
  const grid = document.createElement('div');
  grid.className = 'theme-grid';
  fieldset.append(legend, grid);

  for (const choice of choices) {
    const card = document.createElement('label');
    card.className = 'theme-card';
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.dataset.theme = choice.value;
    swatch.setAttribute('aria-hidden', 'true');
    const lines = document.createElement('span');
    lines.className = 'theme-lines';
    lines.append(...Array.from({ length: 3 }, () => document.createElement('i')));
    swatch.append(lines);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'theme';
    input.value = choice.value;
    input.checked = selected === choice.value;
    input.setAttribute('aria-label', choice.label);
    input.addEventListener('change', () => {
      if (input.checked) onChange(choice.value);
    });
    const label = document.createElement('strong');
    label.textContent = choice.label;
    const detail = document.createElement('small');
    detail.textContent = choice.detail;
    card.append(swatch, input, label, detail);
    grid.append(card);
  }

  return fieldset;
}
