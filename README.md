# ⚔️ War of Genesis: Idle Loot — All-in-One Companion & Database Explorer

> **The ultimate web-based companion, database explorer, and optimization suite for *The War of Genesis: Idle Loot* (Steam / PC).**  
> 100% client-side, zero setup required, works directly in any browser on PC and mobile.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Web%20App-success?logo=github&style=flat-square)](https://github.com/)
[![Game](https://img.shields.io/badge/Game-The%20War%20of%20Genesis%3A%20Idle%20Loot-blue?style=flat-square&logo=steam)](https://store.steampowered.com/)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Windows%20%7C%20Mobile-lightgrey?style=flat-square)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 🔀 Fork Notice

This repository is a fork/derivative of [`titlee2111/war-of-genesis-helper`](https://github.com/titlee2111/war-of-genesis-helper), redistributed under the original [MIT License](LICENSE). Changes made in this fork:
- Refactored the single 4MB `index.html` into a multi-file dev source under `src/` (`live-sync.js`, `combat-service.js`, `catalog-service.js`, `i18n-service.js`, `index.template.html`), with `build.js` reassembling it back into the single-file `index.html` the app is still distributed as.
- Added a Traditional Chinese (繁體中文) language, covering both the static UI and the equipment/jewel/skill-tree databases (translated content, not machine-translated at runtime).

---

## 🌐 Live Web Version

Access the web version instantly without installing anything:  
👉 **`https://crkuo.github.io/war-of-genesis-helper/`**

---

## 🌟 Key Features

### 🌳 1. Multi-Class Skill Tree Simulator & Point Allocator
- **Interactive Skill Trees:** Full visual skill progression trees for all 3 classes: **Ranged (Archer)**, **Melee (Knight)**, and **Mage**.
- **Level-Based Skill Points:** Automatically calculates maximum allowable skill points based on current character level.
- **Auto-Save Persistence:** Skill allocations are saved instantly to your browser's `localStorage`.
- **One-Click In-Game Reset:** Revert back to your actual in-game skill allocation with the *"↩️ Restore from Game"* button.

### 🏆 2. 400+ Stage AFK Farming Efficiency Leaderboard
- **Money/s & EXP/s Analytics:** Real-time yield benchmarks covering 400+ stages across Chapters 1 through 4 (Easy, Normal, Hard, Very Hard).
- **Exact Clear Time Modeling:** Calculated using total stage monster HP, monster spawn densities, and your actual DPS.
- **Smart Filtering:** Filter by your character's current unlocked stage range, manual DPS slider, or real measured in-game DPS.

### ⚔️ 3. Real-Time DPS & Combat Breakdown
- **Granular DPS Decomposition:** Deconstructs your total damage output into normal attacks vs. individual skill casts.
- **Dual Combat Modes:** Toggle between **Mob Sweeping (AoE)** and **Boss Killing (Single-Target)** for accurate simulation.
- **Cross-Class DPS Comparison Table:** Side-by-side performance matrix comparing Attack Speed, Critical Rate/Damage, Normal Attack DPS, Skill DPS, and Top Burst Skill across all 3 classes.

### 🛡️ 4. Complete 1,872 Equipment Database
- **Comprehensive Catalog:** Every single weapon, sub-weapon, helmet, chest armor, gloves, boots, pauldrons, cloak, and 6 accessory types.
- **Multi-Facet Filtering:**
  - **Slot Filter:** 14 distinct equipment positions.
  - **Tier Filter:** Tier 1 (Common) through Tier 6 (Divine) with verified in-game color borders and tier glow.
  - **Required Level:** Levels 1 to 105 in 10-level increments.
  - **Sorting:** Sort by Level, Tier, Gold Price, or Name (A-Z).
- **Fast Pagination:** 100 items per page with instant search in Vietnamese and English.

### 🏋️ 5. Training Skills Optimizer
- Full gold-cost scaling database for core stat upgrades (Attack, Defense, HP, Crit Rate, Gold Boost, EXP Boost).
- Accurately displays stat increments and percentage scaling matching the live game tables.

### 💎 6. Automated Jewel Forge & Storage Management (Auto Fuse)
- **Verified Fusion Rule:** Automatically fuses any **6 jewels of the same tier** into a higher tier (same-type not required).
- **Per-Tier Selectors:** 7 tier checkboxes (Tier 1 through Tier 7) allowing you to fuse only desired tiers while protecting higher-level gems.
- **Storage & Bag Management:** Automated deposit and withdrawal queue between player inventory and personal warehouse.

### 🔍 7. Save Game Locator & Profile Sync
- **Windows / Steam Path Suggestions:** Built-in guidance with one-click path copying for Windows File Explorer:
  - AppData Directory: `%LOCALAPPDATA%Low\Newnormal Soft\War of Genesis Idle Loot\`
  - Steam Default: `C:\Program Files (x86)\Steam\steamapps\common\War of Genesis Idle Loot\`
- **Drag & Drop Import:** Simply drag any profile `.json` file into the web app to load character name, level, combat power, and equipped gear.
- **Offline Persistence:** Automatically caches custom imported profiles in your browser for future visits.

---

## 🔄 Real-Time Game Sync (Puerts V8 Engine)

This tool features a live WebSocket client designed to interface directly with the game's internal Puerts V8 inspector at `ws://127.0.0.1:10998`:

### Option A: Open Locally (Recommended for Live Sync)
1. Download `index.html` to your local PC.
2. Double-click to open it in Chrome, Edge, or Brave (`file:///...`).
3. When *Genesis.exe* is running, the app automatically establishes a WebSocket connection and polls live Combat Power, Level, EXP/s, Gold/s, and Skill Levels in real-time!

### Option B: Hosted Web Version (GitHub Pages)
Modern browsers enforce strict Mixed Content policies that block unencrypted `ws://` connections from `https://` websites:
1. Open the hosted GitHub Pages URL.
2. Click the 🔒 lock icon next to the address bar → Select **Site settings**.
3. Locate **Insecure content** and set it to **Allow**.
4. Refresh the page (F5) — Live Sync will now connect to your local game process!

---

## 🛠️ Technology Stack
- **Architecture:** Zero-dependency, single-file modern HTML5, ES6+ JavaScript, and responsive CSS3.
- **Asset Pipeline:** 570+ game icons (skills, equipment, accessories, jewels) losslessly compressed and embedded as Base64 WebP.
- **Quality Assurance:** Developed via **Test-Driven Development (TDD)** and validated using automated headless Chrome CDP test suites.

---

## ⚖️ Disclaimer
*The War of Genesis: Idle Loot* is developed and published by **Newnormal Soft**. All game assets, trademarks, icons, and copyrighted materials belong to their respective owners. This project is an open-source, non-profit community tool created solely for game analysis, character optimization, and informational purposes.

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
