// Shared helpers for reading a Google Form's structure.
//
// Google embeds the whole form definition in a `FB_PUBLIC_LOAD_DATA_` script tag.
// We parse it to map human-readable question titles to their `entry.XXXX` ids,
// which lets the bot be configured by label instead of by opaque id.

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const DEFAULT_FORM_ID = '1FAIpQLSfjmqpdecwRL-WEOYKT9tHwrlPg_xL-PJqor1xFAEP-O_zwCw';

export const QUESTION_TYPES = {
  0: 'Short answer',
  1: 'Paragraph',
  2: 'Multiple choice (radio)',
  3: 'Dropdown',
  4: 'Checkboxes',
  5: 'Linear scale',
  7: 'Grid',
  9: 'Date',
  10: 'Time',
  13: 'File upload',
};

export function viewFormUrl(opts = {}) {
  const explicit = opts.url || process.env.PARKING_FORM_URL;
  if (explicit) return explicit.replace(/\/(closedform|formResponse)(\?.*)?$/, '/viewform');
  const id = opts.id || process.env.PARKING_FORM_ID || DEFAULT_FORM_ID;
  return `https://docs.google.com/forms/d/e/${id}/viewform`;
}

export function formResponseUrl(opts = {}) {
  const explicit = opts.url || process.env.PARKING_FORM_URL;
  if (explicit) return explicit.replace(/\/(viewform|closedform|formResponse)(\?.*)?$/, '/formResponse');
  const id = opts.id || process.env.PARKING_FORM_ID || DEFAULT_FORM_ID;
  return `https://docs.google.com/forms/d/e/${id}/formResponse`;
}

// Returns 'egress' | 'closed' | null for a fetched page.
export function classifyPage(status, finalUrl, html) {
  if (/not in allowlist|egress|network policy/i.test(html) && html.length < 600) return 'egress';
  if (/closedform/.test(finalUrl) || /no longer accepting responses|not accepting responses/i.test(html)) {
    return 'closed';
  }
  return null;
}

export async function fetchForm(url) {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, redirect: 'follow' });
  const html = await res.text();
  return { status: res.status, url: res.url, html };
}

// Parse FB_PUBLIC_LOAD_DATA_ into a list of questions:
//   [{ title, type, typeName, required, fields: [{ entryId, options: [] }] }]
export function parseForm(html) {
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);<\/script>/s);
  if (!m) throw new Error('Could not locate FB_PUBLIC_LOAD_DATA_ in the page.');
  const data = JSON.parse(m[1]);
  const items = data?.[1]?.[1] || [];
  const questions = [];
  for (const item of items) {
    const title = item[1] || '';
    const type = item[3];
    const rawFields = item[4] || [];
    const fields = rawFields.map((f) => ({
      entryId: f[0],
      options: (f[1] || []).map((o) => o[0]).filter((s) => s !== '' && s != null),
      required: f[2] === 1,
    }));
    if (!fields.length) continue; // skip page breaks / images / section headers
    questions.push({
      title,
      type,
      typeName: QUESTION_TYPES[type] || `type ${type}`,
      required: fields.some((f) => f.required),
      fields,
    });
  }
  return questions;
}

// Normalize a label for tolerant matching (case, whitespace, trailing asterisks).
export function normalizeLabel(s) {
  return String(s)
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Build a Map of normalized title -> question for label-based config.
export function buildLabelIndex(questions) {
  const index = new Map();
  for (const q of questions) index.set(normalizeLabel(q.title), q);
  return index;
}

// Count the number of pages (sections) in the form. Google Forms marks a
// section break with item type 8; pages = breaks + 1. Google rejects a POST
// whose `pageHistory` doesn't list every visited page, so we need this to
// build the right value for multi-section forms.
export function countPages(html) {
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);<\/script>/s);
  if (!m) return 1;
  try {
    const data = JSON.parse(m[1]);
    const items = data?.[1]?.[1] || [];
    const breaks = items.filter((it) => it[3] === 8).length;
    return breaks + 1;
  } catch {
    return 1;
  }
}
