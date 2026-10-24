// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSingleLine } from '../../../src/options/single-line';
import { PATTERN_MAX_CHARS } from '../../../src/shared/constants';

const MULTI_LINE = 'pixiv/\n{artist}\r\n-{id}\n';
const ONE_LINE = 'pixiv/{artist}-{id}';
const EMOJI = '\u{1f600}';

let field: HTMLInputElement;
let inputs: InputEvent[];

/**
 * happy-dom 21's setRangeText(…, 'end') misplaces the caret (see chips.test.ts); this is the
 * HTML-spec (and Chrome) behavior.
 */
function useSpecSetRangeText(): void {
  vi.spyOn(HTMLInputElement.prototype, 'setRangeText').mockImplementation(function (
    this: HTMLInputElement,
    replacement: string,
    start: number,
    end: number,
    mode?: SelectionMode,
  ) {
    if (mode !== 'end') throw new Error(`setRangeText stand-in: unsupported mode ${mode}`);
    this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
    this.setSelectionRange(start + replacement.length, start + replacement.length);
  });
}

function setField(value: string, start = value.length, end = start): void {
  field.value = value;
  field.focus();
  field.setSelectionRange(start, end);
}

/** The browser is about to insert `text`; returns the event so its defaultPrevented can be read. */
function beforeInput(inputType: string, text: string, cancelable = true): InputEvent {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable,
    inputType,
    data: text,
  });
  field.dispatchEvent(event);
  return event;
}

const caret = (): [number | null, number | null] => [field.selectionStart, field.selectionEnd];

beforeEach(() => {
  useSpecSetRangeText();
  field = document.createElement('input');
  field.type = 'text';
  document.body.replaceChildren(field);
  inputs = [];
  field.addEventListener('input', (event) => inputs.push(event));
  bindSingleLine(field, PATTERN_MAX_CHARS);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('bindSingleLine', () => {
  it('bindSingleLine: a paste with line breaks into an empty field lands without them', () => {
    setField('');
    beforeInput('insertFromPaste', MULTI_LINE);
    expect(field.value).toBe(ONE_LINE);
  });

  it('bindSingleLine: a paste with line breaks puts the caret after the inserted text', () => {
    setField('');
    beforeInput('insertFromPaste', MULTI_LINE);
    expect(caret()).toEqual([ONE_LINE.length, ONE_LINE.length]);
  });

  it('bindSingleLine: a paste with line breaks fires exactly one input event, carrying the clean text', () => {
    setField('');
    beforeInput('insertFromPaste', MULTI_LINE);
    expect(inputs.map((e) => [e.inputType, e.data, e.bubbles])).toEqual([
      ['insertFromPaste', ONE_LINE, true],
    ]);
  });

  it('bindSingleLine: a paste with line breaks cancels the native insertion', () => {
    setField('');
    expect(beforeInput('insertFromPaste', MULTI_LINE).defaultPrevented).toBe(true);
  });

  it('bindSingleLine: a paste over a selection replaces it', () => {
    setField('pixiv/{title}/x', 'pixiv/'.length, 'pixiv/{title}'.length);
    beforeInput('insertFromPaste', '{artist}\n-{id}');
    expect([field.value, caret()]).toEqual([
      'pixiv/{artist}-{id}/x',
      ['pixiv/{artist}-{id}'.length, 'pixiv/{artist}-{id}'.length],
    ]);
  });

  it('bindSingleLine: a drop lands at the caret inside the value', () => {
    setField('pixiv/-{id}', 'pixiv/'.length);
    beforeInput('insertFromDrop', '{artist}\r\n');
    expect([field.value, caret()]).toEqual([
      'pixiv/{artist}-{id}',
      ['pixiv/{artist}'.length, 'pixiv/{artist}'.length],
    ]);
  });

  it('bindSingleLine: insertText with a line break lands without it', () => {
    setField('pixiv/');
    beforeInput('insertText', '{id}\n');
    expect(field.value).toBe('pixiv/{id}');
  });

  it('bindSingleLine: reads the text from dataTransfer when the event has no data', () => {
    setField('');
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', MULTI_LINE);
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromDrop',
      dataTransfer,
    });
    // happy-dom turns a missing data into ''; Chrome leaves it null when it fills dataTransfer.
    Object.defineProperty(event, 'data', { value: null });
    field.dispatchEvent(event);
    expect(field.value).toBe(ONE_LINE);
  });

  it('bindSingleLine: text without line breaks is left to the browser', () => {
    setField('pixiv/');
    const event = beforeInput('insertFromPaste', '{artist}-{id}');
    expect([event.defaultPrevented, field.value, inputs.length]).toEqual([false, 'pixiv/', 0]);
  });

  it('bindSingleLine: a non-cancelable event is left to the browser', () => {
    setField('');
    const event = beforeInput('insertFromPaste', MULTI_LINE, false);
    expect([event.defaultPrevented, field.value, inputs.length]).toEqual([false, '', 0]);
  });

  it('bindSingleLine: other input types are left to the browser', () => {
    setField('');
    const event = beforeInput('insertReplacementText', MULTI_LINE);
    expect([event.defaultPrevented, field.value, inputs.length]).toEqual([false, '', 0]);
  });

  it('bindSingleLine: only line breaks at a collapsed caret change nothing and fire no input', () => {
    setField(ONE_LINE, 'pixiv/'.length);
    const event = beforeInput('insertFromPaste', '\r\n\n');
    expect([event.defaultPrevented, field.value, caret(), inputs.length]).toEqual([
      true,
      ONE_LINE,
      ['pixiv/'.length, 'pixiv/'.length],
      0,
    ]);
  });

  it('bindSingleLine: only line breaks over a selection delete it, as an empty paste would', () => {
    setField('pixiv/{title}/{id}', 'pixiv/'.length, 'pixiv/{title}/'.length);
    beforeInput('insertFromPaste', '\n');
    expect([field.value, inputs.length]).toEqual(['pixiv/{id}', 1]);
  });

  it('bindSingleLine: cuts the insertion so the field holds at most maxChars', () => {
    const start = 'a'.repeat(PATTERN_MAX_CHARS - 5);
    setField(start);
    beforeInput('insertFromPaste', 'bcd\nefgh');
    expect(field.value).toBe(`${start}bcdef`);
  });

  it('bindSingleLine: the cap counts the selection it replaces as room', () => {
    const start = 'a'.repeat(PATTERN_MAX_CHARS);
    setField(start, 0, 3);
    beforeInput('insertFromPaste', 'b\ncdef');
    expect(field.value).toBe(`bcd${start.slice(3)}`);
  });

  it('bindSingleLine: the cap never keeps half of a surrogate pair', () => {
    const start = 'a'.repeat(PATTERN_MAX_CHARS - 5);
    setField(start);
    beforeInput('insertFromPaste', `bcd\ne${EMOJI}f`);
    expect([field.value, field.value.length]).toEqual([`${start}bcde`, PATTERN_MAX_CHARS - 1]);
  });

  it('bindSingleLine: a full field with a collapsed caret takes nothing and fires no input', () => {
    const start = 'a'.repeat(PATTERN_MAX_CHARS);
    setField(start);
    beforeInput('insertFromPaste', 'b\nc');
    expect([field.value, inputs.length]).toEqual([start, 0]);
  });
});
