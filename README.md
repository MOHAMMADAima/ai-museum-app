# ai-museum-app
An immersive AI museum companion that brings historical artwork to life through theatrical audio storytelling and dynamic voice synthesis.

# LORE - Narrative-Ressurection-Engine

🏆 3rd Place Winner at Built with MeDo Hackathon
https://devpost.com/software/lore-nf8hdt 

LORE is an immersive AI experience that transforms museum visits into emotional, interactive storytelling.

Instead of traditional audio guides, visitors engage in real-time conversations with AI-generated characters connected to artworks—such as artists, muses, or historical witnesses. Each character brings context, emotion, and narrative depth, turning static paintings into living stories.

The goal is to shift museum experiences from information delivery to emotional connection.

## Why LORE
LORE was inspired by a simple observation: people rarely remember facts, but they remember emotions.

By combining AI, voice, and immersive storytelling, LORE creates a more human way to experience art—where history is not explained, but felt.

## What it does
Scans museum labels using OCR
Generates AI characters linked to artworks
Creates cinematic, emotionally-driven storytelling
Enables voice-based interaction with characters
Adapts tone, pacing, and soundscapes dynamically
Extends conversations beyond the museum experience
Key Experience
A visitor scans a label next to an artwork.

LORE generates a character tied to that piece:

the artist
an apprentice
a muse
a historical witness
or a fictional presence from the era

The character then speaks directly to the visitor with:

emotion and pacing
voice and accent variation
ambient sound design
synchronized subtitles
narrative depth and personality
The result feels less like using an AI…

and more like listening to a memory come alive.

## Impact
LORE reimagines cultural experiences by making art interactive, personal, and emotionally engaging—without replacing museums, but enhancing how people connect with them.

LORE does not try to replace museums with technology.

It tries to deepen the emotional connection between visitors and artworks.

In fact, one of my favorite moments in the experience is when the app tells the visitor:

“Put your phone away… and look at the artwork.”

At that moment, the technology disappears.

Only the story remains.

## Demo

Demo Video:
LINK (to be coming)

## Hackathon Achievement

Awarded 3rd Place. 4000$ cash. 8410 participants worldwide.

## Architecture

```
├── README.md # Documentation
├── components.json # Component library configuration
├── index.html # Entry file
├── package.json # Package management
├── postcss.config.js # PostCSS configuration
├── public # Static resources directory
│   ├── favicon.png # Icon
│   └── images # Image resources
├── src # Source code directory
│   ├── App.tsx # Entry file
│   ├── components # Components directory
│   ├── context # Context directory
│   ├── db # Database configuration directory
│   ├── hooks # Common hooks directory
│   ├── index.css # Global styles
│   ├── layout # Layout directory
│   ├── lib # Utility library directory
│   ├── main.tsx # Entry file
│   ├── routes.tsx # Routing configuration
│   ├── pages # Pages directory
│   ├── services # Database interaction directory
│   ├── types # Type definitions directory
├── tsconfig.app.json # TypeScript frontend configuration file
├── tsconfig.json # TypeScript configuration file
├── tsconfig.node.json # TypeScript Node.js configuration file
└── vite.config.ts # Vite configuration file
```

## Tech Stack

Vite, TypeScript, React, Supabase

## Development Guidelines

### How to edit code locally?

You can choose [VSCode](https://code.visualstudio.com/Download) or any IDE you prefer. The only requirement is to have Node.js and npm installed.

### Environment Requirements

```
# Node.js ≥ 20
# npm ≥ 10
Example:
# node -v   # v20.18.3
# npm -v    # 10.8.2
```

### Installing Node.js on Windows

```
# Step 1: Visit the Node.js official website: https://nodejs.org/, click download. The website will automatically suggest a suitable version (32-bit or 64-bit) for your system.
# Step 2: Run the installer: Double-click the downloaded installer to run it.
# Step 3: Complete the installation: Follow the installation wizard to complete the process.
# Step 4: Verify installation: Open Command Prompt (cmd) or your IDE terminal, and type `node -v` and `npm -v` to check if Node.js and npm are installed correctly.
```

### Installing Node.js on macOS

```
# Step 1: Using Homebrew (Recommended method): Open Terminal. Type the command `brew install node` and press Enter. If Homebrew is not installed, you need to install it first by running the following command in Terminal:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Alternatively, use the official installer: Visit the Node.js official website. Download the macOS .pkg installer. Open the downloaded .pkg file and follow the prompts to complete the installation.
# Step 2: Verify installation: Open Command Prompt (cmd) or your IDE terminal, and type `node -v` and `npm -v` to check if Node.js and npm are installed correctly.
```

### After installation, follow these steps:

```
# Step 1: Download the code package
# Step 2: Extract the code package
# Step 3: Open the code package with your IDE and navigate into the code directory
# Step 4: In the IDE terminal, run the command to install dependencies: npm i
# Step 5: In the IDE terminal, run the command to start the development server: npm run dev -- --host 127.0.0.1
# Step 6: if step 5 failed, try this command to start the development server: npx vite --host 127.0.0.1
```

### How to develop backend services?

Configure environment variables and install relevant dependencies.If you need to use a database, please use the official version of Supabase.

## Learn More

You can also check the help documentation: Download and Building the app（ [https://intl.cloud.baidu.com/en/doc/MIAODA/s/download-and-building-the-app-en](https://intl.cloud.baidu.com/en/doc/MIAODA/s/download-and-building-the-app-en)）to learn more detailed content.
