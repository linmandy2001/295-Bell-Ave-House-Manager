#!/usr/bin/env node
// Send a confirmation email after a parking-pass run.
//
// Uses `curl`'s SMTP support (present on GitHub's ubuntu runners) so there are no
// npm dependencies and no third-party Actions. Designed for Gmail by default but
// works with any SMTP server.
//
// Env:
//   MAIL_TO         recipient (required; if missing, this script no-ops quietly)
//   MAIL_USERNAME   SMTP login / sender (required)
//   MAIL_PASSWORD   SMTP password — for Gmail, a 16-char App Password (required)
//   MAIL_FROM       From address (default: MAIL_USERNAME)
//   MAIL_HOST       SMTP host (default: smtp.gmail.com)
//   MAIL_PORT       SMTP port (default: 465, implicit TLS)
//   SUBMIT_OUTCOME  "success" | "failure" | ... (from the submit step)
//   PARKING_TZ      timezone for the timestamp (default America/New_York)
//   RUN_URL         link to the Actions run (included on failure)
//   NOTIFY_DRY=1    print the email instead of sending it

import { writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const to = process.env.MAIL_TO;
const user = process.env.MAIL_USERNAME;
const pass = process.env.MAIL_PASSWORD;
const DRY = ['1', 'true', 'yes'].includes(String(process.env.NOTIFY_DRY).toLowerCase());

if (!to || !user || !pass) {
  console.log('[notify] Email not configured (need MAIL_TO, MAIL_USERNAME, MAIL_PASSWORD) — skipping.');
  process.exit(0);
}

const from = process.env.MAIL_FROM || user;
const host = process.env.MAIL_HOST || 'smtp.gmail.com';
const port = parseInt(process.env.MAIL_PORT || '465', 10);
const tz = process.env.PARKING_TZ || 'America/New_York';
const outcome = String(process.env.SUBMIT_OUTCOME || 'unknown').toLowerCase();
const ok = outcome === 'success';

const stamp = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(
  new Date(),
);
const subject = ok ? `Parking pass submitted - ${stamp}` : `Parking pass FAILED - ${stamp}`;
const body = ok
  ? [
      'Your parking pass form was submitted successfully. ✅',
      '',
      `When:  ${stamp} (${tz})`,
      `Form:  ${process.env.PARKING_FORM_URL || 'parking pass form'}`,
      '',
      'No action needed.',
      '',
      '— parking-bot',
    ].join('\n')
  : [
      'WARNING: the parking pass submission did NOT succeed. ❌',
      '',
      `When:    ${stamp} (${tz})`,
      `Status:  ${outcome}`,
      '',
      'Please submit the parking pass MANUALLY before 10 PM.',
      ...(process.env.RUN_URL ? [`Details: ${process.env.RUN_URL}`] : []),
      '',
      '— parking-bot',
    ].join('\n');

// Build an RFC 5322 message. Use CRLF line endings as SMTP expects.
const headers = [
  `From: parking-bot <${from}>`,
  `To: ${to}`,
  `Subject: ${subject}`,
  `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
];
const message = headers.join('\r\n') + '\r\n\r\n' + body.replace(/\n/g, '\r\n') + '\r\n';

if (DRY) {
  console.log('[notify] NOTIFY_DRY set — would send this email:\n');
  console.log(`(via ${host}:${port} as ${user})\n`);
  console.log(message);
  process.exit(0);
}

const scheme = port === 465 ? 'smtps' : 'smtp';
const file = join(tmpdir(), `parking-mail-${process.pid}.eml`);
writeFileSync(file, message);

try {
  execFileSync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--ssl-reqd',
      `${scheme}://${host}:${port}`,
      '--mail-from',
      from,
      '--mail-rcpt',
      to,
      '--upload-file',
      file,
      '--user',
      `${user}:${pass}`,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  console.log(`[notify] ✅ Confirmation email sent to ${to} (outcome: ${outcome}).`);
} catch (err) {
  console.error(`[notify] ❌ Failed to send email: ${err.message}`);
  process.exitCode = 1; // don't mask the submit result, but surface the mail failure
} finally {
  try {
    rmSync(file);
  } catch {}
}
