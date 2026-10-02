"""
app.py
------
All Flask routes and JSON APIs.

Public:
  GET  /api/sands
  POST /api/orders

Admin (session based):
  POST   /api/admin/login
  POST   /api/admin/logout
  GET    /api/admin/orders?status=&search=
  PATCH  /api/admin/orders/<id>
  DELETE /api/admin/orders/<id>
  GET    /api/admin/stats
  GET    /api/admin/sands
  PUT    /api/admin/sands/<id>
  GET    /admin
  GET    /admin/dashboard

Database: Neon PostgreSQL (via database.py)
"""

import os
import re
import time
from collections import defaultdict

from flask import (
    Flask, request, jsonify, session, send_from_directory, redirect
)
from werkzeug.security import check_password_hash

from database import get_connection, init_db, row_to_dict

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

# Secret key for session cookies. Falls back to a dev value but warns loudly.
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")
if app.secret_key == "dev-secret-change-me":
    print("WARNING: SECRET_KEY not set. Using an insecure dev key.")

# Secure cookie flags
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False,   # set True once you serve over HTTPS
)

# Create tables + seed data on import (works with PostgreSQL now)
init_db()


# ---------------------------------------------------------------------------
# Simple in-memory login attempt limiter
# ---------------------------------------------------------------------------
_login_attempts = defaultdict(list)   # { ip: [timestamp, ...] }
MAX_ATTEMPTS = 5
BLOCK_SECONDS = 5 * 60                # 5 minutes


def _client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _is_blocked(ip):
    now = time.time()
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < BLOCK_SECONDS]
    return len(_login_attempts[ip]) >= MAX_ATTEMPTS


def _record_failure(ip):
    _login_attempts[ip].append(time.time())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
PHONE_RE = re.compile(r"^(?:\+2507\d{8}|07\d{8})$")


def _is_logged_in():
    return bool(session.get("admin_id"))


def _error(message, code=400):
    return jsonify({"error": message}), code


# ---------------------------------------------------------------------------
# Static page routes
# ---------------------------------------------------------------------------
@app.route("/")
def home():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/order.html")
def order_page():
    return send_from_directory(FRONTEND_DIR, "order.html")


# ---------------------------------------------------------------------------
# Admin page routes
# ---------------------------------------------------------------------------
@app.route("/admin")
@app.route("/admin/")
def admin_root():
    if _is_logged_in():
        return redirect("/admin/dashboard")
    return send_from_directory(os.path.join(FRONTEND_DIR, "admin"), "login.html")


@app.route("/admin/dashboard")
def admin_dashboard():
    if not _is_logged_in():
        return redirect("/admin")
    return send_from_directory(os.path.join(FRONTEND_DIR, "admin"), "dashboard.html")


