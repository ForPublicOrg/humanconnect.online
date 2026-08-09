# humanconnect.online 💚

**The live map of real-world meetups.** Drop an event on the map — a morning
yoga session, an evening cricket match, a community cleanup — and watch people
join. The pin grows as more people join. When the event's time runs out (max
1 week), it disappears forever.

- **Frontend-only.** Static files + Firestore. Hosted on Vercel.
- **No accounts.** Joining is an anonymous counter.
- **Abuse-proof names.** Event names are composed from a fixed word list
  ([js/words.js](js/words.js)) and stored as integer indices — free text can
  never enter the database. Security rules enforce this server-side.

## Run it right now (demo mode)

Open the folder with any static file server:

```bash
npx http-server -p 5173 -c-1 .
```

Until Firebase is configured, the site runs in **demo mode**: full UX, events
stored in your browser only, with a few seeded samples.

## Deploy on Vercel

The site is static, but a tiny build step
([scripts/apply-env-config.mjs](scripts/apply-env-config.mjs)) writes
[js/env.js](js/env.js) from environment variables so you configure production
in the Vercel dashboard — **never commit keys to the repo.**

1. **Import** the repo in Vercel (framework preset: *Other*). [vercel.json](vercel.json)
   already sets the build command, security headers, CSP, and cache rules — no
   extra Vercel settings needed.

2. **Add environment variables** (Project → Settings → Environment Variables).
   All are optional; with none set the deploy stays in demo mode. Firebase web
   keys are *public by design* — what protects the backend is App Check + rules.

   | Variable | Purpose |
   | --- | --- |
   | `FIREBASE_API_KEY` | Firebase web app config |
   | `FIREBASE_PROJECT_ID` | Firebase project id (`authDomain` is derived from it) |
   | `FIREBASE_APP_ID` | Firebase web app id |
   | `FIREBASE_AUTH_DOMAIN` | *(optional)* only if it isn't `<project>.firebaseapp.com` |
   | `APPCHECK_SITE_KEY` | reCAPTCHA v3 site key — turns on App Check (do this) |
   | `MAP_PROVIDER` | `carto` (default) or `mappls` |
   | `MAPPLS_KEY` | Mappls key for India-official borders |
   | `REPORT_EMAIL` | inbox for the Report button |

   After changing any variable, **redeploy** (env vars are baked in at build).

3. **Custom domain**: Vercel → Domains → add `humanconnect.online`, then set the
   DNS records Vercel shows at your registrar. The canonical URL, sitemap, and
   Open Graph tags are all already `https://humanconnect.online/`, so keep that
   as the production domain and everything lines up.

Firestore setup (rules, index, TTL) below is still required — Vercel serves the
site, Firebase stores the data.

## Firestore setup (data backend, ~10 minutes)

