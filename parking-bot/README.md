# 🅿️ Parking Pass Bot

Automatically fills out the parking pass Google Form **every night before 10 PM ET**
and emails you a confirmation — running in the cloud via GitHub Actions, so your
computer doesn't need to be on.

It works by sending the same `POST` request your browser sends when you click
**Submit**, so there's no fragile browser automation. Zero npm dependencies (uses
Node's built-in `fetch`; email uses `curl`, already on the runner).

**You configure it by question label, not by cryptic field ids** — the bot reads
the live form each run and resolves labels like `"License Plate"` to the right
`entry.XXXX` automatically.

> **The form is closed right now.** The link ends in `/closedform`, so its fields
> can't be read yet. Do the one-time setup below **while the form is open**
> (accepting responses), then the nightly job runs on its own.

---

## How the schedule works

The workflow (`.github/workflows/parking-pass.yml`) runs on this cron:

```
0 1 * * *   # 01:00 UTC every day
```

GitHub Actions cron is **always UTC**, so `01:00 UTC` was picked because it lands at:

| ET period            | Local time it fires |
| -------------------- | ------------------- |
| Standard time (EST)  | **8:00 PM ET**      |
| Daylight time (EDT)  | **9:00 PM ET**      |

Both are safely before the 10 PM deadline, in both halves of the year, with no
daylight-saving double-submit. GitHub can delay scheduled jobs a bit under load,
which is why there's an hour+ of buffer.

To shift the time, edit the `cron` line (remember: it's UTC).

---

## One-time setup

### 1. Fill in your values

Start from [`config.example.json`](./config.example.json) — it's already keyed to
this form's questions. Just replace each value with your real info:

```jsonc
{
  "Email": "you@example.com",
  "House Number the Vehicle is Parked In Front of": "123",
  "Street Name of Vehicle Location": "Main Street",
  "Phone Number": "9735551234",
  "License Plate": "ABC1234",
  "License Plate State": "New Jersey",   // must match the form's option exactly
  "Vehicle Make": "Toyota",
  "Vehicle Model": "Camry",
  "Vehicle Color": "Silver"
}
```

The keys are the **question labels**; the bot resolves them to `entry.XXXX` ids by
reading the live form, so you never look up ids. Leave optional fields (Resident
Location, Any additional information) as `""` to skip them.

> **Tip — see the exact option strings** for dropdowns like *License Plate State*:
> run the discovery step and read the log.
> - **In GitHub (no setup):** Actions → **Parking Pass Nightly** → **Run workflow**
>   → mode **`discover`** → open the run → **Discover form fields** step.
> - **Locally:** `node parking-bot/discover.mjs`
>
> You can also configure by raw id (`"entry.123456": "..."`) or use checkbox arrays
> (`"Some question": ["Option A", "Option B"]`) if you prefer.

### 2. Store your values as a GitHub secret

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `PARKING_FIELDS`
- **Value:** the entire JSON object with your values

That's the only **required** secret. Keep your real values out of git — a secret is
the safe place for them (a local `config.json` is also git-ignored).

### 3. Turn on the nightly confirmation email (optional but recommended)

Email is sent via SMTP. For Gmail you need an **App Password** (a normal password
won't work):

1. Enable **2-Step Verification** on your Google account.
2. Go to <https://myaccount.google.com/apppasswords> → create one named "parking-bot"
   → copy the 16-character password.
3. Add these **repository secrets** (same Secrets page as above):

   | Secret          | Value                                            |
   | --------------- | ------------------------------------------------ |
   | `MAIL_TO`       | where to send the confirmation (e.g. your email) |
   | `MAIL_USERNAME` | your Gmail address                               |
   | `MAIL_PASSWORD` | the 16-char App Password                         |

   Non-Gmail SMTP? Also set repo **variables** `MAIL_HOST` and `MAIL_PORT`.

You'll get a **"Parking pass submitted ✅"** email on success and a
**"Parking pass FAILED ❌"** email (telling you to do it manually) if anything goes
wrong. If you skip these secrets, the bot still submits — it just won't email.

### 4. Test it

- **Preview the payload (no submit):** Actions → **Run workflow** → mode **`dry-run`**.
- **Real test submit + email:** Actions → **Run workflow** → mode **`submit`**.
- Locally (if you have Node): `DRY_RUN=1 node parking-bot/submit.mjs your-config.json`

After that it runs automatically every night on the schedule above.

---

## Value templates

Any string value may contain these tokens, evaluated in `PARKING_TZ`
(default `America/New_York`):

| Token                    | Example output (run on Jun 18) |
| ------------------------ | ------------------------------ |
| `{{DATE}}`               | `2026-06-18`                   |
| `{{DATE+1}}`             | `2026-06-19` (tomorrow)        |
| `{{DATE-1}}`             | `2026-06-17` (yesterday)       |
| `{{DATE+1:MM/DD/YYYY}}`  | `06/19/2026`                   |
| `{{TIME}}`               | `21:30`                        |
| `{{TIME:HH:mm}}`         | `21:30`                        |

Format tokens: `YYYY` `MM` `DD` `HH` `mm`.

**Date questions:** Google date fields usually accept the templated text value
above. If a date field is rejected, `discover.mjs` will tell you to split it into
`entry.123_year`, `entry.123_month`, `entry.123_day` instead — set those three
keys with `{{DATE+1:YYYY}}`, `{{DATE+1:MM}}`, `{{DATE+1:DD}}`.

---

## Configuration reference

| Env var            | Required  | Default                   | Purpose                                       |
| ------------------ | --------- | ------------------------- | --------------------------------------------- |
| `PARKING_FIELDS`   | ✅ (in CI) | —                         | JSON map of label/`entry.XXXX` → value        |
| `PARKING_FORM_URL` | no        | the built-in parking form | Override if the form URL changes              |
| `PARKING_FORM_ID`  | no        | the built-in id           | Alternative to `PARKING_FORM_URL`             |
| `PARKING_TZ`       | no        | `America/New_York`        | Timezone for date/time templates              |
| `DRY_RUN`          | no        | off                       | `1` = print payload, don't submit             |
| `MAIL_TO`          | for email | —                         | Confirmation email recipient                  |
| `MAIL_USERNAME`    | for email | —                         | SMTP login / sender                           |
| `MAIL_PASSWORD`    | for email | —                         | SMTP password (Gmail: App Password)           |
| `MAIL_FROM`        | no        | `MAIL_USERNAME`           | From address                                  |
| `MAIL_HOST`        | no        | `smtp.gmail.com`          | SMTP host                                     |
| `MAIL_PORT`        | no        | `465`                     | SMTP port (465 = implicit TLS)                |

Fields can also be loaded from a file argument or `parking-bot/config.json`
(git-ignored) when running locally.

---

## Exit codes

| Code | Meaning                                              |
| ---- | --------------------------------------------------- |
| `0`  | Submitted successfully                              |
| `1`  | Error (bad config, network failure after retries)  |
| `2`  | Form is currently closed (not accepting responses) |

---

## Notes & limitations

- **Only submit forms you're authorized to use.** This automates *your own*
  parking pass submission.
- If the form adds **required questions** you haven't mapped, Google rejects the
  POST — re-run `discover.mjs` and add the new `entry.XXXX` keys.
- File-upload questions and Google-account-restricted forms (sign-in required)
  can't be submitted this way.
