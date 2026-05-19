export const State = {
    visitorProfile: {
        name: '',
        gender: ''
    },
    visitedArtworks: [],
    currentArtwork: null,
    currentNarrative: null,
    currentState: 'splash',
    whatsappMessages: [],

    // Runtime-only (not persisted)
    activeAudioHandle: null,
    stopWaveform: null,
    isProcessing: false,
    entryMode: 'resurrection', // v9: always 'resurrection'
    
    updateProfile(data) {
        this.visitorProfile = { ...this.visitorProfile, ...data };
        this.save();
    },
    
    addArtwork(artwork) {
        if (!this.visitedArtworks.find(a => a.id === artwork.id)) {
            this.visitedArtworks.push(artwork);
            this.save();
        }
    },
    
    addWhatsappMessage(message) {
        this.whatsappMessages.push(message);
        this.save();
    },
    
    save() {
        localStorage.setItem('lore_state', JSON.stringify({
            visitorProfile: this.visitorProfile,
            visitedArtworks: this.visitedArtworks,
            whatsappMessages: this.whatsappMessages
        }));
    },
    
    load() {
        const saved = localStorage.getItem('lore_state');
        if (saved) {
            const data = JSON.parse(saved);
            this.visitorProfile = data.visitorProfile || this.visitorProfile;
            this.visitedArtworks = data.visitedArtworks || this.visitedArtworks;
            this.whatsappMessages = data.whatsappMessages || this.whatsappMessages;
        }
    }
};

export const ArtworkDatabase = [
    { 
        id: 'mona-lisa', 
        title: 'Mona Lisa', 
        artist: 'Leonardo da Vinci', 
        year: '1503', 
        keywords: ['portrait', 'smile', 'louvre', 'renaissance'],
        nationality: 'Italian',
        image: 'https://miaoda-site-img.s3cdn.medo.dev/images/KLing_b198a709-fc02-4fb6-b155-e5da12375fbc.jpg'
    },
    { 
        id: 'starry-night', 
        title: 'The Starry Night', 
        artist: 'Vincent van Gogh', 
        year: '1889', 
        keywords: ['post-impressionism', 'stars', 'night', 'swirls'],
        nationality: 'Dutch',
        image: 'https://miaoda-site-img.s3cdn.medo.dev/images/KLing_2fd3fb5b-c1d8-4685-8a3a-b3016efc2127.jpg'
    },
    { 
        id: 'girl-pearl-earring', 
        title: 'Girl with a Pearl Earring', 
        artist: 'Johannes Vermeer', 
        year: '1665', 
        keywords: ['baroque', 'turban', 'earring', 'portrait'],
        nationality: 'Dutch',
        image: 'https://miaoda-site-img.s3cdn.medo.dev/images/KLing_af2e5464-aeb1-490a-b26a-70fc8f608256.jpg'
    }
];