1. **Create a project** at [console.firebase.google.com](https://console.firebase.google.com)
   (e.g. `humanconnect-online`). Google Analytics is optional — off is fine.

2. **Create a Firestore database**: Build → Firestore Database → Create
   database → *Production mode* → pick a region close to your users
   (e.g. `asia-south1` for India).

3. **Register a web app**: Project settings → Your apps → Web (`</>`).
   Put the config values into your **Vercel environment variables**
   (`FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`) — see the
   Vercel section above — not into the repo.

4. **Deploy the security rules** (this is what makes the site safe to run
   without a backend — do not skip):

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add        # select your project
   firebase deploy --only firestore
   ```

   This deploys both the rules and the composite index
   ([firestore.indexes.json](firestore.indexes.json)) that viewport-scoped
   queries need. The index takes a few minutes to build the first time.

5. **Enable TTL deletion** so expired events are deleted *forever*
   automatically: Firestore → Time-to-live (TTL) → Create policy →
   Collection group: `events`, Timestamp field: `expiresAt`.
   (Free feature. Deletion happens within ~24h of expiry; the app already
   hides expired events instantly, so users never see them.)

6. **Hosting** is handled by Vercel (see the Vercel section above). You do not
   need Firebase Hosting — `firebase.json` is kept only for the Firestore
   rules/index deploy in step 4.

## India-compliant map borders (important before public launch)

Free OpenStreetMap-based tiles (CARTO — the default here) draw international
boundaries per international convention: parts of Jammu & Kashmir / Aksai Chin
appear dashed or outside India. That depiction does **not** follow the Survey
of India map, which Indian law expects for maps published for Indian users.

Fix (two env vars): get a **free API key** from
[Mappls / MapmyIndia](https://apis.mappls.com/console/) — an Indian provider
whose maps follow official Government of India boundaries (J&K, Ladakh and
Arunachal Pradesh shown fully as India) — then in Vercel set:

```
MAP_PROVIDER = mappls
MAPPLS_KEY   = YOUR_MAPPLS_KEY
```

The app loads Mappls' Leaflet-based SDK automatically and everything else
works identically. In the Mappls console, restrict the key to your domain
(`humanconnect.online`). If Mappls ever fails to load, the app falls back to
CARTO tiles instead of showing a blank page.

## How the safety model works

| Threat | Defense |
| --- | --- |
| Offensive / illegal event names | Names are indices into a fixed word list; rules reject anything else. No free text exists anywhere in the system. |
| Malformed join writes | Rules only allow `joins` to increase by exactly 1 per write, nothing else may change. (This stops *tampering*, not *inflation* — see residual risks below.) |
| Deleting other people's events | Deletes are denied for everyone; only Firestore TTL removes documents. |
| Events that never expire | Rules require `expiresAt` within 7 days of creation; TTL erases them after expiry. |
| Junk documents / extra fields | Rules require the exact field set with the exact types, `joins = 0`, and server-time `created`. |

## Abuse & attack protection (read before launch)

This site is public, open-source, and has no backend — so assume every part
of it will be poked at. Defense layers, in order of importance:

1. **Firebase App Check (do this)** — blocks scripts/bots from calling
   Firestore at all; only real browsers running *your* site get through.
   Free. Setup: Firebase console → App Check → register web app with
   **reCAPTCHA v3** → set the reCAPTCHA *site key* as the `APPCHECK_SITE_KEY`
   env var in Vercel and redeploy → back in App Check, set Firestore to
   **Enforced** (start in "Monitor" for a day if you want to be careful).

   ⚠️ **Two separate steps.** Setting the site key wires up the *client*;
   enforcement is only real once you flip Firestore to **Enforced** in the
   console. Client init alone does nothing to a script that skips your JS. If
   you go live (`FIREBASE_API_KEY` set) with `APPCHECK_SITE_KEY` still empty,
   the app logs a loud console warning — that means you have **zero** bot
   protection. Both halves are required.

2. **Stay on the free Spark plan** — this is your billing-DoS protection.
   With no billing account attached, a read/write flood can only exhaust the
   daily free quota (site pauses until midnight PT), it can never cost you
   money. Only upgrade to Blaze once you also have App Check enforced and
   [budget alerts](https://console.cloud.google.com/billing) set.

3. **Security rules** (deployed in step 4 above) — even a client that gets
   past App Check can only: create a validly-shaped event, or +1 a join
   counter. No free text, no deletes, no edits, no extra fields.

4. **Restrict your API keys**: Google Cloud console → Credentials → your
   browser key → HTTP referrer restriction `humanconnect.online/*`. Same for
   the Mappls key in its console. (Firebase web keys are public by design —
   restriction just narrows misuse.)

5. **Kill switch**: if something ugly happens, make the site read-only in
   one minute — edit `firestore.rules` to `allow create, update: if false;`
   and run `firebase deploy --only firestore:rules`. Events stay visible,
   nothing new can be written.

6. **DDoS on the site itself**: static files on Firebase Hosting sit behind
   Google's CDN — there is no origin server of yours to take down. For an
   extra layer (and nice caching), you can front the domain with Cloudflare's
   free plan.

7. **XSS**: there is no user-generated text anywhere — names are indices
   into a fixed word list, and the one numeric value rendered into HTML
   (the join count) is integer-validated on read. The deployed site also
   ships a strict Content-Security-Policy (see [vercel.json](vercel.json)).

8. **Moderation**: every event has a Report button that emails you (the
   `REPORT_EMAIL` env var). Delete a reported event directly in the Firebase
   console — clients can't.

Residual risks to know about (all bounded, none catastrophic):

- **Junk events by hand.** A patient human with a real browser can create junk
  events (the 2-minute cooldown is client-side only). The word-list design
  caps the damage — the worst "spam" is a grid of harmless-sounding events that
  all expire on their own.
- **Join-count inflation.** With no accounts, the rules can enforce "+1 per
  write" but can't stop someone scripting many +1 writes to inflate an event's
  count. So treat join counts as *social proof, not audited numbers*. App Check
  raises the bar; true integrity would need per-user identity (out of scope for
  a no-login site).
- **Cell flooding.** Because the rules can't recompute a geohash, a flood of
  coordinate/`g4`-mismatched events is *possible*. Two things blunt it: the map
  query keeps the soonest-expiring events (so max-expiry junk is dropped first,
  not shown first), and the client logs a warning when a viewport's results are
  mostly invalid — an eclipse is visible, not silent. App Check enforcement is
  the real fix, which is why it's step 1.

None of these lets an attacker post offensive text, delete others' events, run
code in a visitor's browser, or cost you money on the Spark plan.

## If you edit the word lists

Only **append** words (never reorder/remove — existing events store indices),
then update the three list lengths in [firestore.rules](firestore.rules)
(`VIBES=30, ACTIVITIES=86, FORMATS=26` today) and redeploy rules.

## SEO

The site ships with a [sitemap.xml](sitemap.xml), [robots.txt](robots.txt),
canonical URL, Open Graph / Twitter cards with a branded share image
([assets/og.png](assets/og.png)), JSON-LD structured data, and crawlable
`<noscript>` content. After going live, submit
`https://humanconnect.online/sitemap.xml` in
[Google Search Console](https://search.google.com/search-console) once and
you're done — it's a single-URL app, so there is nothing else to maintain.

## Built to scale across India

- **Viewport-scoped reads.** Every event stores its ~39×20 km geohash cell
  (`g4`). Visitors subscribe only to the handful of cells covering their
  viewport, so someone browsing Pune never downloads Delhi's events. Zoomed
  out to country level, the app switches to a single capped query (newest
  500). Panning within the same cells costs no extra reads.
- **Clustering.** Dense areas collapse into "N plans" bubbles; individual
  pins (sized by joins) appear from street-level zoom. Thousands of events
  stay smooth because the DOM only ever holds what the viewport needs.
- **Costs.** Firestore free tier: 50k reads / 20k writes per day — a visitor
  session in one city typically costs a few dozen reads. With App Check
  enforced and viewport scoping, the free tier goes a long way; if you
  outgrow it, that's the good problem.
