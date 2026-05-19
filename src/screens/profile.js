import { UI, Transitions } from '../modules/transitions.js';
import { State } from '../modules/state.js';
import { navigateTo } from '../main.js';

export const ProfileScreen = {
    render() {
        const html = `
            <div class="screen" id="profile-screen">
                <h2 class="serif italic" style="font-size: 2.5rem; margin-bottom: 3rem;">Who are you in this history?</h2>
                
                <div style="width: 100%; max-width: 300px;">
                    <div style="margin-bottom: 4rem;">
                        <label class="serif" style="display: block; margin-bottom: 0.5rem; color: var(--gold);">NAME</label>
                        <input type="text" id="visitor-name" placeholder="Enter your name..." 
                            style="width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--muted-color); color: var(--text-color); font-family: var(--font-serif); font-size: 1.5rem; outline: none; padding: 0.5rem 0;">
                    </div>
                    
                    <button class="btn-gold" id="continue-to-scan" style="width: 100%; opacity: 0.5; pointer-events: none;">Continue</button>
                </div>
            </div>
        `;
        UI.render(html);
        
        const nameInput   = document.getElementById('visitor-name');
        const continueBtn = document.getElementById('continue-to-scan');
        
        const validate = () => {
            if (nameInput.value.trim()) {
                continueBtn.style.opacity      = '1';
                continueBtn.style.pointerEvents = 'all';
            } else {
                continueBtn.style.opacity      = '0.5';
                continueBtn.style.pointerEvents = 'none';
            }
        };
        
        nameInput.addEventListener('input', validate);
        
        continueBtn.addEventListener('click', () => {
            State.updateProfile({ name: nameInput.value, gender: '' });
            Transitions.to('scan', () => navigateTo('scan'));
        });
    }
};
