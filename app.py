# app.py
import os
from flask import Flask, render_template, request, jsonify, Response
import requests
from dotenv import load_dotenv
from datetime import datetime
from io import StringIO
import csv
from werkzeug.security import generate_password_hash, check_password_hash
from models import get_db, create_tables

load_dotenv()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, template_folder=os.path.join(BASE_DIR, "templates"))
create_tables()

# --- GROQ configuration (replaces DeepInfra) ---
# Official Groq chat completions endpoint (OpenAI-compatible)
API_URL = os.getenv("GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions")

# Required: read API key from environment (.env)
API_TOKEN = os.getenv("GROQ_API_KEY")
if not API_TOKEN:
    raise RuntimeError("GROQ_API_KEY is not set. Put your key in a .env file or set the env var.")

# Default model — can override with LLAMA_MODEL env var
MODEL_NAME = os.getenv("LLAMA_MODEL", "llama-3.3-70b-versatile")

SYSTEM_PROMPT = (
    "You are a careful, conservative medical assistant. Provide general observations, "
    "possible causes, red flags, and suggested next steps for a symptom log; do not give diagnosis. "
    "If an emergency is suspected, advise immediate medical attention. Keep the advice short and structured."
)
EMERGENCY_KEYWORDS = {"severe bleeding", "unconscious", "suicide", "self-harm", "chest pain"}

# --- Pages ---
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/symptoms")
def symptoms_page():
    return render_template("symptoms.html")

@app.route("/community")
def community_page():
    return render_template("community.html")


# ---------- AI query ----------
@app.route("/api/query", methods=["POST"])
def query_model():
    data = request.get_json() or {}
    user_text = (data.get("text") or "").strip()
    if not user_text:
        return jsonify({"error": "empty query"}), 400

    lower = user_text.lower()
    if any(k in lower for k in EMERGENCY_KEYWORDS):
        return jsonify({"reply": "⚠️ This may be an emergency. Please call your local emergency number immediately.", "emergency": True})

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text}
        ],
        "max_tokens": 400,
        "temperature": 0.2
    }
    headers = {"Content-Type": "application/json"}
    if API_TOKEN:
        headers["Authorization"] = f"Bearer {API_TOKEN}"

    try:
        resp = requests.post(API_URL, headers=headers, json=payload, timeout=20)
        resp.raise_for_status()
        out = resp.json()
        choice = (out.get("choices") or [{}])[0]
        # Groq OpenAI-compatible responses usually include choice.message.content
        msg = (choice.get("message") or {}).get("content") or choice.get("text") or out.get("message") or ""
        return jsonify({"reply": msg, "emergency": False})
    except Exception as e:
        # Keep error details to help debugging; remove or sanitize for production logs
        return jsonify({"error": "model request failed", "details": str(e)}), 502


