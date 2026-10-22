// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindChips } from '../../../src/options/chips';
import { PATTERN_MAX_CHARS } from '../../../src/shared/constants';

const TOKENS = ['{artist}', '{id}', '{title}', '{userId}'] as const;
type Token = (typeof TOKENS)[number];

let field: HTMLInputElement;
let chips: Map<Token, HTMLButtonElement>;
let onInsert: ReturnType<typeof vi.fn<() => void>>;

function chip(token: Token): HTMLButtonElement {
  const button = chips.get(token);
  if (!button) throw new Error(`no chip ${token}`);
  return button;
}

/** The user puts the caret (or a selection) somewhere in the field, as a click would. */
function placeCaret(start: number, end = start): void {
  field.focus();
  field.setSelectionRange(start, end);
  field.dispatchEvent(new Event('mouseup'));
}

/**
 * happy-dom 21's setRangeText(…, 'end') puts the caret at `start` + the whole new value's length
 * instead of right after the replacement. This is the HTML-spec (and Chrome) behavior of the
 * four-argument 'end' form, the only one bindChips uses.
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

beforeEach(() => {
  useSpecSetRangeText();
  field = document.createElement('input');
  field.type = 'text';
  field.value = 'pixiv/{artist}-{id}';
  const outside = document.createElement('button');
  chips = new Map(
    TOKENS.map((token) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.token = token;
      return [token, button];
    }),
  );
  document.body.replaceChildren(field, ...chips.values(), outside);
  onInsert = vi.fn<() => void>();
  bindChips(field, chips.values(), onInsert);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('bindChips', () => {
  it('bindChips: appends the token when the field has never had focus', () => {
    chip('{title}').click();
    expect(field.value).toBe('pixiv/{artist}-{id}{title}');
  });

  it('bindChips: inserts the token at the caret', () => {
    placeCaret('pixiv/'.length);
    chip('{id}').click();
    expect(field.value).toBe('pixiv/{id}{artist}-{id}');
  });

  it('bindChips: replaces the selected text', () => {
    placeCaret('pixiv/'.length, 'pixiv/{artist}'.length);
    chip('{userId}').click();
    expect(field.value).toBe('pixiv/{userId}-{id}');
  });

  it('bindChips: leaves the caret right after the inserted token', () => {
    placeCaret('pixiv/'.length);
    chip('{id}').click();
    expect([field.selectionStart, field.selectionEnd]).toEqual([10, 10]);
  });

  it('bindChips: returns focus to the field', () => {
    placeCaret(0);
    chip('{id}').focus();
    chip('{id}').click();
    expect(document.activeElement).toBe(field);
  });

  it('bindChips: uses the caret recorded when the field lost focus', () => {
    placeCaret(5);
    field.blur();
    chip('{id}').click();
    expect(field.value).toBe('pixiv{id}/{artist}-{id}');
  });

  it('bindChips: consecutive chips insert one after another', () => {
    placeCaret(0);
    chip('{artist}').click();
    chip('{id}').click();
    expect(field.value).toBe('{artist}{id}pixiv/{artist}-{id}');
  });

  it('bindChips: runs the field input path after an insertion', () => {
    chip('{id}').click();
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('bindChips: a stale caret past the end of a shortened value appends', () => {
    placeCaret(field.value.length);
    field.blur();
    field.value = 'a';
    chip('{id}').click();
    expect(field.value).toBe('a{id}');
  });

  it('bindChips: inserts a token that brings the value to exactly the limit', () => {
    field.value = 'x'.repeat(PATTERN_MAX_CHARS - '{id}'.length);
    chip('{id}').click();
    expect(field.value).toHaveLength(PATTERN_MAX_CHARS);
  });

  it('bindChips: does nothing when the token would exceed the limit', () => {
    const value = 'x'.repeat(PATTERN_MAX_CHARS - '{title}'.length + 1);
    field.value = value;
    chip('{title}').click();
    expect(field.value).toBe(value);
  });

  it('bindChips: runs no input path when the limit blocks the token', () => {
    field.value = 'x'.repeat(PATTERN_MAX_CHARS);
    chip('{id}').click();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('bindChips: counts the replaced selection against the limit', () => {
    field.value = `${'x'.repeat(PATTERN_MAX_CHARS - 4)}abcd`;
    placeCaret(PATTERN_MAX_CHARS - 4, PATTERN_MAX_CHARS);
    chip('{id}').click();
    expect(field.value).toBe(`${'x'.repeat(PATTERN_MAX_CHARS - 4)}{id}`);
  });

  it('bindChips: prevents the default of mousedown so the field keeps focus', () => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    chip('{artist}').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