# ---------------------------------------------------------------------------
# Public API: sands
# ---------------------------------------------------------------------------
@app.get("/api/sands")
def api_sands():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, name, price, description, image FROM sands WHERE active = 1 ORDER BY id"
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Public API: create order
# ---------------------------------------------------------------------------
@app.post("/api/orders")
def api_create_order():
    data = request.get_json(silent=True) or {}

    # --- Collect and trim inputs ---
    sand_id  = data.get("sand_id")
    name     = (data.get("customer_name") or "").strip()
    phone    = (data.get("phone") or "").strip().replace(" ", "")
    district = (data.get("district") or "").strip()
    address  = (data.get("address") or "").strip()
    quantity = data.get("quantity")
    notes    = (data.get("notes") or "").strip()

    # --- Validation ---
    errors = {}

    if not name:
        errors["customer_name"] = "Full name is required."
    elif len(name) > 100:
        errors["customer_name"] = "Name must be 100 characters or less."

    if not phone:
        errors["phone"] = "Phone number is required."
    elif not PHONE_RE.match(phone):
        errors["phone"] = "Enter a valid Rwandan number (e.g. 0788123456 or +250788123456)."

    if not district:
        errors["district"] = "District is required."

    if not address:
        errors["address"] = "Address is required."

    try:
        quantity_int = int(quantity)
        if quantity_int < 1 or quantity_int > 50:
            errors["quantity"] = "Quantity must be between 1 and 50 trucks."
    except (TypeError, ValueError):
        errors["quantity"] = "Quantity must be a whole number."

    if len(notes) > 500:
        errors["notes"] = "Notes must be 500 characters or less."

    if not sand_id:
        errors["sand_id"] = "Sand type is required."

    if errors:
        return jsonify({"error": "Validation failed", "fields": errors}), 400

    # --- Look up sand in the DB (NEVER trust a price from the browser) ---
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, name, price FROM sands WHERE id = %s AND active = 1",
        (sand_id,),
    )
    sand = cur.fetchone()

    if sand is None:
        cur.close()
        conn.close()
        return _error("Selected sand type is not available.", 400)

    total_price = sand["price"] * quantity_int

    cur.execute(
        """
        INSERT INTO orders
            (sand_id, customer_name, phone, district, address,
             quantity, notes, total_price, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'New')
        RETURNING id
        """,
        (sand_id, name, phone, district, address,
         quantity_int, notes, total_price),
    )
    new_id = cur.fetchone()["id"]
    conn.commit()
    cur.close()
    conn.close()

    return jsonify({
        "message": "Order placed successfully.",
        "order_number": f"#{1000 + new_id}",
        "order_id": new_id,
        "total_price": total_price,
    }), 201


# ---------------------------------------------------------------------------
# Admin API: auth
# ---------------------------------------------------------------------------
@app.post("/api/admin/login")
def api_admin_login():
    ip = _client_ip()
    if _is_blocked(ip):
        return _error("Too many failed attempts. Try again in 5 minutes.", 429)

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return _error("Username and password are required.", 400)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, username, password_hash FROM admins WHERE username = %s",
        (username,),
    )
    admin = cur.fetchone()
    cur.close()
    conn.close()

    if admin is None or not check_password_hash(admin["password_hash"], password):
        _record_failure(ip)
        return _error("Invalid username or password.", 401)

    _login_attempts.pop(ip, None)
    session["admin_id"] = admin["id"]
    session["admin_username"] = admin["username"]
    return jsonify({"message": "Logged in", "username": admin["username"]})


@app.post("/api/admin/logout")
def api_admin_logout():
    session.clear()
    return jsonify({"message": "Logged out"})


# ---------------------------------------------------------------------------
# Admin API: orders
# ---------------------------------------------------------------------------
@app.get("/api/admin/orders")
def api_admin_orders():
    if not _is_logged_in():
        return _error("Not logged in.", 401)

    status = request.args.get("status", "").strip()
    search = request.args.get("search", "").strip()

    query = """
        SELECT o.id, o.customer_name, o.phone, o.district, o.address,
               o.quantity, o.notes, o.total_price, o.status, o.created_at,
               s.name AS sand_name
        FROM orders o
        JOIN sands s ON s.id = o.sand_id
        WHERE 1 = 1
    """
    params = []

    if status and status != "All":
        query += " AND o.status = %s"
        params.append(status)

    if search:
        query += " AND (o.customer_name ILIKE %s OR o.phone LIKE %s)"
        like = f"%{search}%"
        params.extend([like, like])

    query += " ORDER BY o.id DESC"

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    # Convert datetime objects to strings so jsonify is happy
    result = []
    for r in rows:
        d = dict(r)
        if d.get("created_at") is not None:
            d["created_at"] = d["created_at"].strftime("%Y-%m-%d %H:%M:%S")
        result.append(d)
    return jsonify(result)


