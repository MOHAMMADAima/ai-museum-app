/**
 * LORE — Scan Engine (v9)
 *
 * Responsibilities:
 *   1. Capture the current camera video frame to a hidden canvas (unchanged).
 *   2. Expose capture() for use by the resurrection flow.
 *
 * NOTE: identifyArtwork() and buildVisualContext() from v8 have been
 * removed in v9. Artwork identification is now handled entirely by Claude
 * using the camera image + user-supplied metadata (via AI.buildPrompt).
 * The ScanEngine is now a pure frame-capture utility.
 */

// Canvas is created once and reused (avoids GC pressure on repeated captures)
let _canvas = null;
let _ctx2d  = null;

function _getCanvas(w = 640, h = 480) {
    if (!_canvas) {
        _canvas = document.createElement('canvas');
        _ctx2d  = _canvas.getContext('2d');
    }
    // Resize canvas whenever capture dimensions change
    if (_canvas.width !== w || _canvas.height !== h) {
        _canvas.width  = w;
        _canvas.height = h;
    }
    return { canvas: _canvas, ctx: _ctx2d };
}

export const ScanEngine = {

    /**
     * Capture the current video frame from the persistent camera background.
     *
     * @returns {{ snapshot: string|null, hasFrame: boolean, timestamp: number }}
     *   snapshot — base64 JPEG data URL (quality 0.75) or null if camera not ready.
     */
    capture() {
        const videoEl = document.getElementById('camera-bg-video');
        const ts      = Date.now();

        if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
            // Use native camera resolution if available (better OCR accuracy),
            // with a minimum of 640×480. Maintain aspect ratio.
            const nativeW = videoEl.videoWidth;
            const nativeH = videoEl.videoHeight;
            const scale   = Math.max(1, Math.min(nativeW / 640, nativeH / 480));
            const capW    = Math.round(nativeW / scale);
            const capH    = Math.round(nativeH / scale);

            const { canvas, ctx } = _getCanvas(capW, capH);
            try {
                ctx.drawImage(videoEl, 0, 0, capW, capH);
                // Quality 0.9 — high enough to preserve fine museum-label text
                const snapshot = canvas.toDataURL('image/jpeg', 0.9);
                console.log(`[OCR] capture started — ${capW}×${capH} @ ${(snapshot.length / 1024).toFixed(1)} KB`);
                return { snapshot, hasFrame: true, timestamp: ts };
            } catch (e) {
                console.warn('[ScanEngine] Frame capture failed (cross-origin?):', e.message);
            }
        }

        console.warn('[ScanEngine] Camera not ready — no frame captured.');
        return { snapshot: null, hasFrame: false, timestamp: ts };
    },
};
