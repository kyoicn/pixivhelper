// JSON bodies shaped like pixiv's /ajax/illust endpoints (the fields pixiv-api.ts and metadata.ts read,
// plus enough of the rest to look like the real thing).

import {
  frameFileName,
  masterUrl,
  originalUrl,
  pageCount,
  ugoiraSmallZipUrl,
  ugoiraZipUrl,
  type UgoiraWork,
  type Work,
} from '../fixtures/works';

export interface AjaxEnvelope {
  error: boolean;
  message: string;
  body: unknown;
}

export const MESSAGE_NOT_FOUND = '該当作品は削除されたか、存在しない作品IDです。';
export const MESSAGE_RESTRICTED = '閲覧が制限されている作品です';
export const MESSAGE_NOT_UGOIRA = 'うごイラではありません';

export function ok(body: unknown): AjaxEnvelope {
  return { error: false, message: '', body };
}

export function failure(message: string): AjaxEnvelope {
  return { error: true, message, body: [] };
}

function firstPageOriginal(work: Work): string {
  return work.illustType === 2 ? masterUrl(work) : originalUrl(work, 0);
}

/** pixiv's sanity level: 6 for R-18/R-18G, 4 behind the sensitive-content wall, else 2. */
function sanityLevel(work: Work): number {
  if (work.xRestrict > 0) return 6;
  return work.sensitiveWall === true ? 4 : 2;
}

/**
 * Whether pixiv withholds the work's images from this viewer (system.md §8.5): logged out, on an
 * R-18/R-18G work or one behind the sensitive-content wall.
 */
export function isWalled(work: Work, loggedIn: boolean): boolean {
  return !loggedIn && (work.xRestrict > 0 || work.sensitiveWall === true);
}

/** `GET /ajax/illust/{id}` body. `gated`: pixiv nulls every image URL (see isWalled). */
export function illustBody(work: Work, gated: boolean): Record<string, unknown> {
  const original = gated ? null : firstPageOriginal(work);
  const preview = gated ? null : masterUrl(work);
  return {
    illustId: work.id,
    illustTitle: work.title,
    illustComment: work.description,
    id: work.id,
    title: work.title,
    description: work.description,
    illustType: work.illustType,
    createDate: work.createDate,
    uploadDate: work.createDate,
    restrict: 0,
    xRestrict: work.xRestrict,
    sl: sanityLevel(work),
    urls: { mini: preview, thumb: preview, small: preview, regular: preview, original },
    tags: {
      authorId: work.userId,
      isLocked: false,
      tags: work.tags.map((tag) => ({
        tag,
        locked: true,
        deletable: false,
        userId: work.userId,
        userName: work.userName,
      })),
      writable: true,
    },
    alt: `${work.title} - ${work.userName}のイラスト`,
    userId: work.userId,
    userName: work.userName,
    userAccount: `user_${work.userId}`,
    width: work.width,
    height: work.height,
    pageCount: pageCount(work),
    bookmarkCount: 0,
    likeCount: 0,
    commentCount: 0,
    responseCount: 0,
    viewCount: 0,
    isOriginal: work.tags.includes('オリジナル'),
    aiType: 1,
  };
}

/** `GET /ajax/illust/{id}/pages` body: one entry per page, in page order. */
export function pagesBody(work: Work): unknown[] {
  const urls = (original: string) => ({
    thumb_mini: masterUrl(work),
    small: masterUrl(work),
    regular: masterUrl(work),
    original,
  });
  if (work.illustType === 2) {
    return [{ urls: urls(firstPageOriginal(work)), width: work.width, height: work.height }];
  }
  return work.pages.map((_, page) => ({
    urls: urls(originalUrl(work, page)),
    width: work.width,
    height: work.height,
  }));
}

/** `GET /ajax/illust/{id}/ugoira_meta` body. */
export function ugoiraMetaBody(work: UgoiraWork): Record<string, unknown> {
  return {
    src: ugoiraSmallZipUrl(work),
    originalSrc: ugoiraZipUrl(work),
    mime_type: 'image/jpeg',
    frames: work.frameDelays.map((delay, index) => ({ file: frameFileName(index), delay })),
  };
}
