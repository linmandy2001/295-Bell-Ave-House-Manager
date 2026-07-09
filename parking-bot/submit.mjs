#!/usr/bin/env node
// Parking pass Google Form auto-submitter.
//
// Submits a Google Form by POSTing url-encoded `entry.XXXX=value` pairs to the
// form's `/formResponse` endpoint — the same request your browser sends when you
// click "Submit". No browser/Selenium needed.
//
// Config keys may be EITHER:
//   • a question label, e.g. "License Plate"  (resolved to its entry id by
//     reading the live form — easiest, no id hunting), OR
//   • a raw "entry.123456" id                  (used as-is), OR
//   • "emailAddress"                            (Google's built-in "collect email"
//                                                field, if the form uses one), OR
//   • a "_comment"-style key                    (ignored).
//
// Values may contain {{DATE}}, {{DATE+1}}, {{DATE+1:MM/DD/YYYY}}, {{TIME}}
// templates, evaluated in PARKING_TZ.
//
// Usage:    node submit.mjs [path/to/config.json]
// Fields:   first CLI arg file → PARKING_FIELDS env (JSON) → parking-bot/config.json
//
// Env: PARKING_FIELDS, PARKING_FORM_URL, PARKING_FORM_ID, PARKING_TZ (default
//      America/New_York), DRY_RUN=1 (print payload, don't submit).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  formResponseUrl,
  viewFormUrl,
  fetchForm,
  classifyPage,
  parseForm,
  buildLabelIndex,
  normalizeLabel,
} from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TZ = process.env.PARKING_TZ || 'America/New_York';
const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN).toLowerCase());

function formatInTz(date, fmt) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  if (parts.hour === '24') parts.hour = '00';
  return fmt
    .replace(/YYYY/g, parts.year)
    .replace(/MM/g, parts.month)
    .replace(/DD/g, parts.day)
    .replace(/HH/g, parts.hour)
    .replace(/mm/g, parts.minute);
}

function expandTemplates(value) {
  if (typeof value !== 'string') return value;
  const re = /\{\{\s*(DATE|TIME)\s*([+-]\d+)?\s*(?::\s*([^}]+?))?\s*\}\}/g;
  return value.replace(re, (_, kind, offset, fmt) => {
    const days = offset ? parseInt(offset, 10) : 0;
    const when = new Date(Date.now() + days * 86_400_000);
    const defaultFmt = kind === 'DATE' ? 'YYYY-MM-DD' : 'HH:mm';
    return formatInTz(when, (fmt || defaultFmt).trim());
  });
}

function loadFields() {
  const fileArg = process.argv[2];
  if (fileArg) return JSON.parse(readFileSync(fileArg, 'utf8'));
  if (process.env.PARKING_FIELDS) {
    try {
      return JSON.parse(process.env.PARKING_FIELDS);
    } catch (err) {
      throw new Error(`PARKING_FIELDS is not valid JSON: ${err.message}`);
    }
  }
  try {
    return JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
  } catch {
    throw new Error(
      'No fields found. Pass a config file, set PARKING_FIELDS, or create parking-bot/config.json. See README.md.',
    );
  }
}

// Turn a config (label/entry/emailAddress keys) into resolved { key: value(s) }
// where every key is a real form field. Fetches the live form only if at least
// one label needs resolving.
async function resolveFields(fields) {
  const out = {};
  const labelKeys = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('_')) continue; // documentation key
    if (key.startsWith('entry.') || key === 'emailAddress') {
      out[key] = value;
    } else {
      labelKeys.push(key);
    }
  }
  if (labelKeys.length === 0) return out;

  const url = viewFormUrl();
  console.log(`[parking-bot] resolving ${labelKeys.length} label(s) against ${url}`);
  const { status, url: finalUrl, html } = await fetchForm(url);
  const problem = classifyPage(status, finalUrl, html);
  if (problem === 'egress') {
    throw new Error(
      `network blocked the form fetch (HTTP ${status}); this environment can't reach the form. ` +
        'Run where there is open internet (e.g. GitHub Actions).',
    );
  }
  if (problem === 'closed') throw new Error('the form is currently CLOSED (not accepting responses).');
  if (status !== 200) throw new Error(`unexpected HTTP ${status} fetching the form.`);

  const questions = parseForm(html);
  const index = buildLabelIndex(questions);
  const unmatched = [];
  for (const label of labelKeys) {
    const q = index.get(normalizeLabel(label));
    if (!q) {
      // A form with "collect email addresses" turned on shows an "Email" prompt
      // that is NOT a normal question (no entry id) — it uses emailAddress.
      if (normalizeLabel(label) === 'email') {
        out.emailAddress = fields[label];
        console.log('[parking-bot] "Email" has no entry id on this form — using built-in emailAddress field.');
        continue;
      }
      unmatched.push(label);
      continue;
    }
    out[`entry.${q.fields[0].entryId}`] = fields[label];
  }
  if (unmatched.length) {
    const available = questions.map((q) => `  - "${q.title}" [${q.typeName}]`).join('\n');
    throw new Error(
      `could not match these config labels to form questions:\n  ${unmatched
        .map((l) => `"${l}"`)
        .join(', ')}\nForm questions are:\n${available}\n` +
        'Fix the labels to match exactly, or use the entry.XXXX id instead.',
    );
  }
  return out;
}

function buildBody(resolved) {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(resolved)) {
    if (key !== 'emailAddress' && !key.startsWith('entry.')) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      const expanded = expandTemplates(String(v));
      if (expanded === '') continue; // skip empty optional answers
      params.append(key, expanded);
    }
  }
  if (!params.has('fvv')) params.append('fvv', '1');
  if (!params.has('pageHistory')) params.append('pageHistory', '0');
  return params;
}

async function submit() {
  const url = formResponseUrl();
  const fields = loadFields();
  const resolved = await resolveFields(fields);
  const entryCount = Object.keys(resolved).filter((k) => k.startsWith('entry.') || k === 'emailAddress').length;
  if (entryCount === 0) throw new Error('Config produced no submittable fields. See README.md.');
  const body = buildBody(resolved);

  console.log(`[parking-bot] ${new Date().toISOString()}`);
  console.log(`[parking-bot] timezone: ${TZ}`);
  console.log(`[parking-bot] target:   ${url}`);
  console.log('[parking-bot] payload:');
  for (const [k, v] of body.entries()) console.log(`    ${k} = ${v}`);

  if (DRY_RUN) {
    console.log('[parking-bot] DRY_RUN set — not submitting.');
    return;
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
        body: body.toString(),
        redirect: 'follow',
      });
      const text = await res.text();
      const closed = /no longer accepting responses|not accepting responses/i.test(text);
      const recorded = /your response has been recorded|response has been recorded|formResponse/i.test(
        res.url + ' ' + text,
      );
      if (res.ok && closed) {
        console.error('[parking-bot] ❌ The form is currently CLOSED (not accepting responses).');
        process.exit(2);
      }
      if (res.ok) {
        console.log(
          `[parking-bot] ✅ Submitted${recorded ? ' successfully' : ''} (HTTP ${res.status})` +
            `${recorded ? '.' : '; confirmation text not detected.'}`,
        );
        return;
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      console.error(`[parking-bot] attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt === maxAttempts) {
        console.error('[parking-bot] ❌ Giving up.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** (attempt - 1)));
    }
  }
}

submit().catch((err) => {
  console.error(`[parking-bot] ❌ ${err.message}`);
  process.exit(1);
});
