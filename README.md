# Ledgerly

Turn Bills Into Business Intelligence - A smart, voice‑first accounting and insights platform for small Indian shop owners.  
Ledgerly transforms photos of bills, voice notes, and everyday transactions into GST‑ready invoices, real‑time dashboards, and actionable growth insights—no spreadsheets required.

## ✨ What it does

- **Snap a bill → Invoice**: Capture a photo; Ledgerly extracts line items, applies GST, and creates a polished invoice.
- **Voice entry**: Speak in Hinglish; we transcribe, categorize, and post to the ledger.
- **Dashboard**: At‑a‑glance cash position, pending invoices, and GST readiness.
- **Insights Studio**: Scenario‑based growth analyzer, inventory radar, and suggested plays.
- **Onboarding wizard**: Guided setup to import shop profile, product catalogue, opening inventory, and integrations.
- **GST‑ready**: Auto‑generated filing packets and vendor reminders.

## 🛠️ Tech stack

- **Frontend**: HTML/CSS/JS
- **Backend**: Flask (Python)
- **Styling**: CSS custom properties, Manrope font
- **Icons/Assets**: SVG logo and placeholder images

## 📁 Project structure

```
ledgerly-main/
├─ backend/
│  └─ app.py               # Flask routes and static serving
├─ pages/
│  ├─ index.html            # Landing page
│  ├─ login.html           # Login / register
│  ├─ dashboard.html       # Shop owner dashboard
│  └─ insights.html        # Insights Studio
├─ styles/
│  ├─ styles.css           # Global styles
│  ├─ dashboard.css        # Dashboard‑specific styles
│  └─ insights.css         # Insights‑specific styles
├─ script/
│  ├─ app.js              # Landing‑page interactions
│  ├─ login.js            # Auth handling
│  ├─ dashboard.js        # Dashboard & onboarding logic
│  ├─ insights.js         # Insights scenario toggles
│  └─ toasts.js          # Toast notification system
└─ uploads/
   └─ logo.svg           # Ledgerly brand logo
```

## 🚀 Getting started locally

1. **Clone**
   ```bash
   git clone <repo-url>
   cd ledgerly-main
   ```

2. **Install Python deps**
   ```bash
   python -m venv venv
   source venv/bin/activate   # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Run the dev server**
   ```bash
   python backend/app.py
   ```
   Open http://127.0.0.1:5000 in your browser.

## 🧭 Pages & flows

| Page | Purpose |
|------|---------|
| `/` | Marketing landing with CTA to sign in |
| `/login` | Login / register form (client‑side validation) |
| `/dashboard` | Owner hub: setup prompt, data‑health, quick actions, modals for upload/voice/ledger/chat |
| `/insights` | Growth analyzer, inventory radar, suggested actions with scenario toggles |
| Modals | Onboarding wizard, upload workspace, voice console, ledger table, chat UI |

## 🎨 Design principles

- **Pastel, floating containers**: Soft shadows, rounded corners, translucent panels.
- **Accessible**: Semantic markup, ARIA live regions, keyboard navigation.
- **Responsive**: Mobile‑first grid/flex, smooth scroll, touch‑friendly targets.
- **Micro‑interactions**: Hover lift, toast feedback, smooth transitions.

## 🔧 Key interactions

- **Toast system**: Auto‑dismiss, manual close, intent‑based styling (`success`, `info`).
- **Modal management**: Focus trap, ESC/overlay close, backdrop blur.
- **Scenario toggles**: Insights metrics update instantly with toast confirmation.
- **Onboarding progress**: Live progress bars and step navigation; completion updates persist across the session.

## 📦 Deploy notes

- Static assets served by Flask from `/static` (mapped to `styles/`, `script/`, `uploads/`).
- For production, serve via a WSGI server (e.g., Gunicorn) behind a reverse proxy.
- Ensure `uploads/logo.svg` path is reachable; replace with your brand assets if needed.

Built with ❤️ for India’s neighborhood shop owners.



