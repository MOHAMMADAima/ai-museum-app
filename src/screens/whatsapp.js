/**
 * LORE — WhatsApp Screen
 * Group simulation: "LORE · [Museum] · [Date]"
 * Max 4 messages per interaction (the witness is selective).
 * Silence is intentional. Realism > verbosity.
 * Claude drives witness responses with full conversation history.
 *
 * v11: back arrow returns to scan (no endVisit screen).
 *      Global × exit button mounted top-right.
 */

import { UI, Transitions } from '../modules/transitions.js';
import { State } from '../modules/state.js';
import { AI } from '../modules/ai.js';
import { Camera } from '../modules/camera.js';
import { GlobalExitButton } from '../modules/globalExitButton.js';
import { navigateTo } from '../main.js';

// Message discipline — witness speaks at most 4 times per session
const MAX_WITNESS_TURNS = 4;

export const WhatsappScreen = {
    _sendLocked: false,

    render() {
        const narrative = State.currentNarrative;
        const visitor   = State.visitorProfile;

        // Camera on, standard veil
        Camera.show();
        Camera.setOverlayOpacity(0.65);

        const artwork        = State.currentArtwork;
        const museum         = artwork?.museum || 'LORE Museum';
        const today          = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const groupName      = `LORE · ${museum} · ${today}`;
        const artworkInitial = (artwork?.title || 'A')[0].toUpperCase();

        const witnessCount = State.whatsappMessages.filter(m => m.role === 'witness').length;
        const exhausted    = witnessCount >= MAX_WITNESS_TURNS;

        const html = `
            <div class="screen active" id="whatsapp-screen" style="
                padding: 0;
                justify-content: flex-start;
                background: rgba(8,8,8,0.88);
            ">
                <!-- Header -->
                <div style="
                    width: 100%;
                    padding: 1.2rem 1.5rem;
                    background: rgba(14,14,14,0.95);
                    backdrop-filter: blur(12px);
                    display: flex;
                    align-items: center;
                    border-bottom: 1px solid rgba(201,169,110,0.15);
                    flex-shrink: 0;
                    z-index: 10;
                ">
                    <button id="back-from-chat" style="
                        background: transparent;
                        border: none;
                        color: var(--gold);
                        margin-right: 1rem;
                        cursor: pointer;
                        padding: 4px;
                        display: flex;
                        align-items: center;
                    ">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                    </button>

                    <!-- Group avatar — artwork thumbnail or initial -->
                    <div style="
                        width: 38px; height: 38px;
                        border-radius: 50%;
                        border: 1px solid rgba(201,169,110,0.4);
                        overflow: hidden;
                        flex-shrink: 0;
                        margin-right: 0.9rem;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: #1a1a1a;
                        ${artwork?.image ? `background-image: url('${artwork.image}'); background-size: cover; background-position: center;` : ''}
                    ">
                        ${!artwork?.image ? `<span style="font-family:var(--font-serif);color:var(--gold);font-size:1rem;">${artworkInitial}</span>` : ''}
                    </div>

                    <div style="flex:1;min-width:0;">
                        <p style="
                            font-family: var(--font-serif);
                            font-size: 0.95rem;
                            color: var(--gold);
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        ">${groupName}</p>
                        <p style="
                            font-family: var(--font-sans);
                            font-size: 0.65rem;
                            color: #4CAF50;
                            letter-spacing: 0.08em;
                            margin-top: 2px;
                        ">${narrative?.characterName || '—'} · reanimated</p>
                    </div>
                </div>

                <!-- Messages -->
                <div id="chat-messages" style="
                    flex: 1;
                    width: 100%;
                    padding: 1.5rem;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 0.9rem;
                    min-height: 0;
                ">
                    ${this._renderMessages()}
                </div>

                <!-- Exhausted notice -->
                <div id="silence-notice" style="
                    display: ${exhausted ? 'block' : 'none'};
                    text-align: center;
                    padding: 0.6rem 1.5rem;
                    font-family: var(--font-serif);
                    font-style: italic;
                    font-size: 0.8rem;
                    color: var(--muted-color);
                    opacity: 0.6;
                ">The witness has said all they will say.</div>

                <!-- Input -->
                <div style="
                    width: 100%;
                    padding: 1rem 1.5rem;
                    background: rgba(14,14,14,0.95);
                    border-top: 1px solid rgba(201,169,110,0.12);
                    display: flex;
                    gap: 0.8rem;
                    align-items: center;
                    flex-shrink: 0;
                ">
                    <input
                        type="text"
                        id="chat-input"
                        placeholder="${exhausted ? 'Silence is part of the ritual…' : 'Whisper something back…'}"
                        ${exhausted ? 'disabled' : ''}
                        style="
                            flex: 1;
                            background: #181818;
                            border: 1px solid rgba(201,169,110,0.15);
                            border-radius: 20px;
                            padding: 0.7rem 1.2rem;
                            color: var(--text-color);
                            outline: none;
                            font-family: var(--font-sans);
                            font-size: 0.9rem;
                            ${exhausted ? 'opacity:0.4;cursor:not-allowed;' : ''}
                        "
                    >
                    <button id="send-chat" ${exhausted ? 'disabled' : ''} style="
                        background: ${exhausted ? '#333' : 'var(--gold)'};
                        border: none;
                        width: 38px; height: 38px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: ${exhausted ? 'not-allowed' : 'pointer'};
                        flex-shrink: 0;
                        transition: background 0.3s;
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${exhausted ? '#666' : '#080808'}" stroke-width="2">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                        </svg>
                    </button>
                </div>
            </div>

            <style>
                .msg {
                    max-width: 78%;
                    padding: 0.75rem 1rem;
                    border-radius: 16px;
                    position: relative;
                    font-size: 0.9rem;
                    line-height: 1.5;
                    word-break: break-word;
                }
                .msg-witness {
                    align-self: flex-start;
                    background: rgba(22,22,22,0.9);
                    color: var(--text-color);
                    border-bottom-left-radius: 4px;
                    border: 1px solid rgba(201,169,110,0.1);
                    font-family: var(--font-serif);
                    font-style: italic;
                }
                .msg-visitor {
                    align-self: flex-end;
                    background: rgba(201,169,110,0.15);
                    color: var(--text-color);
                    border-bottom-right-radius: 4px;
                    border: 1px solid rgba(201,169,110,0.25);
                }
                .msg-time {
                    font-size: 0.58rem;
                    opacity: 0.4;
                    margin-top: 0.3rem;
                    display: block;
                    text-align: right;
                    font-family: var(--font-sans);
                    font-style: normal;
                }
                .msg-typing {
                    opacity: 0.5;
                    font-style: italic;
                    color: var(--muted-color);
                }
            </style>
        `;

        UI.render(html);
        this._sendLocked = false;

        // Mount global × exit button (top-right)
        GlobalExitButton.mount();

        const chatContainer = document.getElementById('chat-messages');
        const chatInput     = document.getElementById('chat-input');
        const sendBtn       = document.getElementById('send-chat');

        chatContainer.scrollTop = chatContainer.scrollHeight;

        const sendMessage = async () => {
            if (this._sendLocked || exhausted) return;
            const text = chatInput.value.trim();
            if (!text) return;

            const witnessNow = State.whatsappMessages.filter(m => m.role === 'witness').length;
            if (witnessNow >= MAX_WITNESS_TURNS) {
                this._updateUI();
                return;
            }

            this._sendLocked = true;
            chatInput.value  = '';

            State.addWhatsappMessage({
                role:      'visitor',
                text,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            this._updateUI();

            // Show typing indicator
            this._addTyping();

            try {
                // Build concise history for Claude (last 8 turns max)
                const history = State.whatsappMessages.slice(-8).map(m => ({
                    role:    m.role === 'witness' ? 'assistant' : 'user',
                    content: m.text
                }));

                const reply = await AI.continueWitnessChat(
                    history,
                    narrative,
                    State.visitorProfile,
                    State.currentArtwork
                );

                this._removeTyping();

                // Intentional silence: 10% chance the witness simply doesn't reply
                const turnsSoFar = State.whatsappMessages.filter(m => m.role === 'witness').length;
                if (turnsSoFar < MAX_WITNESS_TURNS && Math.random() > 0.1) {
                    State.addWhatsappMessage({
                        role:      'witness',
                        text:      reply,
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    });
                }

                this._updateUI();
            } catch (err) {
                console.error('[WhatsApp] AI reply failed:', err);
                this._removeTyping();
            } finally {
                this._sendLocked = false;
            }
        };

        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') sendMessage();
        });

        document.getElementById('back-from-chat').addEventListener('click', () => {
            // Clear artwork state — return to scan for the next discovery
            State.currentArtwork   = null;
            State.currentNarrative = null;
            Camera.show();
            Camera.setOverlayOpacity(0.65);
            Transitions.to('scan', () => navigateTo('scan'));
        });
    },

    _renderMessages() {
        if (State.whatsappMessages.length === 0) {
            return `<p style="
                text-align: center;
                font-family: var(--font-serif);
                font-style: italic;
                color: var(--muted-color);
                font-size: 0.85rem;
                opacity: 0.5;
                margin-top: 4rem;
            ">Waiting for the first word…</p>`;
        }
        return State.whatsappMessages.map(msg => `
            <div class="msg msg-${msg.role}">
                ${msg.text}
                <span class="msg-time">${msg.timestamp}</span>
            </div>
        `).join('');
    },

    _updateUI() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.innerHTML = this._renderMessages();
            container.scrollTop = container.scrollHeight;
        }
        // Update silence notice
        const witnessCount = State.whatsappMessages.filter(m => m.role === 'witness').length;
        const notice = document.getElementById('silence-notice');
        const input  = document.getElementById('chat-input');
        const btn    = document.getElementById('send-chat');
        if (witnessCount >= MAX_WITNESS_TURNS && notice) {
            notice.style.display = 'block';
            if (input) { input.disabled = true; input.style.opacity = '0.4'; }
            if (btn)   { btn.disabled = true; }
        }
    },

    _addTyping() {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.id = 'typing-indicator';
        div.className = 'msg msg-witness msg-typing';
        div.textContent = '…';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    _removeTyping() {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    }
};

