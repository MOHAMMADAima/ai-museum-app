export const Transitions = {
    overlay: null,
    
    init() {
        this.overlay = document.getElementById('transition-overlay');
    },
    
    async to(targetScreenId, callback) {
        if (!this.overlay) this.init();
        
        // Start transition
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('active');
        
        await new Promise(resolve => setTimeout(resolve, 800));
        
        if (callback) callback();
        
        // Hide overlay
        this.overlay.classList.remove('active');
        setTimeout(() => {
            this.overlay.classList.add('hidden');
        }, 800);
    }
};

export const UI = {
    render(html) {
        const container = document.getElementById('main-container');
        container.innerHTML = html;
        
        // Trigger enter animation
        const screen = container.querySelector('.screen');
        if (screen) {
            setTimeout(() => screen.classList.add('active'), 50);
        }
    },
    
    typewriter(element, text, speed = 50) {
        element.innerHTML = '';
        let i = 0;
        return new Promise(resolve => {
            function type() {
                if (i < text.length) {
                    element.innerHTML += text.charAt(i);
                    i++;
                    setTimeout(type, speed);
                } else {
                    resolve();
                }
            }
            type();
        });
    }
};
