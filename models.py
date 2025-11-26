import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(__file__), "symptoms.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def create_tables():
    conn = get_db()

    # Symptoms Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS symptoms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            severity INTEGER,
            notes TEXT,
            date_added TEXT
        );
    """)

    # Users Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            created_at TEXT
        );
    """)

    # Posts Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            content TEXT,
            created_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)

    # Comments Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            user_id INTEGER,
            content TEXT,
            created_at TEXT,
            FOREIGN KEY (post_id) REFERENCES posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)

    conn.commit()
    conn.close()
