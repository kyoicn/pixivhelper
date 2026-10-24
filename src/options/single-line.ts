// Keeps the folder field on one line (design-options-page.md "Line breaks in inserted text"; PRD
// CUJ-3 edge "Paste containing newlines"). Chromium turns each line break in text the user inserts
// into a space before `input` fires, so such an insertion is taken over at `beforeinput`.

const INTERCEPTED_INPUT_TYPES: ReadonlySet<string> = new Set([
  'insertText',
  'insertFromPaste',
  'insertFromDrop',
]);
const LINE_BREAK_RE = /[\r\n]/;
const LINE_BREAKS_RE = /[\r\n]/g;
const TRAILING_HIGH_SURROGATE_RE = /[\uD800-\uDBFF]$/;

/**
 * `text` cut to `max` UTF-16 units without keeping half a character, as Chromium's maxlength does.
 */
function limitLength(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(max, 0)).replace(TRAILING_HIGH_SURROGATE_RE, '');
}

/**
 * Keeps CR and LF out of text inserted into `field` by paste, drop or insertText. `maxChars` is the
 * field's cap.
 */
export function bindSingleLine(field: HTMLInputElement, maxChars: number): void {
  field.addEventListener('beforeinput', (event) => {
    if (!INTERCEPTED_INPUT_TYPES.has(event.inputType) || !event.cancelable) return;
    const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? null;
    // Text without line breaks is inserted natively, so it keeps undo, maxlength and the caret.
    if (text === null || !LINE_BREAK_RE.test(text)) return;
    event.preventDefault();
    const length = field.value.length;
    const start = field.selectionStart ?? length;
    const end = field.selectionEnd ?? length;
    const clean = limitLength(
      text.replace(LINE_BREAKS_RE, ''),
      maxChars - (length - (end - start)),
    );
    if (clean === '' && start === end) return;
    field.setRangeText(clean, start, end, 'end');
    // setRangeText fires no input event; the page's debounce and the chips' caret tracker need one.
    field.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: event.inputType, data: clean }),
    );
  });
}
