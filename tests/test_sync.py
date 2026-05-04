from dotenv import load_dotenv
load_dotenv()
from app import app

with app.app_context():
    from backend.services.ingestion.email_parser import sync_emails
    result = sync_emails()
    print("Result:", result)