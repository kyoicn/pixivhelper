// ENG-002 spike offscreen document: i.pximg.net fetches, blob: hand-off,
// fallback ajax and the codec probe. Never shipped.

// run.mjs copies node_modules/mediabunny/dist/bundles/mediabunny.mjs here.
const MEDIABUNNY_PATH = './vendor/mediabunny.mjs';

const PROBES = [
  { codec: 'avc', fullCodecString: 'avc1.64001e', width: 600, height: 600 },
  { codec: 'avc', fullCodecString: 'avc1.4d001e', width: 600, height: 600 },
  { codec: 'avc', fullCodecString: 'avc1.42e01e', width: 600, height: 600 },
  { codec: 'avc', fullCodecString: 'avc1.640028', width: 1920, height: 1080 },
  { codec: 'vp9', width: 600, height: 600 },
  { codec: 'vp9', width: 1920, height: 1080 },
];

async function fetchStatus({ url }) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  const bytes = await res.arrayBuffer();
  return { status: res.status, size: bytes.byteLength };
}

async function fetchBlob({ url }) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  const blob = await res.blob();
  if (!res.ok) return { status: res.status, size: blob.size, blobUrl: null };
  return { status: res.status, size: blob.size, type: blob.type, blobUrl: URL.createObjectURL(blob) };
}

async function ajax({ url }) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, parsed: false };
  }
  return {
    status: res.status,
    parsed: true,
    error: json.error,
    message: json.message,
    illustType: json.body?.illustType ?? null,
    xRestrict: json.body?.xRestrict ?? null,
  };
}

async function probe() {
  const { canEncodeVideo, QUALITY_VERY_HIGH } = await import(MEDIABUNNY_PATH);
  const results = [];
  for (const p of PROBES) {
    const opts = { width: p.width, height: p.height, quality: QUALITY_VERY_HIGH };
    if (p.fullCodecString) opts.fullCodecString = p.fullCodecString;
    let ok;
    try {
      ok = await canEncodeVideo(p.codec, opts);
    } catch (e) {
      ok = 'throws ' + String(e);
    }
    results.push({ label: `${p.fullCodecString ?? p.codec}@${p.width}x${p.height}`, ok });
  }
  return { videoEncoder: typeof VideoEncoder !== 'undefined', results };
}

const HANDLERS = { fetchStatus, fetchBlob, ajax, probe };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const handler = HANDLERS[msg.cmd];
  if (!handler) {
    sendResponse({ exception: 'unknown cmd ' + msg.cmd });
    return false;
  }
  handler(msg).then(sendResponse, (e) => sendResponse({ exception: String(e) }));
  return true;
});
