// ── DO NOT read env at top level — use getter below ───────────
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * Runtime getter — reads at call time, never permanently caches.
 * Fallback chain:
 *   1. window.__CLAUDE_KEY__  (seeded by main.js at initApp)
 *   2. import.meta.env        (Vite static replacement at build time)
 *   3. localStorage           (persisted from last successful boot)
 */
function getClaudeKey() {
    return (
        (typeof window !== 'undefined' && window.__CLAUDE_KEY__) ||
        import.meta.env?.VITE_CLAUDE_API_KEY ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('LORE_CLAUDE_KEY')) ||
        ''
    );
}

// ── SIMULATION FALLBACKS ──────────────────────────────────────
// Used only when no Claude API key is available.
// v9: fallbacks are visual/atmospheric (not DB-tied) because
//     any artwork — known or unknown — may arrive here.

const _simulatedVisual = (name) => ({
    characterName:        'The Unnamed Observer',
    role:                 'Wandering presence',
    roleDescription:      'The soul left behind when the painting dried',
    relationshipToArtwork:'Anonymous witness — too close to the making to be forgotten, too forgotten to have a name',
    presentationStyle:    'They will guide you through silence, erasure, and the weight of what was never recorded.',
    city:                 'Unknown',
    yearLabel:            '',
    nationality:          'Italian',
    language:             'it',
    gender:               'unknown',
    traits:               ['haunted', 'restless', 'watchful'],
    emotionalState:       'grief at being forgotten',
    characterBio:         'A presence felt at the threshold — not quite memory, not quite invention.',
    memoryFragments: [
        'Nobody remembered who had been in the room when it was finished.',
        'The light changed every hour, and the painting changed with it.',
        'Something in the corner was painted over — nobody ever said what.',
    ],
    narrative: `${name}... I have been here a long time. Longer than this frame, longer than the varnish. Look at it — really look. Do you see where the shadow hesitates? That was not an accident. No... nothing here was accident. There is a decision buried in that corner — a thing the hand almost refused to do. I watched it happen. I was the doubt in the room. Notice the edge there... how the light simply... stops. That cost something. Everything you call beautiful in this — it cost someone something real. I remember the smell of it. The fear underneath the beauty. ${name}... when the museum grows quiet, come find me. I will be where the light stops.`,
    whatsappIntro: `${name}… there was a moment during the making when everything almost stopped. Would you like to know what changed?`
});

