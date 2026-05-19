/**
 * LORE — Text Effects
 * Cinematic typewriter with organic, slightly irregular pacing.
 * Feels like a memory surfacing, not a machine printing.
 */

export const TextEffects = {

    /**
     * Reveal text letter-by-letter with organic pacing.
     * @param {HTMLElement} el        - target element
     * @param {string}      text      - text to reveal
     * @param {number}      baseSpeed - ms per character (default 38)
     * @param {number}      variance  - random extra ms per char (default 22)
     * @returns {Promise}             - resolves when complete
     */
    typewriter(el, text, baseSpeed = 38, variance = 22) {
        el.innerHTML = '';
        let i = 0;

        return new Promise(resolve => {
            const tick = () => {
                if (i >= text.length) { resolve(); return; }

                const char = text.charAt(i);

                // Wrap each character in a span that fades in
                const span = document.createElement('span');
                span.textContent = char;
                span.style.cssText = 'opacity:0; transition: opacity 0.12s ease; display: inline;';
                if (char === '\n') { el.appendChild(document.createElement('br')); i++; tick(); return; }
                el.appendChild(span);
                // Micro-delay so the fade-in triggers after paint
                requestAnimationFrame(() => { span.style.opacity = '1'; });

                i++;

                // Organic timing: longer pause after punctuation, random jitter otherwise
                let delay = baseSpeed + Math.random() * variance;
                if (char === '.' || char === ',' || char === '—') delay += 120;
                else if (char === ' ') delay -= 10;

                setTimeout(tick, delay);
            };
            tick();
        });
    },

    /**
     * Fade a single element in over `duration` ms.
     */
    fadeIn(el, duration = 600, delay = 0) {
        el.style.opacity = '0';
        el.style.transition = `opacity ${duration}ms ease ${delay}ms`;
        requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
        return new Promise(resolve => setTimeout(resolve, delay + duration));
    },

    /**
     * Fade a single element out over `duration` ms.
     */
    fadeOut(el, duration = 400) {
        el.style.transition = `opacity ${duration}ms ease`;
        el.style.opacity = '0';
        return new Promise(resolve => setTimeout(resolve, duration));
    },

    /** Utility: sleep for ms */
    wait(ms) { return new Promise(r => setTimeout(r, ms)); }
};
