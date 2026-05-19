# LORE OCR Audit Report

**Audited:** 2026-05-16  
**Scope:** `ocrEngine.js`, `scanEngine.js`, `scan.js`, `camera.js`, `flowController.js`, `ai.js`, `package.json`, `.skills/ocr-space`  
**OCR Provider:** OCR.space (via Appmedo gateway)

---

## Executive Summary

The OCR implementation works for the happy path but has **2 critical security/cost issues**, **4 high-severity reliability/UX bugs**, and several medium-severity quality gaps. The most dangerous problem is that the `user_managed` API key is **exposed in the client-side JavaScript bundle**, violating the OCR.space skill's security contract and making the key trivial to extract by any visitor.

---

## Critical Issues

### 1. API Key Exposed in Client-Side Bundle

**Location:** `src/modules/ocrEngine.js:26`

```js
const OCR_AUTH = 'K87649693488957';
```

**Severity:** 🔴 Critical  
**Impact:** Any visitor can open DevTools → Sources → find the hardcoded key → make unlimited calls on your account.

The OCR.space skill specification explicitly states:

> "The raw API Key is never exposed to the browser."  
> "The frontend sends the image source to the Edge Function. The Edge Function reads the API key from the Deno environment variable `INTEGRATIONS_API_KEY`."

**Fix:** Create a Supabase Edge Function (`ocr-parse-image`) that proxies the request. The frontend sends the base64 image to the Edge Function; the Edge Function injects `INTEGRATIONS_API_KEY` server-side. This is the documented pattern in `.skills/ocr-space/references/parse-image-api.md`.

---

### 2. Using Billed POST Endpoint Instead of Free GET Endpoint

**Location:** `src/modules/ocrEngine.js:25, 270`

The code uses `POST /parse/image` with `base64Image`. The skill documentation states:

> "Prefer the **GET /parse/imageurl** endpoint (free) for simple URL-based image recognition. Use the **POST /parse/image** endpoint only when you need file upload, Base64 input..."

**Severity:** 🔴 Critical (cost/efficiency)  
**Impact:** Every scan incurs a billed POST call. With the free GET endpoint, you could upload the snapshot to a temporary Supabase Storage bucket and pass the public URL to OCR.space.

**Fix:** Two options:
1. **Quick:** Keep POST but proxy through Edge Function (fixes both security and keeps architecture simple).
2. **Better:** Upload the captured frame to a temporary Supabase Storage bucket, get a public URL, then call the free `GET /parse/imageurl` endpoint via Edge Function.

---

### 3. No Request Timeout on OCR API Call

**Location:** `src/modules/ocrEngine.js:270-274`

```js
const response = await fetch(OCR_ENDPOINT, { ... });
```

**Severity:** 🟡 High  
**Impact:** On a slow or flaky network, `fetch()` hangs indefinitely. The scan button stays disabled, the spinner spins forever, and the user has no escape hatch.

**Fix:** Wrap the fetch in an `AbortController` with a timeout (e.g., 15 seconds):

```js
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);
try {
    const response = await fetch(OCR_ENDPOINT, { ..., signal: controller.signal });
    clearTimeout(timeoutId);
    // ...
} catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') return { success: false, error: 'timeout' };
    // ...
}
```

---

## High-Severity Issues

### 4. Image Resolution Too Low for Museum Label Text

**Location:** `src/modules/scanEngine.js:41-44`

```js
const { canvas, ctx } = _getCanvas(320, 240);
ctx.drawImage(videoEl, 0, 0, 320, 240);
const snapshot = canvas.toDataURL('image/jpeg', 0.75);
```

**Severity:** 🟡 High  
**Impact:** Museum labels have small text (often 8–12pt at reading distance). Downsampling to 320×240 JPEG at 0.75 quality destroys fine detail. OCR.space engine 2 is specifically designed for photos, but it still needs enough pixels to resolve letter shapes.

