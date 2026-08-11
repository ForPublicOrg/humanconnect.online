# humanconnect.online 💚

**The live map of real-world meetups.** Drop an event on the map — a morning
yoga session, an evening cricket match, a community cleanup — and watch people
join. The pin grows as more people join. When the event's time runs out (max
1 week), it disappears forever.

- **Two kinds of pin.** A *plan* invites people to something and they tap
  **Join**. A *help request* asks people for something — a lift, blood, a
  ladder, an hour of tutoring — and they tap **I'm coming**. Everything else is
  identical, which is the point: same word lists, same timer, same counter,
  same ownership. See [Help requests](#help-requests) below.
- **Static site, three tiny endpoints.** The map is plain files reading
  Firestore directly. Only the three *writes* (create, join, remove) go through
  serverless functions in [api/](api), because "one join per person" is not
  something a browser can be trusted to enforce about itself.
- **No accounts.** Joining is an anonymous counter, but a counted one:
  Cloudflare Turnstile plus limits keyed on server-derived identity, so a fresh
  incognito window buys nothing. Creators can remove their own events early
  using a secret issued once at creation.
- **Abuse-proof names.** Names are composed from fixed word lists
  ([js/words.js](js/words.js)) and stored as integer indices — free text can
  never enter the database. The API validates against that same file.
- **Optional start time.** A plan can say when it actually begins, picked from
  quick presets or an exact time. It is bounded by how long the event stays on
  the map — nothing can be scheduled for after it has already vanished — and
  the API enforces that, not just the sheet.
- **Place search.** Jump anywhere with the header search (geocoding by
  [Photon](https://photon.komoot.io), keyless, OpenStreetMap data, worldwide).

## Help requests

The create sheet opens on **Plan something**; the switch at the top of it flips
to **Need help**, and the whole sheet re-reads itself — different word lists,
different labels, a different button. Nothing else about the pin changes.

|  | Plan | Help request |
| --- | --- | --- |
| Stored as | no `k` field | `k: 1` |
| Name is | `[vibe?] [activity] [format?]` | `[urgency?] [need] [wording?]` |
| Word lists | `VIBES` / `ACTIVITIES` / `FORMATS` | `URGENCY` / `NEEDS` / `HELP_FORMATS` |
| Reads as | "Evening Cricket Match" | "Urgent O Positive Blood Needed" |
| Pin | circle, category colour | rounded callout, one shared `--sos` colour, slow halo |
| Button | Join → "You're in ✓" | I'm coming → "You're coming ✓" |

Four decisions worth knowing about:

- **A required detail is required.** Where the missing detail decides *who*
  can help, the vocabulary carries typed variants and the generic word is
  **retired** (`r: true` in [js/words.js](js/words.js)): blood is asked for by
  group (`O-Positive-Blood` … `AB-Negative-Blood`, plus `Plasma`/`Platelets`),
  fuel as `Petrol` or `Diesel`. A retired word stays a valid index forever —
  existing pins keep their name, and an owner editing one isn't locked out —
  but the composer no longer offers it and `/api/create` refuses it. Details
  any willing helper can absorb on arrival (which medicine, where the ride
  goes) stay generic on purpose: the pin's job is to get a helper there, and
  free text is never an option.

- **Shape carries it, not colour.** Nine activity categories already own the
  palette, so a tenth set of meanings for the same hues would make the map
  unreadable. Every help pin is the *same* colour and a different *silhouette*
  — legible at any zoom, in greyscale, and next to a food-orange event pin.
  That colour is defined twice on purpose: `HELP_COLOR` in
  [js/words.js](js/words.js) and `--sos` in [css/style.css](css/style.css),
  because [js/share-card.js](js/share-card.js) paints it onto a canvas where no
  CSS variable reaches. A test asserts they match.
- **The kind is immutable.** `/api/update` compares the kind the client sent
  against the stored one and refuses a mismatch (`409 kind_mismatch`). A plan
  turning into a plea under the people who already joined it would be the same
  kind of lie as moving the pin, which is also forbidden.
- **An unknown kind is dropped on read, not guessed.** `sanitize()` in
  [js/store.js](js/store.js) discards any document whose `k` this build does
  not recognise, because its `{a,b,c}` would index into the wrong word lists —
  which is exactly the failure the fixed vocabulary exists to prevent. A future
  kind is therefore invisible to old clients rather than mislabelled by them.

Every safety layer applies unchanged: fixed vocabulary, Turnstile, the same
create/join limits, the Report button. On top of that, the create sheet and the
detail sheet both carry a safety note for requests — meet in public, never hand
over money, documents or OTPs, and call **112** (women's helpline **1091**) in
a real emergency. The map is neighbours helping neighbours, not a dispatch
service, and it says so where somebody is about to rely on it.

Personal safety follows the same line. The vocabulary covers the *before* and
*after* of danger — `Walk-Home`, `Safe-Place`, `Phone-Call`, `Safe-Walk`, and a
`Women-Only` first word so a woman can ask specifically for a woman — but
deliberately has no words for danger in progress (`Attack`, `Followed`,
`Harassment` are absent). A pin waits for whoever happens to pass and
broadcasts a frightened person's exact location to everyone, including exactly
the wrong people; the one correct answer to "in danger right now" is the
helplines, and both safety notes say so rather than letting the map pose as a
panic button.

The helpline numbers themselves are **localised to the visitor's country**
([js/emergency.js](js/emergency.js)): a reader in the US sees 911, in the UK
999, in Australia 000. The country comes from the browser's IANA timezone —
no network request, no permission prompt, no IP lookup; one synchronous `Intl`
call against a small static table, so it costs the page nothing. The tables
only list countries whose number *isn't* 112, because 112 is the right default
everywhere else (the EU's number, India's number, and the GSM standard mobile
networks route to local emergency services); a wrong number being worse than
none, uncertain countries are omitted and inherit that default. India is the
origin market and stays the fallback when there is no timezone signal at all —
the numbers baked into the static HTML — and remains the only country with a
women's-helpline clause (1091), because that is the only one verified as a
single nationwide number.

**Some countries have no single number, and the note says so.** South Korea
splits police (112) from fire/rescue/ambulance (119); printing one digit-string
there could send someone who is bleeding to a police dispatcher, so both are
shown and labelled: *"call 112 for police, 119 for fire or ambulance."* Only
genuine splits get this — a country with a working unified line stays a bare
number, because a frightened reader should not have to parse a menu.

Korea is also why the coverage check is now **mechanical rather than
remembered**. It was missing from the table entirely and inherited the 112
default, which happens to be its police number — a wrong answer that looked
right. The gap is found by subtracting the zones the module maps from
`Intl.supportedValuesOf('timeZone')`: whatever remains is exactly the set of
visitors being served the default, and every one of those countries has been
checked and either confirmed as genuinely-112 or given an override. Do that
subtraction again after any edit; a country nobody thought to check is the one
failure mode this design has.

## Run it right now (demo mode)

Open the folder with any static file server:

```bash
npx http-server -p 5173 -c-1 .
```

Until Firebase is configured, the site runs in **demo mode**: full UX, events
stored in your browser only, with a few seeded samples. Demo mode writes
straight to `localStorage` and never calls the API, so a plain static server is
all you need.

To exercise the real write path locally — Turnstile, the rate limits, the
Firestore transactions — you need the functions running too:

```bash
npx vercel dev
```

with the secret env vars pulled down (`npx vercel env pull`) and `localhost`
added to your Turnstile widget's hostname list.

## Deploy on Vercel

The site is static, but a tiny build step
([scripts/apply-env-config.mjs](scripts/apply-env-config.mjs)) writes
[js/env.js](js/env.js) from environment variables so you configure production
in the Vercel dashboard — **never commit keys to the repo.**

1. **Import** the repo in Vercel (framework preset: *Other*). [vercel.json](vercel.json)
   already sets the build command, security headers, CSP, and cache rules — no
   extra Vercel settings needed.

2. **Add environment variables** (Project → Settings → Environment Variables).
   With none set the deploy stays in demo mode.

   *Public* — baked into `js/env.js` at build time and visible in the browser.
   That's fine: Firebase web keys and the Turnstile site key are public by
   design.

   | Variable | Purpose |
   | --- | --- |
   | `FIREBASE_API_KEY` | Firebase web app config |
   | `FIREBASE_PROJECT_ID` | Firebase project id (`authDomain` is derived from it) |
   | `FIREBASE_APP_ID` | Firebase web app id |
   | `FIREBASE_AUTH_DOMAIN` | *(optional)* only if it isn't `<project>.firebaseapp.com` |
   | `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key — **required to create or join** |
   | `APPCHECK_SITE_KEY` | *(optional)* reCAPTCHA v3 site key — App Check, guards read volume |
   | `REPORT_EMAIL` | inbox for the Report button |

   *Secret* — read only inside [api/](api), never sent to the browser. Leave
   any of the first three unset and writes are refused (loudly, in the function
   log); they never silently fall open.

   | Variable | Purpose |
   | --- | --- |
   | `TURNSTILE_SECRET` | Turnstile secret key — verifies each token server-side |
   | `FIREBASE_SERVICE_ACCOUNT` | service-account JSON (raw or base64) the API writes with |
   | `IDENTITY_SALT` | long random string; HMAC salt for visitor hashes |

   Generate a salt with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   After changing any variable, **redeploy** (env vars are baked in at build).

3. **Custom domain**: Vercel → Domains → add `humanconnect.online`, then set the
   DNS records Vercel shows at your registrar. The canonical URL, sitemap, and
   Open Graph tags are all already `https://humanconnect.online/`, so keep that
   as the production domain and everything lines up.

Firestore setup (rules, index, TTL) below is still required — Vercel serves the
site *and runs the write API*, Firebase stores the data.

> **Vercel is no longer optional.** The three endpoints in [api/](api) are
> where every write is validated, verified and rate-limited. Firebase Hosting
> alone would serve the map read-only: creating and joining would 404.

## Cloudflare Turnstile (~3 minutes, free)

Turnstile is the "are you a script?" check on every create and join. It is
free at any volume and needs no Cloudflare account for your domain — just a
Cloudflare login.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile** → **Add
   widget**.
2. Name it `humanconnect`; **Hostnames**: `humanconnect.online` — plus
   `localhost` if you want to exercise the API locally, and your
   `*.vercel.app` preview domain if you use previews.
3. **Widget mode: Managed.** (Managed is the one that stays invisible for
   almost everyone and only shows a checkbox when a visitor looks automated.)
4. Copy the two keys into Vercel: **Site Key** → `TURNSTILE_SITE_KEY`,
   **Secret Key** → `TURNSTILE_SECRET`. Redeploy.

Testing keys, if you want to see both outcomes before going live: site key
`1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA`
always passes; `2x00000000000000000000AB` with `2x0000000000000000000000000000000AA`
always fails.

The widget is loaded lazily — the first time a visitor opens the create sheet
or an event, never on page load. People who only look at the map never touch
Cloudflare at all.

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

5. **Enable TTL deletion** so expired events and stale bookkeeping are deleted
   *forever* automatically: Firestore → Time-to-live (TTL) → Create policy.
   You need **four**, all on the timestamp field `expiresAt`:

   | Collection group | What it clears |
   | --- | --- |
   | `events` | the events themselves |
   | `priv` | per-event owner-secret hashes |
   | `joiners` | who has already been counted for an event |
   | `limits` | spent rate-limit buckets |

   Deleting a document does **not** delete its subcollections, which is why
   `priv` and `joiners` need their own policies rather than riding along with
   `events`. (Free feature. Deletion happens within ~24h of expiry; the app
   hides expired events instantly, so users never see them.)

6. **Create a service account** for the write API: Project settings →
   Service accounts → **Generate new private key** → a JSON file downloads.
   Paste its entire contents into the Vercel env var
   `FIREBASE_SERVICE_ACCOUNT`.

   ⚠️ This key can read and write your whole database and **bypasses the
   security rules** — that is the point, and it is why it lives only in
   Vercel's encrypted env store. Never commit it, never expose it to the
   browser. If it ever leaks, revoke it in the same console screen and
   generate a new one.

   *(Anonymous sign-in used to be required here, purely so the delete rule had
   a uid to check. It isn't any more — ownership is a secret issued by
   `/api/create` — so you can disable Anonymous auth if you enabled it.)*

7. **Hosting** is handled by Vercel (see the Vercel section above). You do not
   need Firebase Hosting — `firebase.json` is kept only for the Firestore
   rules/index deploy in step 4.

## India-compliant map borders

The map works worldwide on free CARTO/OSM tiles, but those tiles draw India's
disputed boundaries (Jammu & Kashmir, Ladakh/Aksai Chin, Arunachal Pradesh)
per international convention — **not** the Survey of India depiction that
Indian law expects.

A border is baked into the raster tile image, so you can't repaint it. The fix
([js/map-engine.js](js/map-engine.js)) draws **India's official national
boundary as a thin line on top** of the tiles, in a colour that matches the
basemap's own admin lines — so the presented border follows India's official
claim (full J&K, Ladakh/Aksai Chin, Arunachal all shown as India). No API key,
no provider, and the site still works for the whole world; this only adds
India's outline.

The boundary geometry is [data/india-border.geojson](data/india-border.geojson)
(~27 KB), derived from the official-boundary dataset
[udit-001/india-maps-data](https://github.com/udit-001/india-maps-data)
(exterior mesh of the states layer, simplified). To update it, regenerate that
line and replace the file — nothing else changes.

## How the safety model works

Clients can **read** Firestore and nothing else — [firestore.rules](firestore.rules)
denies every client write. Creating, joining, editing and removing go through
[api/](api), which is where all of this is enforced.

| Threat | Defense |
| --- | --- |
| Offensive / illegal names | Names are indices into fixed word lists — for help requests too. [api/_lib/validate.js](api/_lib/validate.js) rejects anything else, importing the *same* [js/words.js](js/words.js) the UI uses so the two can't drift. No free text exists anywhere in the system. |
| Indices that mean something else | `{a,b,c}` are meaningless without the kind, so the kind is validated *first* and the indices against that kind's lists. An unknown kind is refused on write and dropped on read, never rendered as a plan. |
| A plan quietly becoming a plea | The kind is not editable. `/api/update` compares it to the stored one inside the transaction and returns `409 kind_mismatch`, the same way the location is simply not accepted. |
| Help requests used as bait | The vocabulary is fixed, so no phone number, link or address can be posted; the pin is a place and a need. Both sheets warn to meet in public and never hand over money, documents or OTPs, and point to 112 for real emergencies. Requests carry the same Report button, and the same 7-day ceiling, as everything else. |
| Scripted floods | Every create and join needs a fresh, single-use Cloudflare Turnstile token, verified server-side before Firestore is touched at all. Automation pays a solved challenge per write. |
| Unlimited event creation | 6 events per day per network, behind a 2-minute cooldown — counted in Firestore against a hash of the caller's address, not in localStorage. |
| Join-count inflation | A join is recorded against `events/{id}/joiners/{networkHash}` before the counter moves. A repeat from the same device is idempotent; a *new* device on the same connection is allowed up to 8 per event, then refused. Opening incognito changes the device, never the network. |
| Deleting or editing other people's events | `/api/create` returns a 24-byte secret that exists only in the creator's browser; only its HMAC is stored, in a subdocument no client can read. `/api/remove` and `/api/update` compare in constant time. The public event doc still carries no identifier, so scrapers can't link one person's events into a movement profile. |
| Events that never expire | The API clamps `expiresAt` to 7 days and sets it itself; TTL erases them after expiry. Editing an event re-measures its stay from the moment it was *first placed* — extending "2 days" to "7 days" buys the five that were left, never a fresh seven. |
| Start times outside the event | `startAt` is sent as an *offset* from now, never a timestamp, and rejected unless it lands between 0 and the duration. The server adds it to its own clock, so a wrong device clock can't place an event outside its window — or outside the 7-day ceiling. |
| Junk documents / extra fields | The API constructs the document from scratch out of validated fields only. Anything else in the request body is dropped, including `g4` and `joins`. |
| Hidden events (`g4` spoofing) | `g4` is computed server-side from the coordinates, so it can no longer disagree with them. |

## Abuse & attack protection (read before launch)

This site is public and open-source, so assume every part of it will be poked
at. Defense layers, in order of importance:

1. **Writes are not client-side (this is the foundation).** The rules deny
   every client write; only [api/](api) can change data, using a service
   account. Everything below hangs off that. Nothing a visitor can do to their
   own browser — clearing storage, incognito, editing the JS, calling Firestore
   directly with the public config — moves a counter or creates an event.

2. **Cloudflare Turnstile on every write.** Verified server-side before
   Firestore is touched, so an unverified flood costs *us* nothing. Tokens are
   single-use and bound to their action. See the Turnstile section above.

3. **Limits keyed on a hash of the caller's network** — 6 creates/day behind a
   2-minute cooldown, 40 joins/day, and at most 8 joins per event per network.
   Tunable in one place: [api/_lib/config.js](api/_lib/config.js).

4. **Stay on the free Spark plan** — this is your billing-DoS protection.
   With no billing account attached, a read/write flood can only exhaust the
   daily free quota (site pauses until midnight PT), it can never cost you
   money. Only upgrade to Blaze once you also have budget alerts set.

5. **Firebase App Check (optional now).** With writes gone from the client,
   App Check only guards *read* volume. Setting `APPCHECK_SITE_KEY` wires up
   the client; enforcement is a separate flip in the Firebase console. Note
   that enforcing it denies reads to browsers that can't mint a reCAPTCHA
   token (ad blockers, some privacy modes) — for a public India-reach site
   that is a real cost, which is why it ships in monitor mode.

6. **Restrict your API keys**: Google Cloud console → Credentials → your
   browser key → HTTP referrer restriction `humanconnect.online/*`.
   (Firebase web keys are public by design — restriction just narrows misuse.)

7. **Kill switch**: unset `TURNSTILE_SECRET` in Vercel and redeploy — every
   write is refused within a minute while the map stays fully readable. To
   also stop reads, edit `firestore.rules` and
   `firebase deploy --only firestore:rules`.

8. **XSS**: there is no user-generated text anywhere — names are indices
   into a fixed word list, and the one numeric value rendered into HTML
   (the join count) is integer-validated on read. The deployed site also
   ships a strict Content-Security-Policy (see [vercel.json](vercel.json)).

9. **Moderation**: every event has a Report button that emails you (the
   `REPORT_EMAIL` env var). Delete a reported event directly in the Firebase
   console — clients can't.

Residual risks to know about (all bounded, none catastrophic):

- **Shared connections cut both ways.** Identity is the caller's address
  (IPv6 collapsed to its /64), and Indian mobile carriers put many unrelated
  subscribers behind one CGNAT address. So a determined person *can* still add
  up to 8 joins to one event from a phone and a laptop and some incognito
  windows — and, in the other direction, the ninth genuine person on a busy
  shared connection is turned away. Join counts remain *social proof, not
  audited numbers*; they are just no longer trivially forged. Real integrity
  would need accounts, which this site deliberately does not have.
- **Junk events by hand.** A patient human can still put up 6 events a day per
  connection. The word-list design caps the damage — the worst "spam" is a few
  harmless-sounding events that expire on their own.
- **The service-account key is now the crown jewel.** It bypasses the rules
  entirely. It lives only in Vercel's env store; if it leaks, revoke it in the
  Firebase console immediately. This is the one thing that got *more*
  dangerous by moving writes server-side, and it is the price of being able to
  enforce anything at all.
- **Function quota.** Vercel Hobby has a monthly invocation allowance. Writes
  are rare next to reads and Turnstile keeps bots from burning it, but a
  sustained attack could exhaust it — at which point writes fail and the map
  still serves, because reads never touch the API.

None of these lets an attacker post offensive text, delete others' events, run
code in a visitor's browser, or cost you money on the Spark plan.

## If you edit the word lists

Only **append** words — never reorder or remove, since existing pins store
indices into these lists and would silently change meaning. This applies to all
six lists (`VIBES`, `ACTIVITIES`, `FORMATS`, `URGENCY`, `NEEDS`,
`HELP_FORMATS`) and to the kind numbers themselves: `0` must keep meaning "a
plan", because that is what a document with no `k` field is.

That's the whole procedure now. The list lengths used to be duplicated as
constants in `firestore.rules` and had to be kept in sync by hand; validation
lives in [api/_lib/validate.js](api/_lib/validate.js), which imports
[js/words.js](js/words.js) directly, so there is nothing left to drift.

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
