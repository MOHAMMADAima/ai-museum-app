# Requirements Document

## 1. Application Overview

**Application Name**: LORE — Narrative Resurrection Engine

**Description**: A cinematic AI museum experience that allows visitors to interact with artworks through AI-generated witness characters and voice narration. The application creates an emotional, mysterious journey where history is temporarily reanimated through technology.

## 2. Users and Usage Scenarios

**Target Users**: Museum visitors seeking immersive, emotional experiences with artworks

**Core Usage Scenario**: Visitors enter the museum, scan artworks, receive AI-generated witness narratives through voice, and continue emotional connection through simulated WhatsApp conversation

## 3. Page Structure and Functionality

### Page Hierarchy

```
LORE Application
├── 1. Splash Screen
├── 2. Profile Screen
├── 3. Scan Screen
├── 4. Generation Screen
├── 5. Narration Screen
├── 6. End Visit Screen
└── 7. WhatsApp Simulation Screen
```

### 3.1 Splash Screen

**Purpose**: Ritual entry point with camera access

**Functionality**:
  - Display application title and visual introduction
  - Request camera permission from user
  - Provide entry button to proceed to Profile Screen
  - Present cinematic opening animation

### 3.2 Profile Screen

**Purpose**: Collect visitor identity information

**Functionality**:
  - Input field for visitor name
  - Selection for gender (male/female/other)
  - Submit button to proceed to Scan Screen
  - Display typewriter animation for text elements

### 3.3 Scan Screen

**Purpose**: Artwork recognition through camera

**Functionality**:
  - Activate camera view
  - Display artwork recognition UI overlay
  - Identify artwork based on metadata
  - Proceed to Generation Screen upon successful recognition

### 3.4 Generation Screen

**Purpose**: Ritual loading sequence during AI processing

**Functionality**:
  - Display cinematic loading animation
  - Generate witness character using Claude API (CLAUDE_API_KEY)
  - Create character narrative based on artwork metadata and visitor profile
  - Transition to Narration Screen when generation completes

### 3.5 Narration Screen

**Purpose**: Voice and waveform experience

**Functionality**:
  - Play AI-generated narration using ElevenLabs API (ELEVENLABS_API_KEY)
  - Display real-time waveform visualization synchronized with audio
  - Show witness character narrative text
  - Provide option to proceed to End Visit Screen

### 3.6 End Visit Screen

**Purpose**: Emotional closure

**Functionality**:
  - Display farewell message from witness character
  - Provide option to continue conversation via WhatsApp Simulation
  - Offer option to scan another artwork
  - Show exit option

### 3.7 WhatsApp Simulation Screen

**Purpose**: In-app continuation of conversation

**Functionality**:
  - Simulate WhatsApp interface within application
  - Display conversation history with witness character
  - Allow user to send text messages
  - Generate AI responses from witness character using Claude API
  - Maintain conversation context throughout session

## 4. Business Rules and Logic

### 4.1 Code Structure Layers

**UI Layer**: Handles all screen rendering and user interactions

**AI Layer**: Manages Claude API integration for character generation and conversation

**Audio Layer**: Manages ElevenLabs API integration for voice narration

**State Layer**: Maintains application state across screens (visitor profile, artwork data, conversation history)

**Transition Layer**: Controls cinematic transitions between screens

### 4.2 Artwork Recognition System

- Artwork identification based on metadata only
- No image recognition or computer vision processing
- Metadata includes artwork title, artist, period, and narrative context

### 4.3 AI Character Generation

- Use Claude API with CLAUDE_API_KEY
- Generate witness character based on:
  - Artwork metadata
  - Visitor name and gender from Profile Screen
  - Historical context of artwork
- Character narrative must be emotional, subjective, and mysterious

### 4.4 Voice Narration

- Use ElevenLabs API with ELEVENLABS_API_KEY
- Convert generated narrative text to speech
- Voice tone matches cinematic and emotional atmosphere

### 4.5 Design Specifications

**Color Palette**:
  - Background: #080808 (dark museum aesthetic)
  - Accent: #C9A96E (gold)
  - Text: #F0EBE0 (light beige)

**Animations**:
  - Cinematic transitions between screens
  - Typewriter effect for text appearance
  - Smooth fade-in/fade-out effects

**Overall Tone**: Everything must feel like a memory from history temporarily reanimated

### 4.6 Technology Constraints

- Use ONLY Vanilla HTML, CSS, and JavaScript
- No frameworks or libraries allowed
- All functionality implemented with native browser APIs

## 5. Exceptions and Edge Cases

| Scenario | Handling |
|----------|----------|
| Camera permission denied | Display error message, provide retry option |
| Artwork not recognized | Show guidance message, allow re-scan |
| Claude API failure | Display error message, offer retry or skip to next screen |
| ElevenLabs API failure | Display text-only narrative, continue without audio |
| Network connection lost | Cache current state, resume when connection restored |
| Invalid profile input | Display validation message, prevent submission |
| API key missing or invalid | Display configuration error message |

## 6. Acceptance Criteria

1. User opens application and grants camera permission on Splash Screen
2. User enters name and gender on Profile Screen and proceeds
3. User scans artwork on Scan Screen and system recognizes it via metadata
4. System generates witness character narrative using Claude API on Generation Screen
5. User listens to voice narration with waveform visualization on Narration Screen
6. User proceeds to End Visit Screen and chooses to continue conversation
7. User engages in simulated WhatsApp conversation with witness character
8. User completes emotional closure and exits application

## 7. Out of Scope for Current Release

- Actual WhatsApp integration or external messaging platforms
- Image recognition or computer vision for artwork identification
- User account system or data persistence across sessions
- Multi-language support
- Offline mode functionality
- Social sharing features
- Analytics or tracking systems
- Admin panel or content management system
- Multiple artwork scanning in single session
- Conversation history export
- Custom voice selection for narration
- Background music or ambient sound effects