**Fix:** Increase capture resolution to at least **640×480** (or better, the camera's native resolution scaled proportionally). JPEG quality should be **0.85–0.90** for text.

```js
const { canvas, ctx } = _getCanvas(640, 480);
ctx.drawImage(videoEl, 0, 0, 640, 480);
const snapshot = canvas.toDataURL('image/jpeg', 0.9);
```

---

### 5. No Retry Logic for Transient Failures

**Severity:** 🟡 High  
**Impact:** A single network hiccup or OCR.space 502 immediately forces the user into manual input. A museum visitor in a building with spotty Wi-Fi will hit this constantly.

**Fix:** Add 1 automatic retry with exponential backoff in `OcrEngine.scanLabel()`:

```js
async function _scanWithRetry(base64Snapshot, retries = 1) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const result = await _scanOnce(base64Snapshot);
        if (result.success || !result.error?.includes('HTTP')) return result;
        if (attempt < retries) await delay(1000 * (attempt + 1));
    }
    return result;
}
```

---

### 6. XSS Vulnerability in Fallback Modal Prefill

**Location:** `src/screens/scan.js:589`

```js
function _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

**Severity:** 🟡 High  
**Impact:** `_escAttr` only escapes quotes. It does **not** escape `<`, `>`, `&`, or backticks. If OCR returns text like `<img src=x onerror=alert(1)>`, it will be injected into the DOM as live HTML inside:

```html
value="<img src=x onerror=alert(1)>"
```

While the source is the user's own camera, a maliciously crafted label (or OCR hallucination) could execute JavaScript.

**Fix:** Use a proper HTML escape:

```js
function _escAttr(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

Or better: set input values via DOM API (`fieldTitle.value = prefillTitle`) instead of interpolating into HTML strings.

---

### 7. No Handling for `OCRExitCode === 2` (Partial Success)

**Location:** `src/modules/ocrEngine.js:293-295`

```js
if (data.OCRExitCode === 3 || data.OCRExitCode === 4) {
    throw new Error(`OCR exit code: ${data.OCRExitCode}`);
}
```

**Severity:** 🟡 High  
**Impact:** `OCRExitCode === 2` means "partially parsed" — some text was recognized but the engine couldn't fully process the image. Currently this passes through as `success: true`, which may produce garbled metadata with low confidence. The code should treat exit code 2 as a soft failure (same as low confidence → fallback).

**Fix:**

```js
if (data.OCRExitCode === 2) {
    console.warn('[OCR] Partial parse (exit code 2) — treating as low confidence.');
    // Still extract whatever text we got, but force highConfidence = false
}
if (data.OCRExitCode === 3 || data.OCRExitCode === 4) {
    throw new Error(`OCR exit code: ${data.OCRExitCode}`);
}
```

---

## Medium-Severity Issues

### 8. Confidence Scoring Is Naïve

**Location:** `src/modules/ocrEngine.js:225-232`

```js
function _score(result) {
    let filled = 0;
    if (result.title)  filled++;
    if (result.artist) filled++;
    if (result.year)   filled++;
    result.confidence = filled / 3;
    return result;
}
```

**Severity:** 🟢 Medium  
**Impact:** The confidence is literally "how many of 3 fields are non-empty." A 2-character garbage title counts the same as a fully valid one. This leads to false positives where OCR hallucinates a short word and passes the threshold.

**Fix:** Add plausibility checks:
- Title should be at least 3 characters and not look like an accession number.
- Artist should contain at least one space (full name) or match known patterns.
- Year should be a plausible date (1000–2099).

---

### 9. Heuristics Are English-Centric

**Location:** `src/modules/ocrEngine.js:61-157`

**Severity:** 🟢 Medium  
**Impact:** `extractArtworkMetadata()` assumes English-language museum labels with Western naming conventions. It looks for:
- English dash patterns (`Title — Artist — Year`)
- English comma patterns
- English title-case rules (`words.every(w => /^[A-Z...]/)`)
- English era phrases (`century`, `circa`, `ca.`)

Museums in non-English-speaking countries will produce poor results. The `language: 'eng'` parameter to OCR.space also prevents accurate recognition of labels in other languages.

**Fix:** At minimum, expose a language parameter. Ideally, use OCR.space's auto-language detection (`OCREngine: 2` already does this to some extent, but `language` is still pinned to `eng`).

---

### 10. No Auto-Capture or Focus Assist UX

**Severity:** 🟢 Medium  
**Impact:** The user must manually click a button while holding the phone steady. There's no:
- Real-time focus indicator
- Auto-capture when text is detected
- Preview of what the OCR "sees"
- Guidance when the label is too dark/blurry

Museum visitors often struggle to hold the phone steady and tap a button simultaneously.

**Fix (future):** Add a real-time focus quality indicator (variance of edge detection on the video frame) and optionally auto-trigger capture when stability + contrast thresholds are met.

---

### 11. Grain Animation Wastes CPU When Camera Denied

**Location:** `src/modules/camera.js:110-134`

**Severity:** 🟢 Medium  
**Impact:** When camera permission is denied, a full-screen `requestAnimationFrame` loop draws random noise pixels continuously. On mobile this drains battery.

**Fix:** Replace with a static CSS noise texture or a very low-frequency update (e.g., every 500ms, not every frame).

---

## Low-Severity / Polish Issues

### 12. Misleading Comment on Confidence Threshold

**Location:** `src/modules/ocrEngine.js:27`

```js
const CONFIDENCE_THRESHOLD = 0.45;   // at least title OR artist must be extracted
```

This comment is wrong. With `_score()` using `filled / 3`:
- 1 field = 0.33 → **fails** threshold
- 2 fields = 0.67 → passes threshold

So you need **2 out of 3 fields**, not "title OR artist." The comment should read: "at least two of three fields must be extracted."

---

### 13. No Debounce on Autocomplete Input

**Location:** `src/screens/scan.js:438-441`

```js
fieldTitle.addEventListener('input', () => {
    _acSelected = null;
    showAC(fieldTitle.value.trim());
});
```

Every keystroke re-runs the filter + DOM update. With 4+ suggestions this is negligible, but with a larger DB it would jank.

**Fix:** Debounce with 150ms.

---

### 14. No Cancellation If User Navigates Away During OCR

**Severity:** 🟢 Low  
**Impact:** If the user hits the global exit button while OCR is in-flight, the `fetch()` continues. When it eventually returns, the code tries to call `FlowController.startResurrectionFlow()` on a screen that may no longer exist.

**Fix:** Tie the `AbortController` to the screen lifecycle — abort when the screen unmounts or when `GlobalExitButton` is clicked.

---

## What Was Fixed in v32

The v32 fix addressed the **scan flow dead-end** by:
1. Replacing `{ once: true }` on `btnScan` with a persistent listener + `_scanInProgress` guard.
2. Adding a `Camera.isDenied()` fast-path that immediately shows the fallback modal.
3. Adding required `[SCAN]` debug logs.

These were **UX/state bugs**, not OCR engine bugs. The OCR engine itself was untouched.

---

## Recommended Priority Order

| Priority | Issue | Effort | File |
|----------|-------|--------|------|
| P0 | **API key exposure** — move to Edge Function | Medium | `ocrEngine.js` + new Edge Function |
| P0 | **Image resolution** — increase to 640×480 @ 0.9 | Low | `scanEngine.js` |
| P1 | **Add fetch timeout** — `AbortController` 15s | Low | `ocrEngine.js` |
| P1 | **XSS fix** — proper HTML escape or DOM API | Low | `scan.js` |
| P1 | **Handle exit code 2** — partial success fallback | Low | `ocrEngine.js` |
| P2 | **Add retry logic** — 1 retry for HTTP errors | Low | `ocrEngine.js` |
| P2 | **Fix confidence scoring** — plausibility checks | Medium | `ocrEngine.js` |
| P2 | **Fix confidence comment** | Trivial | `ocrEngine.js` |
| P3 | **Grain animation CPU** — static noise | Low | `camera.js` |
| P3 | **Autocomplete debounce** | Trivial | `scan.js` |
| P3 | **Auto-capture / focus UX** | High | `scan.js`, `scanEngine.js` |

---

## Verdict

**The OCR implementation is functional but not production-hardened.**

- ✅ **Fallback is robust** — every failure path correctly shows manual input (fixed in v32).
- ✅ **Metadata extraction heuristics are reasonable** for English labels.
- ✅ **No dead-end states** — user can always proceed.
- ❌ **Security: API key is exposed** — this is the single biggest blocker.
- ❌ **Reliability: no timeout, no retry, low-res image** — will frustrate users on poor networks.
- ❌ **Quality: naïve confidence, fragile heuristics** — false positives and missed non-English labels.
