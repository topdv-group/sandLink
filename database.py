"""
database.py
------------
Database setup using Neon PostgreSQL + psycopg2.
"""

import os
import psycopg2
import psycopg2.extras
from werkzeug.security import generate_password_hash

DATABASE_URL = os.environ.get("DATABASE_URL")


def get_connection():
    """Open a new PostgreSQL connection with dict-like rows."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set.")
    conn = psycopg2.connect(DATABASE_URL)
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def init_db():
    """Create tables if they don't exist and seed initial data."""
    conn = get_connection()
    cur = conn.cursor()

    # --- sands table ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sands (
            id          SERIAL PRIMARY KEY,
            name        TEXT    NOT NULL,
            price       INTEGER NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            image       TEXT    NOT NULL DEFAULT '',
            active      INTEGER NOT NULL DEFAULT 1
        )
    """)

    # --- orders table ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id            SERIAL PRIMARY KEY,
            sand_id       INTEGER NOT NULL REFERENCES sands(id),
            customer_name TEXT    NOT NULL,
            phone         TEXT    NOT NULL,
            district      TEXT    NOT NULL,
            address       TEXT    NOT NULL,
            quantity      INTEGER NOT NULL,
            notes         TEXT    NOT NULL DEFAULT '',
            total_price   INTEGER NOT NULL,
            status        TEXT    NOT NULL DEFAULT 'New',
            created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # --- admins table ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id            SERIAL PRIMARY KEY,
            username      TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL
        )
    """)

    # --- Seed the 10 sand types (only if empty) ---
    cur.execute("SELECT COUNT(*) AS c FROM sands")
    if cur.fetchone()["c"] == 0:
        sands = [
            ("River sand",    15000, "Naturally washed river sand for general construction.", "river-sand.jpg"),
            ("Building sand", 12000, "All-purpose building sand for mortar and concrete.",    "building-sand.jpg"),
            ("Plaster sand",  14000, "Fine, clean sand ideal for smooth wall plastering.",     "plaster-sand.jpg"),
            ("Fine sand",     16000, "Very fine grain sand for finishing and screeding.",       "fine-sand.jpg"),
            ("Coarse sand",   13000, "Strong coarse sand for heavy concrete foundations.",      "coarse-sand.jpg"),
            ("Washed sand",   17000, "Thoroughly washed, low silt — best for quality concrete.","washed-sand.jpg"),
            ("Concrete sand", 14500, "Specially graded sand for structural concrete.",          "concrete-sand.jpg"),
            ("Filling sand",   9000, "Cheap bulk sand for land filling and levelling.",         "filling-sand.jpg"),
            ("Brick sand",    11000, "Good binding sand for brick laying and block work.",      "brick-sand.jpg"),
            ("Sharp sand",    15500, "Gritty sharp sand for floor screeds and paving.",         "sharp-sand.jpg"),
        ]
        for s in sands:
            cur.execute(
                "INSERT INTO sands (name, price, description, image) VALUES (%s, %s, %s, %s)",
                s
            )

    # --- Default admin ---
    cur.execute("SELECT COUNT(*) AS c FROM admins")
    if cur.fetchone()["c"] == 0:
        username = os.environ.get("ADMIN_USERNAME", "admin")
        password = os.environ.get("ADMIN_PASSWORD")
        if not password:
            password = "change-me-now"
            print("=" * 60)
            print("WARNING: ADMIN_PASSWORD not set. Using 'change-me-now'.")
            print("=" * 60)
        cur.execute(
            "INSERT INTO admins (username, password_hash) VALUES (%s, %s)",
            (username, generate_password_hash(password)),
        )
        print(f"Created default admin user: {username}")

    conn.commit()
    cur.close()
    conn.close()


def row_to_dict(row):
    return dict(row) if row is not None else None