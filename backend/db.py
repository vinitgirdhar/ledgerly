from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class DbConfig:
    db_path: Path


def default_db_path() -> Path:
    # Store the DB inside backend/ by default.
    here = Path(__file__).resolve().parent
    return here / "ledgerly.db"


def connect(db_path: Path) -> sqlite3.Connection:
    # Increase timeout to reduce "database is locked" errors under concurrent writes.
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 30000")  # 30s busy timeout
    return conn


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                entry_type TEXT NOT NULL CHECK(entry_type IN ('income','expense')),
                amount REAL NOT NULL,
                note TEXT,
                vendor_name TEXT,
                vendor_gstin TEXT,
                bill_number TEXT,
                bill_date TEXT,
                taxable_amount REAL,
                cgst_amount REAL,
                sgst_amount REAL,
                igst_amount REAL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);

            CREATE TABLE IF NOT EXISTS bills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                s3_key TEXT NOT NULL,
                s3_url TEXT,
                ocr_text TEXT,
                detected_amount REAL,
                vendor_name TEXT,
                bill_date TEXT,
                total_amount REAL,
                gst_amount REAL,
                items_json TEXT,
                status TEXT NOT NULL DEFAULT 'processing',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_bills_user_id ON bills(user_id);
            """
        )

        def add_column_if_missing(table: str, column: str, col_type: str) -> None:
            existing = conn.execute(f"PRAGMA table_info({table})").fetchall()
            cols = {row[1] for row in existing}
            if column not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")

        add_column_if_missing("bills", "vendor_name", "TEXT")
        add_column_if_missing("bills", "bill_date", "TEXT")
        add_column_if_missing("bills", "total_amount", "REAL")
        add_column_if_missing("bills", "gst_amount", "REAL")
        add_column_if_missing("bills", "items_json", "TEXT")

        # Entries table migrations (for GST ledger)
        add_column_if_missing("entries", "vendor_name", "TEXT")
        add_column_if_missing("entries", "vendor_gstin", "TEXT")
        add_column_if_missing("entries", "bill_number", "TEXT")
        add_column_if_missing("entries", "bill_date", "TEXT")
        add_column_if_missing("entries", "taxable_amount", "REAL")
        add_column_if_missing("entries", "cgst_amount", "REAL")
        add_column_if_missing("entries", "sgst_amount", "REAL")
        add_column_if_missing("entries", "igst_amount", "REAL")


def query_one(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    cur = conn.execute(sql, tuple(params))
    return cur.fetchone()


def query_all(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    cur = conn.execute(sql, tuple(params))
    return cur.fetchall()


def exec_one(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> int:
    cur = conn.execute(sql, tuple(params))
    if cur.lastrowid is None:
        raise RuntimeError("Expected lastrowid but got None")
    return int(cur.lastrowid)