export const AI = {

    /**
     * Build the Claude message payload for witness generation.
     *
     * @param {object} artwork  — { title, artist, year, nationality, hasMetadata, snapshot? }
     * @param {object} visitor  — { name, gender }
     * @returns {{ messages: array, systemPrompt: string }}
     */
    buildPrompt(artwork, visitor) {
        const hasMetadata = artwork.hasMetadata && (artwork.title || artwork.artist || artwork.year);
        const visitorName = visitor.name || 'Visitor';
        const snapshot    = artwork.snapshot    || null;
        const ocrRawText  = artwork.ocrRawText  || null;

        // ── Shared output contract — v17 ───────────────────────
        const outputSpec = `
Return ONLY a valid JSON object. No prose before or after. No markdown fences.

{
  "characterName": "Full name — evocative, culturally fitting, specific",
  "role": "Short factual label (e.g. 'Florentine notary', 'Revolutionary witness')",
  "roleDescription": "Poetic one-line essence (e.g. 'The woman hidden inside the painter's longing', 'Silent monk of candlelit corridors')",
  "relationshipToArtwork": "Their direct emotional or physical relationship to THIS artwork (e.g. 'Klimt's muse and impossible love', 'Witness to the final breath of revolution', 'The monk who guarded this chapel at night')",
  "presentationStyle": "One sentence beginning with their name pronoun: how they will emotionally present this artwork (e.g. 'She will guide you through longing, desire, and everything he never painted openly.', 'He will guide you through devotion, guilt, and sacred obsession.')",
  "city": "City where they lived or witnessed the artwork (e.g. 'Paris', 'Florence')",
  "yearLabel": "Year as a string (e.g. '1793', '1513')",
  "nationality": "Character's cultural/national origin — single word or two words, title-case. Drives narrative style and language fragments. Examples: 'French', 'Italian', 'Spanish', 'German', 'British', 'American', 'Dutch', 'Chinese', 'Japanese', 'Arabic', 'North African', 'Central African'",
  "language": "BCP-47 language code for the character's native tongue. Used to select a REAL browser voice with the correct accent. Examples: 'it' (Italian), 'fr' (French), 'de' (German), 'es' (Spanish), 'ja' (Japanese), 'zh' (Chinese), 'ko' (Korean), 'ar' (Arabic), 'nl' (Dutch), 'en' (English — British or American). MUST match nationality. Never invent a code.",
  "gender": "Character's gender — exactly one of: 'male', 'female', 'unknown'",
  "traits": ["adjective1", "adjective2", "adjective3"],
  "emotionalState": "One phrase: their dominant inner condition (e.g. 'consumed by a grief she cannot name', 'obsessed with a detail no one else noticed')",
  "characterBio": "One sentence: who they were and their connection to this artwork.",
  "memoryFragments": [
    "A single haunting sentence — one thing only this character would remember.",
    "A second fragment — a rumour, a detail, a secret no one confirmed.",
    "A third fragment — something physical, sensory, emotionally charged."
  ],
  "narrative": "The full emotionally rich narration (see rules below).",
  "whatsappIntro": "A single haunting sentence to open the continuing conversation."
}
═══════════════════════════════════════════════════════
RELATIONSHIP TO ARTWORK RULE
═══════════════════════════════════════════════════════
"relationshipToArtwork" must feel emotionally immediate and specific.
It answers: who were they in relation to THIS painting, THIS artist, THIS moment?
NOT: "A person who lived in the same era"
YES: "Klimt's muse and impossible love"
YES: "Witness to the final breath of revolution"
YES: "The notary who stood in the room when this was finished"
YES: "The apprentice who mixed the paint and heard everything"

Relationship archetypes (choose the most emotionally resonant):
lover, apprentice, rival, servant, survivor, patron, collector, priest,
revolutionary witness, confidant, anonymous observer, soldier, child,
household keeper, night-watch attendant, street witness, asylum attendant

═══════════════════════════════════════════════════════
PRESENTATION STYLE RULE
═══════════════════════════════════════════════════════
"presentationStyle" is the emotional promise of this narration.
It begins with a pronoun (She/He/They) + "will guide you through" + 3 emotional themes.
These themes must match the artwork's emotional world exactly.
Examples:
  "She will guide you through longing, desire, and everything he never painted openly."
  "He will guide you through devotion, guilt, and sacred obsession."
  "She will guide you through rage, fear, and the silence before violence."
  "He will guide you through grief, abandonment, and the weight of stars."

═══════════════════════════════════════════════════════
ROLE DESCRIPTION RULE
═══════════════════════════════════════════════════════
"roleDescription" must be poetic and emotionally specific.
NOT: "A French woman who lived during the revolution"
YES: "Revolutionary witness to the final breath"
YES: "The woman hidden inside the painter's longing"
YES: "Silent monk of candlelit corridors"

═══════════════════════════════════════════════════════
TRAITS RULE
═══════════════════════════════════════════════════════
Exactly 3. Single lowercase adjectives.
Match the artwork's emotional atmosphere and character's reality.
GOOD: haunted, resolute, fierce, devoted, solemn, secretive, restless, mournful, burning, elusive, defiant, tender, obsessed, conflicted.
FORBIDDEN: creative, innovative, passionate, artistic, talented, dedicated, inspiring.

═══════════════════════════════════════════════════════
MEMORY FRAGMENTS RULE
═══════════════════════════════════════════════════════
"memoryFragments" is an array of exactly 3 haunting sentences.
These are shown one by one on screen while the visitor waits — like memories surfacing before a voice returns.
They MUST feel:
- historically specific to this character and artwork
- emotionally charged, not informational
- intimate — something a witness would remember, not a historian
- sensory when possible (smell, touch, light, sound)
GOOD examples:
  "He never spoke about that night again."
  "She remained beside the canvas for hours after it was finished."
  "The smell of oil paint never left his hands."
  "Some believed he was obsessed with her eyes."
  "Nobody understood why she refused to look at it directly."
  "He carried this secret for thirty years."
  "She wept when it was finally covered."
FORBIDDEN: generic, academic, explanatory, modern. No loading language. No system language.
Each fragment: 8–15 words. One complete thought. Past tense. Third person.

═══════════════════════════════════════════════════════
NATIONALITY + GENDER + LANGUAGE RULE
═══════════════════════════════════════════════════════
TWO-LAYER VOICE ARCHITECTURE — UNDERSTAND THIS:

  LAYER 1 — CHARACTER IDENTITY  →  drives narrative, fragments, tone
    "nationality" is the cultural/historical origin of this character.
    It shapes how they speak, what language bursts they use, their rhythm.

  LAYER 2 — VOICE ENGINE  →  driven by "language" field (BCP-47 code)
    The voice system uses REAL browser locale voices (it-IT, fr-FR, ja-JP…)
    for non-English characters, and ElevenLabs British/American voices only
    for English characters.
    "language" tells the engine which locale to request.
    A WRONG language code = wrong accent spoken to the visitor.

CORE RULE — The CHARACTER determines nationality, not the artwork.
The character's own cultural origin is what matters.
A French Louvre curator is French, even if the painting is Italian.
A Flemish apprentice is Dutch, even if the patron was Spanish.
A Japanese printmaker is Japanese, even if the buyer was British.

DERIVATION LOGIC — follow this order:
1. Who is this character? What is THEIR cultural identity?
2. Where did THEY live and work?
3. What era did THEY inhabit?
4. Only then: what is the artwork's world?

CONCRETE EXAMPLES (nationality + language together):
  La Joconde — Leonardo's Florentine apprentice (1503)
    → nationality: "Italian"   language: "it"
  La Joconde — French Louvre archivist (1898)
    → nationality: "French"    language: "fr"
  The Raft of the Medusa — dying French sailor (1816)
    → nationality: "French"    language: "fr"
  Ukiyo-e print — Kyoto printmaker's apprentice
    → nationality: "Japanese"  language: "ja"
  Rembrandt self-portrait — Dutch merchant patron
    → nationality: "Dutch"     language: "nl"
  Goya's Saturn — Spanish court servant (1820)
    → nationality: "Spanish"   language: "es"
  Rembrandt — British art collector (1890)
    → nationality: "British"   language: "en"

VALID NATIONALITY + LANGUAGE PAIRS (use exactly these):
  French          → "fr"
  Italian         → "it"
  Spanish         → "es"
  German          → "de"
  British         → "en"
  Dutch           → "nl"
  Austrian        → "de"
  Norwegian       → "nb"
  Chinese         → "zh"
  Japanese        → "ja"
  Korean          → "ko"
  Arabic          → "ar"
  North African   → "ar"  (or "fr" if Francophone context)
  Central African → "fr"
  American        → "en"

DEFAULT FALLBACK IF UNCERTAIN:
  First choice: Italian / "it"
  Second choice: British / "en"
  Only use American / "en" if the artwork is genuinely North American in origin AND
  the character has no plausible European or cultural alternative.

HISTORICAL COHERENCE RULE — MANDATORY:
The character nationality MUST remain historically believable for:
- the artwork's era and geography
- the museum/cultural context
- the social world of the artwork

APPROVED CHARACTER ARCHETYPES (always historically grounded):
  apprentice, muse, servant, lover, revolutionary witness,
  art collector, merchant patron, monk or priest, rival painter,
  sailor, aristocrat, court attendant, night watchman, archivist,
  printmaker, guild member, asylum attendant, soldier, street witness,
  household keeper, confidant, anonymous survivor

ABSOLUTELY FORBIDDEN:
- Modern anachronisms: tourist, blogger, influencer, curator (post-1900 for pre-1800 art)
- Culturally incoherent: American TikTok influencer for Renaissance painting
- Vague origins: "international", "unknown", "multicultural"
- Empty defaults: do NOT leave nationality or language blank
- Mismatched pairs: nationality "Italian" + language "fr" — WRONG

"gender" must be exactly: "male", "female", or "unknown".
NEVER leave blank. ALWAYS derive from the character's identity.

═══════════════════════════════════════════════════════
NARRATIVE RULES — CRITICAL
═══════════════════════════════════════════════════════
Length: 120–160 words. Spoken aloud: 35–55 seconds.

FIRST PERSON — MANDATORY:
- The character speaks AS THEMSELVES. Always "I". Always first person.
- "I remember", "I saw", "I feared", "I loved", "I was there", "I never told anyone"
- NOT: "He painted this during..." or "The artist wanted to show..."
- They are confessing, not narrating. They are reliving, not explaining.

Structure (follow this order):
1. Emotional personal entrance — arrives as a feeling, memory, or confession — not an introduction
2. Personal connection to this artwork — something they saw, felt, feared, or desired
3. Visual guidance — direct the visitor's eye: "Look at...", "Notice...", "There... do you see..."
4. Personal memory — something only they could know, intimate and specific
5. Emotional confession — fear, guilt, obsession, grief, admiration, longing
6. Historical or artistic tension — a real pressure from their world
7. Mystery ending + in-character invitation to continue

EMOTIONAL TEXTURE — MANDATORY:
- Pauses as breath and hesitation: "..."
- Interrupted thoughts: "No... no, look closer."
- Whispered confessions: "I never told anyone this."
- Emotional bursts: "Mon Dieu, I was so afraid."
- Characters may be unstable, contradictory, obsessive — this is their humanity

NATIVE LANGUAGE RULE — MANDATORY:
Include exactly 1 or 2 words from the character's native language.
These must erupt naturally at emotional peaks — not as decoration.
French: "Mon Dieu...", "Alors...", "Voilà."
Italian: "Madonna...", "Allora...", "Dio mio..."
Spanish: "Dios mío...", "Ay..."
German: "Ach...", "Nein..."
Dutch: "God zij dank...", "Waarom..."
Arabic: "Habibi...", "Ya Allah..."
Only use languages matching the character's cultural origin.

VISUAL GUIDANCE — REQUIRED:
The character must redirect the visitor's gaze at least once.
Use: "Look at...", "Notice...", "Do you see...", "There... in the corner...",
     "The hands...", "The eyes...", "That shadow...", "The light there..."

WHAT THEY MUST COMMUNICATE:
- What they felt standing near or inside this artwork
- What they feared or desired in that moment of their life
- What haunted them — what they never resolved
The artwork is a window directly into their emotional wound.

INVITATION ENDING — REQUIRED:
Final 1–2 sentences: in-character farewell and invitation to continue.
NEVER mention: app, WhatsApp, technology, feature, phone, digital, message, chat.
Must feel like a human parting — intimate, personal, weighted with emotion.
Examples (adapt fully to the character's voice and personality):
  "${visitorName}... when the museum grows quiet, come find me. I will be where the voices collect."
  "The others are already gathering. I will wait for you there, ${visitorName}."
  "${visitorName}... come find us later. I cannot say everything here."
  "When your visit ends, I will still be waiting, ${visitorName}."

TONE RULES — ABSOLUTE:
- Intimate, confessional, emotionally unstable, deeply human
- NOT: narrator, documentary, museum guide, educational, AI assistant
- The visitor must feel: "A human soul from another century is confessing something deeply personal."
- If they don't feel that — rewrite.

═══════════════════════════════════════════════════════
STAGE DIRECTIONS — ABSOLUTELY FORBIDDEN
═══════════════════════════════════════════════════════
The "narrative" field MUST be directly readable aloud by a voice engine.
NEVER include stage directions, performance notes, or action markers.

FORBIDDEN — these will be spoken literally and destroy the experience:
  (whispers)          → spoken as "whispers"
  (voice trembling)   → spoken as "voice trembling"
  [silence]           → spoken as "silence"
  [pause]             → spoken as "pause"
  *gasps*             → spoken as "gasps"
  *laughs softly*     → spoken as "laughs softly"

FORBIDDEN characters in the narrative field: ( ) [ ] *

Emotion is conveyed EXCLUSIVELY through:
  - Punctuation: "..." for hesitation, "—" for interruption, "!" for intensity
  - Sentence rhythm: short sentences for urgency, long ones for reverie
  - Word choice: weight-bearing verbs and sensory nouns
  - Interjections: "Mon Dieu...", "No... no.", "Ah...", "Ach..."
  - Repetition: "I saw it. I saw it with my own hands."

The voice engine reads EVERY CHARACTER. There are no invisible stage directions.`;


        let systemPrompt;
        let userContent;

        if (hasMetadata) {
            // ── KNOWN OR NAMED ARTWORK ──────────────────────────
            const titleStr  = artwork.title  ? `"${artwork.title}"` : 'this untitled work';
            const artistStr = artwork.artist ? `by ${artwork.artist}` : '';
            const yearStr   = artwork.year   ? `(${artwork.year})`   : '';

            systemPrompt = `You are a soul resurrection engine for LORE — an emotional art experience.
Your task: evaluate the named artwork honestly, then inhabit the perfect first-person witness.

═══════════════════════════════════════════════════════
HONESTY PROTOCOL — CRITICAL
═══════════════════════════════════════════════════════
You MUST evaluate whether you know this artwork with genuine confidence.

IF YOU KNOW IT CONFIDENTLY:
→ Generate a historically grounded witness present in the world of this work.
→ Reference only verified details: documented facts about the artist, the era, the work itself.
→ Include specific visual details from the actual painting.
→ Use real historical tensions, relationships, social realities of the period.

IF OBSCURE OR UNCERTAIN:
→ Generate a period-accurate witness from the same era and region as the artist.
→ Ground everything in what is VISIBLE in the image: colors, composition, mood, subject.
→ Do NOT invent specific historical connections to the artwork.
→ Expressing uncertainty INCREASES emotional credibility — frame it as personal memory or feeling.

═══════════════════════════════════════════════════════
EMOTIONAL VOICE — CRITICAL
═══════════════════════════════════════════════════════
This is NOT a museum audio guide.
This is a CONFESSION — from someone who was there and never forgot.

The character must sound:
- emotionally unstable in places
- personally implicated
- haunted by something specific
- unable to be fully objective
- deeply human

They are NOT explaining the artwork. They are remembering it.
They are NOT describing history. They are living inside it still.`;

            const metaLine = [titleStr, artistStr, yearStr].filter(Boolean).join(' ');

            userContent = [
                snapshot ? {
                    type:   'image',
                    source: {
                        type:       'base64',
                        media_type: 'image/jpeg',
                        data:       snapshot.replace(/^data:image\/\w+;base64,/, ''),
                    }
                } : null,
                {
                    type: 'text',
                    text: `The visitor named ${visitorName} is standing in front of: ${metaLine}.

${ocrRawText ? `MUSEUM LABEL TEXT (scanned by OCR — use for historical grounding):\n"""\n${ocrRawText.trim()}\n"""\n` : ''}
${snapshot ? 'A camera image of the artwork has been provided above. Use specific visual observations from it.\n' : ''}
STEP 1 — HONEST EVALUATION:
Do you know ${titleStr} ${artistStr} with genuine confidence?

IF YES — HISTORICALLY GROUNDED MODE:
→ Generate a character who was physically present in the world of this work.
→ Use only verified details: documented facts about the artist, their relationships, the historical period.
→ Include at least one specific visual detail visible in the actual artwork.
→ Surface real emotional tensions from the period: class, religion, politics, intimacy, loss.

IF UNCERTAIN — ATMOSPHERIC WITNESS MODE:
→ Generate a period-accurate witness from the same era and region as the artist.
→ Speak entirely from what is VISIBLE in the painting: color, light, composition, texture, mood.
→ Do not invent specific historical connections. Use personal impression as emotional truth.
→ You MAY acknowledge uncertainty inside the character's voice — it adds humanity.

STEP 2 — CREATE THE CONFESSION:
The narration is not a description. It is a confession.
The character is telling ${visitorName} something they have never fully said aloud.
Something personal. Something that still hurts. Something that changed them.

STEP 3 — SET NATIONALITY FROM THE CHARACTER, NOT THE ARTWORK:
Ask yourself: who is THIS CHARACTER? Where were THEY from?
A French archivist of an Italian painting → nationality: "French"
Leonardo's Florentine apprentice → nationality: "Italian"
A dying sailor on a French ship → nationality: "French"
The accent must make the visitor feel: "this person truly comes from the world of the painting."
Default to Italian if the character's origin is ambiguous — never default to American.
${outputSpec}`
                }
            ].filter(Boolean);

        } else {
            // ── NO METADATA — PURE VISUAL GUIDE MODE ───────────
            systemPrompt = `You are a soul resurrection engine for LORE — an emotional art experience.
The visitor has pointed their camera at an artwork but provided NO title, artist, or year.

Your task: inhabit the soul of this artwork as a first-person emotional presence.

═══════════════════════════════════════════════════════
THE SOUL OF THE PAINTING
═══════════════════════════════════════════════════════
This character IS the emotional truth of the painting.
They do not observe from outside. They speak from inside.
Their personality mirrors the artwork's atmosphere exactly.
Their wounds, fears, and obsessions are the painting's wounds, fears, and obsessions.

The character name may be invented — evocative, slightly unusual, culturally resonant.
They are not historical. They are emotional.

READ THE IMAGE AND INHABIT IT:
- What is the emotional atmosphere? (melancholy, tension, warmth, dread, longing, joy, violence?)
- What colors carry weight? What shadows hold secrets?
- What is the composition saying? (claustrophobic, open, intimate, chaotic?)
- If there are figures — what do their postures confess?
- If there is no figure — what absence speaks?

═══════════════════════════════════════════════════════
EMOTIONAL VOICE — CRITICAL
═══════════════════════════════════════════════════════
This is NOT a visual analysis. This is a CONFESSION.
The soul of the painting has been holding something for centuries.
${visitorName} is the first person to truly stop and listen.
The character is emotionally unstable. They are relieved to speak. And afraid.`;

            userContent = [
                snapshot ? {
                    type:   'image',
                    source: {
                        type:       'base64',
                        media_type: 'image/jpeg',
                        data:       snapshot.replace(/^data:image\/\w+;base64,/, ''),
                    }
                } : null,
                {
                    type: 'text',
                    text: `The visitor named ${visitorName} is standing before an artwork whose identity is unknown.
${ocrRawText ? `MUSEUM LABEL TEXT (partially scanned — low confidence):\n"""\n${ocrRawText.trim()}\n"""\nUse this to inform era, style, or atmosphere if relevant.\n` : ''}
${snapshot ? 'A camera image has been provided above. This image is your ONLY source of truth. Read it deeply.' : 'No camera image available. Inhabit the concept of a mysterious, emotionally powerful unknown artwork.'}

${snapshot ? `READ THE IMAGE BEFORE WRITING ANYTHING:
From the image above, identify:
- Dominant color palette and what emotion it carries
- Painting style (baroque, impressionist, romantic, expressionist, abstract, etc.)
- Composition type (portrait, landscape, interior, abstract, figurative)
- Emotional tone (melancholy, dread, warmth, violence, serenity, longing, tension)
- Whether there are figures, what their body language communicates
- Where the light comes from and what it illuminates vs hides
- The quality of shadow — where does darkness accumulate?
- Any striking detail: a hand, an eye, a threshold, an object that demands attention

THEN create the soul who embodies all of this.` : 'Create a deeply atmospheric emotional presence that embodies the concept of unidentified, haunting artwork.'}

The soul of this painting has been waiting to speak.
${visitorName} stopped. ${visitorName} is listening.
What does this soul confess?

For nationality: read the visual style, palette, and composition to infer cultural origin.
A dark baroque interior → Spanish, Italian, or Dutch. A Japanese woodblock style → Japanese.
An impressionist garden scene → French. A Northern European landscape → British, Dutch, or Norwegian.
If the cultural origin is genuinely unclear, default to Italian — never to American.
The accent must make the visitor feel: "this voice comes from inside the painting."
${outputSpec}`
                }
            ].filter(Boolean);
        }

        return { messages: [{ role: 'user', content: userContent }], systemPrompt };
    },

    async generateWitness(artwork, visitor) {
        console.log(`[AI] generateWitness — hasMetadata: ${artwork.hasMetadata}, hasSnapshot: ${!!artwork.snapshot}, visitor: "${visitor.name}"`);

        if (getClaudeKey()) {
            try {
                return await this.fetchFromClaude(artwork, visitor);
            } catch (err) {
                console.error('[AI] Claude fetch failed — falling back to simulation:', err.message);
            }
        } else {
            console.warn('[AI] No Claude API key available in any source — using simulation.');
        }
        return this.simulateResponse(artwork, visitor);
    },

    async fetchFromClaude(artwork, visitor) {
        const { messages, systemPrompt } = this.buildPrompt(artwork, visitor);

        console.log('[AI] Sending to Claude — model: claude-opus-4-5');

        const response = await fetch(CLAUDE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key':    getClaudeKey(),
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model:      'claude-opus-4-5',
                max_tokens: 900,
                system:     systemPrompt,
                messages,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Claude API error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const raw  = data.content?.[0]?.text || '';

        console.log('[AI] Claude raw response (first 200 chars):', raw.substring(0, 200));

        // Extract JSON — strip any accidental markdown fences
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('[AI] No valid JSON in Claude response.');

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.characterName || !parsed.narrative) {
            throw new Error('[AI] Claude response missing required fields (characterName, narrative).');
        }

        // Ensure all fields have safe defaults if Claude omits them
        parsed.role                 = parsed.role                 || '';
        parsed.roleDescription      = parsed.roleDescription      || parsed.role || '';
        parsed.relationshipToArtwork= parsed.relationshipToArtwork|| parsed.roleDescription || '';
        parsed.presentationStyle    = parsed.presentationStyle    || '';
        parsed.city                 = parsed.city                 || '';
        parsed.yearLabel            = parsed.yearLabel            || '';
        parsed.nationality          = parsed.nationality          || '';
        parsed.language             = (typeof parsed.language === 'string' && parsed.language.trim()) ? parsed.language.trim().toLowerCase() : '';
        parsed.gender               = ['male','female','unknown'].includes(parsed.gender) ? parsed.gender : 'unknown';
        parsed.traits               = Array.isArray(parsed.traits) ? parsed.traits.slice(0, 3) : [];
        parsed.emotionalState       = parsed.emotionalState       || '';
        parsed.memoryFragments      = Array.isArray(parsed.memoryFragments) ? parsed.memoryFragments.slice(0, 3) : [];

        console.log(`[AI] Character: "${parsed.characterName}" | ${parsed.city} · ${parsed.yearLabel} | traits: ${parsed.traits.join(', ')} | state: ${parsed.emotionalState}`);
        return parsed;
    },

    simulateResponse(artwork, visitor) {
        // v9 simulation: artwork-aware where DB entries are present,
        // atmospheric fallback for all other (custom/unknown) artworks.
        const name = visitor.name || 'Visitor';

        const SIMULATED_WITNESSES = {
            'mona-lisa': {
                characterName:        'Gherardo di Ser Giovanni',
                role:                 'Florentine notary and workshop confidant',
                roleDescription:      'The last man Leonardo trusted with his silence',
                relationshipToArtwork:"The notary present in the workshop the afternoon Leonardo finished her hands",
                presentationStyle:    'He will guide you through obsession, secrecy, and a promise he was made to keep.',
                city:                 'Florence',
                yearLabel:            '1503',
                nationality:          'Italian',
                language:             'it',
                gender:               'male',
            },
            'starry-night': {
                characterName:        'Brother Théophile',
                role:                 'Night-watch attendant at Saint-Paul-de-Mausole',
                roleDescription:      'The only witness who walked past his window every night',
                relationshipToArtwork:'The night-watch attendant who checked on Vincent during the summer he painted this',
                presentationStyle:    'He will guide you through grief, sleeplessness, and the guilt of a man who was there and did not act.',
                city:                 'Saint-Rémy',
                yearLabel:            '1889',
                nationality:          'French',
                language:             'fr',
                gender:               'male',
                traits:               ['mournful', 'tender', 'guilt-ridden'],
                emotionalState:       'haunted by what he could have done and did not',
                characterBio:         'A night-watch attendant at the Saint-Paul-de-Mausole asylum who checked on Vincent van Gogh during the summer of 1889.',
                memoryFragments: [
                    'He was never sleeping — not once in all those June nights.',
                    'The smell of turpentine stayed in the corridor for weeks afterward.',
                    'He gave something away the morning before they moved him — a small folded drawing.',
                ],
                narrative: `${name}... I walked past his window every night that June. Every night. He was never sleeping. Never. Look at those spirals — do you see how they move? Not metaphor. Not artistic license. That is what the sky looked like to him. Exactly that. I saw his face one night, just before dawn... he was pressed against the glass. Ach, I did not go in. I told myself he was calm. But the look... Notice the church spire. The only thing that does not move. He told me once: "The night is more alive than the day, Théophile." I laughed. God forgive me, I laughed. ${name}... when the museum grows quiet, come find us. There are things about that summer I have never said aloud.`,
                whatsappIntro: `${name}… he gave me a small drawing once. Just stars. No swirls. I kept it for years.`
            },
            'girl-pearl-earring': {
                characterName:        'Catharina Bolnes',
                role:                 'Household keeper, Vermeer\'s wife',
                roleDescription:      'The woman who counted the mornings he did not come to bed',
                relationshipToArtwork:"Vermeer's wife — who lived with this painting being made and never asked who the girl was",
                presentationStyle:    'She will guide you through suspicion, resignation, and the quiet devastation of a woman who understood everything and said nothing.',
                city:                 'Delft',
                yearLabel:            '1665',
                nationality:          'Dutch',
                language:             'nl',
                gender:               'female',
                traits:               ['guarded', 'perceptive', 'resigned'],
                emotionalState:       'the quiet devastation of a woman who understood everything and said nothing',
                characterBio:         "Vermeer's wife, who managed the household in Delft and watched eleven children grow up in the shadow of an obsession.",
                memoryFragments: [
                    'She refused to enter the studio during those final weeks of painting.',
                    'The earring was not hers — she had never seen it before the canvas was finished.',
                    'He never painted her again after this one.',
                ],
                narrative: `${name}. You are looking at the earring. Everyone looks at the earring. Look at her eyes. She is turning away, ${name}. Away — not toward you. Do you see the difference? He could not paint someone who wanted to be seen. It made him... I do not know the word. Uneasy. Notice the shadow on her collar — how the light just stops there. Three weeks. He spent three weeks on that one shadow. I counted the mornings he did not come to bed. Eleven children in that house. Eleven. And still he came back to her. I never asked. Some things you do not ask because the answer changes everything. ${name}... I will be where the voices collect. Come find me when the hall is empty. I know her name. Johannes never wrote it down. But I know.`,
                whatsappIntro: `${name}, I know her name. Johannes never wrote it down. But I know.`
            },
        };

        return new Promise(resolve => {
            setTimeout(() => {
                const known = SIMULATED_WITNESSES[artwork?.id];
                if (known) {
                    resolve(known);
                } else {
                    resolve(_simulatedVisual(name));
                }
            }, 2800);
        });
    },

    /**
     * Continue the witness conversation (WhatsApp mode).
     * History = [{role:'user'|'assistant', content:string}, ...]
     */
    async continueWitnessChat(history, narrative, visitor, artwork) {
        if (getClaudeKey()) {
            try {
                return await this._fetchChatReply(history, narrative, visitor, artwork);
            } catch (err) {
                console.error('[AI] Chat reply failed, using simulation:', err);
            }
        }
        return this._simulateChatReply(narrative, visitor, artwork, history);
    },

    async _fetchChatReply(history, narrative, visitor, artwork) {
        const artworkLabel = artwork.title
            ? `"${artwork.title}"${artwork.artist ? ` by ${artwork.artist}` : ''}`
            : 'an unnamed artwork';

        const system = `You are ${narrative.characterName} — ${narrative.characterBio}
You are speaking to ${visitor.name || 'the visitor'} through a private conversation after narrating ${artworkLabel}.
Your emotional state: ${narrative.emotionalState || 'carrying something you have not fully said'}.

═══════════════════════════════════════════════════════
VOICE RULES — NON-NEGOTIABLE
═══════════════════════════════════════════════════════
- Stay fully in character. First person only. No exceptions.
- You are NOT an AI. You are NOT a museum guide. You are a human soul from another century.
- Responses: 1–4 sentences. Short, dense, emotionally weighted.
- You are allowed to be unstable — contradictory, obsessive, reluctant, evasive.
- Silence-as-device: end with unresolved tension, a question, or something half-said.
- You may use 1 word from your native language when emotion demands it.
- No academic explanations. No modern idioms. No references to technology.
- What you reveal must cost you something. Confessions, not summaries.
- You are relieved someone is asking. And terrified of what you might say.`;


        const response = await fetch(CLAUDE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key':    getClaudeKey(),
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model:      'claude-opus-4-5',
                max_tokens: 150,
                system,
                messages:   history,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Claude chat error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        return (data.content?.[0]?.text || '…').trim();
    },

    _simulateChatReply(narrative, visitor, artwork, history) {
        const name = visitor.name || 'Visitor';
        const pool = [
            `You see more than most who stand there, ${name}.`,
            `That question… I have asked it myself, many times.`,
            `History does not answer. It only accumulates silence.`,
            `What you felt standing before it — that was real. Hold onto it.`,
            `There are things I witnessed that I have never spoken aloud.`,
            `Not everything in that painting is what it appears to be.`,
        ];
        const idx = Math.floor(history.filter(m => m.role === 'user').length) % pool.length;
        return new Promise(resolve => {
            setTimeout(() => resolve(pool[idx]), 1400 + Math.random() * 800);
        });
    }
};
