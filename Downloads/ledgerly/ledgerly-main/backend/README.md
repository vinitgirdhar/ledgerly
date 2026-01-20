# Ledgerly Backend (Flask)

## Run locally (Windows)

1) Create venv and install deps:

```powershell
cd "d:\DOING STUFF\ledgerly"
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

2) Start backend:

```powershell
python backend\app.py
```

3) Open in browser:

- http://127.0.0.1:5000/login.html
- http://127.0.0.1:5000/

## API

- `POST /api/register` `{ username, email, password }`
- `POST /api/login` `{ identifier, password, remember }`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/entries`
- `POST /api/entries` `{ entry_type, amount, note }`

SQLite DB file defaults to `backend/ledgerly.db`.
