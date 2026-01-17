from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import connect, default_db_path, init_db, query_one, query_all, exec_one


FRONTEND_DIR = Path(__file__).resolve().parents[1]


def create_app() -> Flask:
    app = Flask(__name__)

    # Use an env var in real deployments.
    app.secret_key = os.environ.get("LEDGERLY_SECRET_KEY", "dev-secret-change-me")
    app.permanent_session_lifetime = timedelta(days=14)

    db_path = Path(os.environ.get("LEDGERLY_DB_PATH", str(default_db_path())))
    init_db(db_path)

    def get_conn():
        return connect(db_path)

    def current_user_id() -> int | None:
        user_id = session.get("user_id")
        return int(user_id) if user_id is not None else None

    def require_login() -> int:
        user_id = current_user_id()
        if not user_id:
            return 0
        return user_id

    # -------------------------
    # Frontend file serving
    # -------------------------
    @app.get("/")
    def serve_index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/<path:path>")
    def serve_static(path: str):
        # Prevent API paths from being treated as files.
        if path.startswith("api/"):
            return jsonify({"error": "not_found"}), 404

        full_path = FRONTEND_DIR / path
        if full_path.is_file():
            return send_from_directory(FRONTEND_DIR, path)

        # Friendly default
        return jsonify({"error": "not_found"}), 404

    # -------------------------
    # Auth API
    # -------------------------
    @app.post("/api/register")
    def api_register():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not username:
            return jsonify({"error": "username_required"}), 400
        if "@" not in email:
            return jsonify({"error": "email_invalid"}), 400
        if len(password) < 8:
            return jsonify({"error": "password_too_short"}), 400

        pwd_hash = generate_password_hash(password)

        try:
            with get_conn() as conn:
                user_id = exec_one(
                    conn,
                    "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
                    (username, email, pwd_hash),
                )
        except Exception:
            # Most likely email uniqueness violation.
            return jsonify({"error": "user_exists"}), 409

        return jsonify({"ok": True, "user": {"id": user_id, "username": username, "email": email}})

    @app.post("/api/login")
    def api_login():
        data = request.get_json(silent=True) or {}
        identifier = (data.get("identifier") or "").strip()
        password = data.get("password") or ""
        remember = bool(data.get("remember"))

        if not identifier:
            return jsonify({"error": "identifier_required"}), 400
        if len(password) < 8:
            return jsonify({"error": "password_invalid"}), 400

        with get_conn() as conn:
            row = query_one(
                conn,
                """
                SELECT id, username, email, password_hash
                FROM users
                WHERE lower(email) = lower(?) OR lower(username) = lower(?)
                LIMIT 1
                """,
                (identifier, identifier),
            )

        if row is None:
            return jsonify({"error": "invalid_credentials", "message": "Unknown email/username or wrong password."}), 401

        if not check_password_hash(row["password_hash"], password):
            return jsonify({"error": "invalid_credentials", "message": "Unknown email/username or wrong password."}), 401

        session.clear()
        session["user_id"] = int(row["id"])
        session.permanent = remember

        return jsonify({"ok": True, "user": {"id": int(row["id"]), "username": row["username"], "email": row["email"]}})

    @app.post("/api/logout")
    def api_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/api/me")
    def api_me():
        user_id = current_user_id()
        if not user_id:
            return jsonify({"ok": True, "user": None})

        with get_conn() as conn:
            row = query_one(conn, "SELECT id, username, email FROM users WHERE id = ?", (user_id,))

        if row is None:
            session.clear()
            return jsonify({"ok": True, "user": None})

        return jsonify({"ok": True, "user": {"id": int(row["id"]), "username": row["username"], "email": row["email"]}})

    # -------------------------
    # Example data API (ledger entries)
    # -------------------------
    @app.get("/api/entries")
    def api_list_entries():
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        with get_conn() as conn:
            rows = query_all(
                conn,
                "SELECT id, entry_type, amount, note, created_at FROM entries WHERE user_id = ? ORDER BY id DESC",
                (user_id,),
            )

        return jsonify({"ok": True, "entries": [dict(r) for r in rows]})

    @app.post("/api/entries")
    def api_create_entry():
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        entry_type = (data.get("entry_type") or "").strip().lower()
        note = (data.get("note") or "").strip() or None
        amount = data.get("amount")

        if entry_type not in {"income", "expense"}:
            return jsonify({"error": "entry_type_invalid"}), 400

        if amount is None:
            return jsonify({"error": "amount_invalid"}), 400

        try:
            amount_val = float(amount)
        except Exception:
            return jsonify({"error": "amount_invalid"}), 400

        with get_conn() as conn:
            entry_id = exec_one(
                conn,
                "INSERT INTO entries (user_id, entry_type, amount, note) VALUES (?,?,?,?)",
                (user_id, entry_type, amount_val, note),
            )

        return jsonify({"ok": True, "entry": {"id": entry_id, "entry_type": entry_type, "amount": amount_val, "note": note}})

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)
