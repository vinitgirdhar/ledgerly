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
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
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
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);
            """
        )


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
