import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', SRC), 'utf8')) as Record<
  string,
  unknown
>;

describe('src/manifest.json', () => {
  it('manifest: requests exactly the five approved permissions', () => {
    expect(manifest.permissions).toEqual([
      'downloads',
      'storage',
      'offscreen',
      'declarativeNetRequestWithHostAccess',
      'downloads.ui',
    ]);
  });

  it('manifest: requests exactly the two pixiv hosts', () => {
    expect(manifest.host_permissions).toEqual(['https://www.pixiv.net/*', 'https://i.pximg.net/*']);
  });

  it('manifest: requires Chrome 116 (runtime.getContexts)', () => {
    expect(manifest.minimum_chrome_version).toBe('116');
  });

  it('manifest: has no popup, so action.onClicked fires', () => {
    expect(manifest.action).not.toHaveProperty('default_popup');
  });

  it('manifest: declares no web_accessible_resources', () => {
    expect(manifest).not.toHaveProperty('web_accessible_resources');
  });

  it('manifest: equals system.md §5 exactly', () => {
    expect(manifest).toEqual({
      manifest_version: 3,
      name: '__MSG_ext_name__',
      description: '__MSG_ext_description__',
      default_locale: 'en',
      version: '1.0.0',
      minimum_chrome_version: '116',
      icons: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
      action: {
        default_title: '__MSG_action_title_idle__',
        default_icon: { '16': 'icons/icon-16.png', '32': 'icons/icon-32.png' },
      },
      background: { service_worker: 'sw.js', type: 'module' },
      options_ui: { page: 'options.html', open_in_tab: true },
      content_scripts: [
        {
          matches: ['https://www.pixiv.net/*'],
          js: ['content.js'],
          run_at: 'document_end',
          all_frames: false,
        },
      ],
      permissions: [
        'downloads',
        'storage',
        'offscreen',
        'declarativeNetRequestWithHostAccess',
        'downloads.ui',
      ],
      host_permissions: ['https://www.pixiv.net/*', 'https://i.pximg.net/*'],
    });
  });

  it('manifest: every icon it references exists in src/', () => {
    const icons = Object.values(manifest.icons as Record<string, string>);
    expect(icons.filter((icon) => !existsSync(new URL(icon, SRC)))).toEqual([]);
  });
});
