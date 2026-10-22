import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERER_RULE_ID, installRefererRule } from '../../../src/background/dnr';
import { FAKE_EXTENSION_ID, installChromeFake, type ChromeFake } from '../../fakes/chrome';

let fake: ChromeFake;

beforeEach(() => {
  fake = installChromeFake();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dnr: Referer session rule (system.md §8.2, ENG-002 variant)', () => {
  it('installRefererRule: sets Referer on this extension’s own i.pximg.net fetches only', async () => {
    await installRefererRule();
    expect(fake.dnr.rules).toEqual([
      {
        id: REFERER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://www.pixiv.net/' },
          ],
        },
        condition: {
          requestDomains: ['i.pximg.net'],
          initiatorDomains: [FAKE_EXTENSION_ID],
          tabIds: [-1],
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ]);
  });

  it('installRefererRule: is idempotent across SW starts', async () => {
    await installRefererRule();
    await installRefererRule();
    expect(fake.dnr.rules).toHaveLength(1);
  });

  it('installRefererRule: uses a session rule, never a dynamic one', async () => {
    await installRefererRule();
    expect(fake.api.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(1);
  });
});
