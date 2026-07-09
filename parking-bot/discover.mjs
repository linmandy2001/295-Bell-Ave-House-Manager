#!/usr/bin/env node
// Discover a Google Form's field IDs.
//
// Run while the form is OPEN to print each question's title, entry id, type, and
// (for choice questions) the exact option strings, plus a starter config keyed by
// LABEL (the easiest way to configure the bot — no entry ids needed).
//
// Usage:  node discover.mjs [formUrl]

import { viewFormUrl, fetchForm, classifyPage, parseForm } from './lib.mjs';

async function main() {
  const url = viewFormUrl({ url: process.argv[2] });
  console.error(`[discover] fetching ${url}`);
  const { status, url: finalUrl, html } = await fetchForm(url);

  const problem = classifyPage(status, finalUrl, html);
  if (problem === 'egress') {
    console.error(
      `[discover] ❌ Network blocked this request (HTTP ${status}). This environment cannot reach\n` +
        '            the form. Run it with open internet (your machine, or Actions "discover" mode).',
    );
    console.error(`            Response body: ${html.trim().slice(0, 200)}`);
    process.exit(3);
  }
  if (problem === 'closed') {
    console.error('[discover] ❌ The form is CLOSED right now. Re-run when it is open.');
    process.exit(2);
  }
  if (status !== 200) {
    console.error(`[discover] ❌ Unexpected HTTP ${status}. Body: ${html.trim().slice(0, 200)}`);
    process.exit(1);
  }

  let questions;
  try {
    questions = parseForm(html);
  } catch (err) {
    console.error(`[discover] ❌ ${err.message} Has the form layout changed?`);
    process.exit(1);
  }

  const config = {};
  console.error('\n[discover] Fields found:\n');
  for (const q of questions) {
    const field = q.fields[0];
    console.error(`  • ${q.title}${q.required ? ' *' : ''}`);
    console.error(`      entry.${field.entryId}   [${q.typeName}]`);
    if (field.options.length) {
      console.error(`      options: ${field.options.map((o) => JSON.stringify(o)).join(', ')}`);
    }
    if (q.type === 9) {
      console.error('      NOTE: Date question — submit the templated text value, or if rejected use');
      console.error(`            entry.${field.entryId}_year / _month / _day separately.`);
    }
    // Starter config is keyed by LABEL so the user never copies entry ids.
    const key = q.title || `entry.${field.entryId}`;
    if (q.type === 2 || q.type === 3 || q.type === 4) config[key] = field.options[0] ?? 'CHOOSE_ONE';
    else if (q.type === 9) config[key] = '{{DATE+1:YYYY-MM-DD}}';
    else config[key] = 'FILL_ME_IN';
  }

  console.error('\n[discover] Starter config (edit values, store as the PARKING_FIELDS secret):\n');
  console.log(JSON.stringify(config, null, 2));
}

main().catch((err) => {
  console.error(`[discover] ❌ ${err.message}`);
  process.exit(1);
});