# ---------- Symptoms CRUD ----------
@app.route("/api/symptoms/add", methods=["POST"])
def add_symptom():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    try:
        severity = int(data.get("severity") or 0)
    except:
        severity = 0
    notes = (data.get("notes") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400

    conn = get_db()
    conn.execute("INSERT INTO symptoms (name, severity, notes, date_added) VALUES (?, ?, ?, ?)",
                 (name, severity, notes, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/symptoms/list")
def list_symptoms():
    conn = get_db()
    rows = conn.execute("SELECT * FROM symptoms ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/symptoms/delete/<int:sid>", methods=["DELETE"])
def delete_symptom(sid):
    conn = get_db()
    conn.execute("DELETE FROM symptoms WHERE id = ?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/symptoms/analyze", methods=["POST"])
def analyze_symptoms():
    data = request.get_json() or {}
    limit = int(data.get("limit", 12))
    conn = get_db()
    rows = conn.execute("SELECT * FROM symptoms ORDER BY date_added DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    if not rows:
        return jsonify({"error": "no symptoms logged"}), 400

    entries = []
    for r in rows[::-1]:
        entries.append(f"- {r['date_added']}: {r['name']} (severity {r['severity']}/10){' — ' + r['notes'] if r['notes'] else ''}")
    prompt = (
        "Here is a user's recent symptom log. Provide a short structured summary:\n"
        "1) Brief overall impression (2-3 lines)\n"
        "2) Top possible causes (bullet list)\n"
        "3) Red flags / warning signs that require urgent care (bullet list)\n"
        "4) Practical next steps and self-care suggestions (bullet list)\n\n"
        "Symptom log:\n" + "\n".join(entries)
    )

    lower = " ".join([str(r["name"]).lower() + " " + (r["notes"] or "") for r in rows])
    if any(k in lower for k in EMERGENCY_KEYWORDS):
        return jsonify({"reply": "⚠️ Emergency-sounding entries found. Advise immediate medical attention." , "emergency": True})

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 500,
        "temperature": 0.2
    }
    headers = {"Content-Type": "application/json"}
    if API_TOKEN:
        headers["Authorization"] = f"Bearer {API_TOKEN}"

    try:
        resp = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        out = resp.json()
        choice = (out.get("choices") or [{}])[0]
        msg = (choice.get("message") or {}).get("content") or choice.get("text") or ""
        return jsonify({"reply": msg, "emergency": False})
    except Exception as e:
        return jsonify({"error": "analysis failed", "details": str(e)}), 502


@app.route("/api/symptoms/export")
def export_csv():
    conn = get_db()
    rows = conn.execute("SELECT * FROM symptoms ORDER BY date_added DESC").fetchall()
    conn.close()

    si = StringIO()
    cw = csv.writer(si)
    cw.writerow(["id", "name", "severity", "notes", "date_added"])
    for r in rows:
        cw.writerow([r["id"], r["name"], r["severity"], r["notes"], r["date_added"]])
    output = si.getvalue()
    return Response(output, mimetype="text/csv",
                    headers={"Content-Disposition": "attachment;filename=symptoms_export.csv"})


# ---------- Community module ----------
@app.route('/api/community/register', methods=['POST'])
def community_register():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400

    conn = get_db()
    exists = conn.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
    if exists:
        conn.close()
        return jsonify({'error': 'username taken'}), 409

    pw_hash = generate_password_hash(password)
    cur = conn.execute('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)',
                       (username, pw_hash, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    uid = cur.lastrowid
    conn.close()
    return jsonify({'success': True, 'user_id': uid})


@app.route('/api/community/login', methods=['POST'])
def community_login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400

    conn = get_db()
    row = conn.execute('SELECT id, password_hash FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    if not row or not check_password_hash(row['password_hash'], password):
        return jsonify({'error': 'invalid credentials'}), 401
    return jsonify({'success': True, 'user_id': row['id'], 'username': username})


@app.route('/api/community/posts', methods=['GET', 'POST'])
def community_posts():
    if request.method == 'GET':
        conn = get_db()
        rows = conn.execute(
            'SELECT p.id, p.user_id, COALESCE(u.username, "Anonymous") as username, p.content, p.created_at, '
            'COUNT(c.id) as comment_count '
            'FROM posts p LEFT JOIN comments c ON c.post_id = p.id LEFT JOIN users u ON u.id = p.user_id '
            'GROUP BY p.id ORDER BY p.created_at DESC'
        ).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    # POST -> create
    data = request.get_json() or {}
    content = (data.get('content') or '').strip()
    try:
        user_id = int(data.get('user_id') or 0)
    except:
        user_id = 0

    if not content:
        return jsonify({'error': 'content required'}), 400

    try:
        conn = get_db()
        cur = conn.execute('INSERT INTO posts (user_id, content, created_at) VALUES (?,?,?)',
                           (user_id if user_id > 0 else None, content, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
        conn.commit()
        pid = cur.lastrowid
        post = conn.execute('SELECT p.id, p.user_id, COALESCE(u.username,"Anonymous") as username, p.content, p.created_at FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?', (pid,)).fetchone()
        conn.close()
        return jsonify({'success': True, 'post': dict(post)})
    except Exception as e:
        print("Error creating post:", e)
        return jsonify({'error': 'server error creating post', 'details': str(e)}), 500

@app.route('/api/community/posts/<int:pid>/comments', methods=['GET', 'POST'])
def community_comments(pid):
    if request.method == 'GET':
        conn = get_db()
        rows = conn.execute('SELECT c.id, c.post_id, c.user_id, COALESCE(u.username, "Anonymous") as username, c.content, c.created_at '
                            'FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC', (pid,)).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    data = request.get_json() or {}
    content = (data.get('content') or '').strip()
    try:
        user_id = int(data.get('user_id') or 0)
    except:
        user_id = 0
    if not content:
        return jsonify({'error': 'content required'}), 400

    conn = get_db()
    conn.execute('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?,?,?,?)',
                 (pid, user_id if user_id > 0 else None, content, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/community/posts/<int:pid>', methods=['GET'])
def community_post_detail(pid):
    conn = get_db()
    post = conn.execute('SELECT p.id, p.content, p.created_at, COALESCE(u.username,"Anonymous") as username FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?', (pid,)).fetchone()
    comments = conn.execute('SELECT c.id, c.content, c.created_at, COALESCE(u.username,"Anonymous") as username FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC', (pid,)).fetchall()
    conn.close()
    if not post:
        return jsonify({'error': 'post not found'}), 404
    return jsonify({'post': dict(post), 'comments': [dict(c) for c in comments]})


if __name__ == "__main__":
    app.run(debug=True)
