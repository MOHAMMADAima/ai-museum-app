/**
 * LORE — Edge Function: ocr-parse-image
 *
 * Proxies a base64 image to OCR.space POST /parse/image.
 * The INTEGRATIONS_API_KEY is injected server-side — it is
 * never sent to or stored on the client.
 *
 * Request (POST JSON):
 *   { base64Image: string, language?: string }
 *
 * Response (200 JSON — same shape as OCR.space response):
 *   { ParsedResults, OCRExitCode, IsErroredOnProcessing, ProcessingTimeInMilliseconds }
 */

const OCR_ENDPOINT = 'https://app-boqgimo36ayp-api-W9z3M6eONl3L.gateway.appmedo.com/parse/image';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method Not Allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // ── Parse client request ────────────────────────────────────────────
  let base64Image: string;
  let language: string;

  try {
    const body = await req.json();
    base64Image = body.base64Image;
    language    = body.language ?? 'eng';

    if (!base64Image) throw new Error('Missing base64Image');
    // Ensure the data-URI prefix is present (OCR.space requires it)
    if (!base64Image.startsWith('data:')) {
      base64Image = 'data:image/jpeg;base64,' + base64Image;
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Invalid request body: ${(e as Error).message}` }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // ── Inject platform-managed API key ────────────────────────────────
  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    console.error('[ocr-parse-image] INTEGRATIONS_API_KEY not set');
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // ── Build multipart/form-data for OCR.space ─────────────────────────
  const form = new FormData();
  form.append('base64Image',       base64Image);
  form.append('language',          language);
  form.append('OCREngine',         '2');      // engine 2: better accuracy on photos
  form.append('detectOrientation', 'true');
  form.append('scale',             'true');   // improve accuracy on small text

  // ── Call upstream ───────────────────────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(OCR_ENDPOINT, {
      method:  'POST',
      headers: { 'X-Gateway-Authorization': apiKey },
      body:    form,
    });
  } catch (fetchErr) {
    console.error('[ocr-parse-image] Network error calling OCR.space:', (fetchErr as Error).message);
    return new Response(
      JSON.stringify({ error: 'upstream_network_error', message: (fetchErr as Error).message }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // Forward quota / billing errors verbatim
  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    console.warn(`[ocr-parse-image] Quota/billing error ${upstream.status}:`, errText);
    return new Response(errText, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error(`[ocr-parse-image] Upstream HTTP ${upstream.status}:`, errText);
    return new Response(
      JSON.stringify({ error: `upstream_http_${upstream.status}`, message: errText }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  const data = await upstream.json();
  console.log('[ocr-parse-image] OCR.space response — ExitCode:', data.OCRExitCode,
              '| Errored:', data.IsErroredOnProcessing);

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
