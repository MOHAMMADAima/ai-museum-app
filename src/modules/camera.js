/**
 * LORE — Camera Manager
 * Requests camera permission once. Streams video into a persistent base-layer element.
 * Survives all screen navigation — never restarts.
 * Exposes show()/hide() for per-screen camera control.
 */

export const Camera = {
    _stream: null,
    _granted: false,
    _denied: false,
    _videoEl: null,
    _grainCanvas: null,
    _grainAnim: null,
    _stopGrainFn: null,

    /**
     * Called once at app boot. Camera comes up asynchronously.
     */
    async init() {
        this._videoEl     = document.getElementById('camera-bg-video');
        this._grainCanvas = document.getElementById('camera-grain-canvas');

        if (!this._videoEl) {
            console.error('[Camera] #camera-bg-video element not found in DOM.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });

            this._stream  = stream;
            this._granted = true;

            this._videoEl.srcObject = stream;
            await this._videoEl.play();

            this._showCamera();
            this._stopGrain();

        } catch (err) {
            console.warn('[Camera] Permission denied or unavailable:', err.message);
            this._denied = true;
            this._showGrain();
        }
    },

    isGranted() { return this._granted; },
    isDenied()  { return this._denied;  },

    // ── Per-screen camera control ──────────────────────────────

    /**
     * Show camera background (fade in).
     * @param {number} opacity - target wrapper opacity (default 1)
     */
    show(opacity = 1) {
        const wrapper = document.getElementById('camera-bg-wrapper');
        if (wrapper) {
            wrapper.style.transition = 'opacity 0.8s ease';
            wrapper.style.opacity    = String(opacity);
        }
        // Show grain fallback too if camera was denied
        if (this._denied && this._grainCanvas) {
            this._grainCanvas.style.transition = 'opacity 0.8s ease';
            this._grainCanvas.style.opacity    = '0.06';
        }
    },

    /**
     * Hide camera background (fade out to black).
     */
    hide() {
        const wrapper = document.getElementById('camera-bg-wrapper');
        if (wrapper) {
            wrapper.style.transition = 'opacity 0.6s ease';
            wrapper.style.opacity    = '0';
        }
        if (this._grainCanvas) {
            this._grainCanvas.style.transition = 'opacity 0.6s ease';
            this._grainCanvas.style.opacity    = '0';
        }
    },

    /**
     * Adjust the dark overlay opacity for screens that need lighter/heavier veiling.
     * @param {number} alpha - 0.0 to 1.0
     */
    setOverlayOpacity(alpha) {
        const overlay = document.getElementById('camera-dark-overlay');
        if (overlay) {
            overlay.style.transition = 'background 0.6s ease';
            overlay.style.background = `rgba(8, 8, 8, ${alpha})`;
        }
    },

    // ── Internal ───────────────────────────────────────────────

    _showCamera() {
        const wrapper = document.getElementById('camera-bg-wrapper');
        if (wrapper) {
            wrapper.style.transition = 'opacity 1.2s ease';
            wrapper.style.opacity    = '1';
        }
    },

    _showGrain() {
        const canvas = this._grainCanvas;
        if (!canvas) return;

        canvas.style.opacity = '0.06';
        const ctx = canvas.getContext('2d');
        let stopped = false;

        const draw = () => {
            if (stopped) return;
            canvas.width  = window.innerWidth;
            canvas.height = window.innerHeight;
            const imageData = ctx.createImageData(canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const v = Math.random() * 255 | 0;
                data[i] = data[i+1] = data[i+2] = v;
                data[i+3] = 30;
            }
            ctx.putImageData(imageData, 0, 0);
            this._grainAnim = requestAnimationFrame(draw);
        };

        draw();
        this._stopGrainFn = () => { stopped = true; cancelAnimationFrame(this._grainAnim); };
    },

    _stopGrain() {
        if (this._stopGrainFn) { this._stopGrainFn(); this._stopGrainFn = null; }
        if (this._grainCanvas)  this._grainCanvas.style.opacity = '0';
    },

    /** Full stop — call only on session end */
    stop() {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream  = null;
            this._granted = false;
        }
    }
};

