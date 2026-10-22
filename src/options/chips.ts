// Token chips (design-options-page.md "Chips", PRD CUJ-3 step 4): a chip inserts its token at the
// field's last caret, replacing any selection, or appends it if the field has never had focus.

import { PATTERN_MAX_CHARS } from '../shared/constants';

interface Caret {
  start: number;
  end: number;
}

const CARET_EVENTS = ['focus', 'select', 'keyup', 'mouseup', 'input', 'blur'] as const;

/** Wires every `[data-token]` chip to `field`; `onInsert` runs the field's input path. */
export function bindChips(
  field: HTMLInputElement,
  chips: Iterable<HTMLButtonElement>,
  onInsert: () => void,
): void {
  let caret: Caret | null = null;
  const track = (): void => {
    const end = field.value.length;
    caret = { start: field.selectionStart ?? end, end: field.selectionEnd ?? end };
  };
  for (const type of CARET_EVENTS) field.addEventListener(type, track);

  for (const chip of chips) {
    const token = chip.dataset.token ?? '';
    // Keeps the field focused, so its selection stays highlighted through the click.
    chip.addEventListener('mousedown', (event) => event.preventDefault());
    chip.addEventListener('click', () => {
      const length = field.value.length;
      // The field may have been rewritten (reset, another tab) since the caret was recorded.
      const start = Math.min(caret?.start ?? length, length);
      const end = Math.min(caret?.end ?? length, length);
      // Never truncate a token into an unknown one.
      if (length - (end - start) + token.length > PATTERN_MAX_CHARS) return;
      field.setRangeText(token, start, end, 'end');
      field.focus();
      track();
      onInsert();
    });
  }
}
