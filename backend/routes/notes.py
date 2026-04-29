from flask import Blueprint, request, jsonify
from backend.models.database import get_db

notes_bp = Blueprint('notes', __name__)

@notes_bp.route('/', methods=['GET'])
def get_notes():
    db = get_db()
    notes = db.execute('SELECT * FROM notes ORDER BY date DESC').fetchall()
    db.close()
    return jsonify([dict(n) for n in notes])

@notes_bp.route('/<date>', methods=['GET'])
def get_note(date):
    db = get_db()
    note = db.execute('SELECT * FROM notes WHERE date = ?', (date,)).fetchone()
    db.close()
    if not note:
        return jsonify({'date': date, 'content': '', 'mood': None}), 200
    return jsonify(dict(note))

@notes_bp.route('/', methods=['POST'])
def save_note():
    data = request.get_json()
    if not data.get('date') or not data.get('content'):
        return jsonify({'error': 'date and content required'}), 400
    db = get_db()
    db.execute('''
        INSERT INTO notes (date, content, mood)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            content = excluded.content,
            mood = excluded.mood,
            updated_at = datetime('now')
    ''', (data['date'], data['content'], data.get('mood')))
    db.commit()
    note = db.execute('SELECT * FROM notes WHERE date = ?', (data['date'],)).fetchone()
    db.close()
    return jsonify(dict(note)), 200

@notes_bp.route('/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    db = get_db()
    db.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': note_id})