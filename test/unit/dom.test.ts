// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { h } from '../../src/shared/dom';

describe('h', () => {
  it('h: creates an element of the given tag', () => {
    expect(h('button').tagName).toBe('BUTTON');
  });

  it('h: sets string attributes', () => {
    expect(h('a', { href: 'https://example.com/' }).getAttribute('href')).toBe(
      'https://example.com/',
    );
  });

  it('h: sets number attributes as ASCII digits', () => {
    expect(h('input', { maxlength: 200 }).getAttribute('maxlength')).toBe('200');
  });

  it('h: sets an empty attribute for true', () => {
    expect(h('button', { disabled: true }).getAttribute('disabled')).toBe('');
  });

  it('h: omits attributes that are false, null or undefined', () => {
    expect(h('div', { hidden: false, title: null, id: undefined }).attributes).toHaveLength(0);
  });

  it('h: appends string children as literal text, never markup', () => {
    const el = h('p', null, '<img src=x onerror=alert(1)>');
    expect(el.children).toHaveLength(0);
  });

  it('h: keeps the literal text of a string child', () => {
    expect(h('p', null, '<b>雨上がり</b>').textContent).toBe('<b>雨上がり</b>');
  });

  it('h: renders number children as ASCII digits', () => {
    expect(h('span', null, 12).textContent).toBe('12');
  });

  it('h: appends node children in order', () => {
    const el = h('ul', null, h('li', null, 'a'), 'b', h('li', null, 'c'));
    expect(Array.from(el.childNodes, (node) => node.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('h: skips null, undefined and false children', () => {
    expect(h('div', null, null, undefined, false, 'x').childNodes).toHaveLength(1);
  });

  it('h: returns the tag-specific element type', () => {
    const input: HTMLInputElement = h('input', { type: 'checkbox', checked: true });
    expect(input.checked).toBe(true);
  });
});