@app.patch("/api/admin/orders/<int:order_id>")
def api_admin_update_order(order_id):
    if not _is_logged_in():
        return _error("Not logged in.", 401)

    data = request.get_json(silent=True) or {}
    new_status = (data.get("status") or "").strip()
    allowed = {"New", "Confirmed", "Delivered", "Cancelled"}

    if new_status not in allowed:
        return _error("Status must be one of: New, Confirmed, Delivered, Cancelled.", 400)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE orders SET status = %s WHERE id = %s",
        (new_status, order_id),
    )
    conn.commit()
    changed = cur.rowcount
    cur.close()
    conn.close()

    if changed == 0:
        return _error("Order not found.", 404)
    return jsonify({"message": "Order updated.", "status": new_status})


@app.delete("/api/admin/orders/<int:order_id>")
def api_admin_delete_order(order_id):
    if not _is_logged_in():
        return _error("Not logged in.", 401)

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM orders WHERE id = %s", (order_id,))
    conn.commit()
    changed = cur.rowcount
    cur.close()
    conn.close()

    if changed == 0:
        return _error("Order not found.", 404)
    return jsonify({"message": "Order deleted."})


@app.get("/api/admin/stats")
def api_admin_stats():
    if not _is_logged_in():
        return _error("Not logged in.", 401)

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS c FROM orders")
    total = cur.fetchone()["c"]

    cur.execute("SELECT COUNT(*) AS c FROM orders WHERE status = 'New'")
    new_orders = cur.fetchone()["c"]

    cur.execute("SELECT COUNT(*) AS c FROM orders WHERE status = 'Delivered'")
    delivered = cur.fetchone()["c"]

    cur.execute("SELECT COALESCE(SUM(total_price), 0) AS s FROM orders WHERE status = 'Delivered'")
    revenue = cur.fetchone()["s"]

    cur.close()
    conn.close()

    return jsonify({
        "total_orders": total,
        "new_orders": new_orders,
        "delivered_orders": delivered,
        "delivered_revenue": int(revenue) if revenue is not None else 0,
    })


# ---------------------------------------------------------------------------
# Admin API: sands management
# ---------------------------------------------------------------------------
@app.get("/api/admin/sands")
def api_admin_sands():
    if not _is_logged_in():
        return _error("Not logged in.", 401)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, price, description, image, active FROM sands ORDER BY id")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])


@app.put("/api/admin/sands/<int:sand_id>")
def api_admin_update_sand(sand_id):
    if not _is_logged_in():
        return _error("Not logged in.", 401)

    data = request.get_json(silent=True) or {}
    price = data.get("price")
    description = data.get("description", "")
    active = data.get("active")

    try:
        price_int = int(price)
        if price_int < 0 or price_int > 10_000_000:
            raise ValueError
    except (TypeError, ValueError):
        return _error("Price must be a whole number between 0 and 10,000,000.", 400)

    if not isinstance(description, str) or len(description) > 500:
        return _error("Description must be text under 500 characters.", 400)

    active_int = 1 if active in (1, True, "1", "true") else 0

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE sands SET price = %s, description = %s, active = %s WHERE id = %s",
        (price_int, description, active_int, sand_id),
    )
    conn.commit()
    changed = cur.rowcount
    cur.close()
    conn.close()

    if changed == 0:
        return _error("Sand not found.", 404)
    return jsonify({"message": "Sand updated."})


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return _error("Not found.", 404)
    return "Not found", 404


@app.errorhandler(500)
def server_error(e):
    if request.path.startswith("/api/"):
        return _error("Something went wrong on the server.", 500)
    return "Server error", 500


#THE FOLLOWING IS THE ENDPOINT THAT WILL KEEP NEON NOT SLEEPING WHEN THERE ARE NO REQUESTS FOR A LONG TIME
@app.route("/healthz")
def healthz():
    """Lightweight endpoint that pings the DB to keep Neon warm."""
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")  # This simple query wakes Neon
        cur.fetchone()
        cur.close()
        conn.close()
        return {"status": "ok", "db": "awake"}, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500

    
# ---------------------------------------------------------------------------
# Run (dev only — Render uses gunicorn app:app)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="127.0.0.1", port=5000, debug=debug)