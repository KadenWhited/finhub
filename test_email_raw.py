from dotenv import load_dotenv
load_dotenv()
from app import app

with app.app_context():
    from backend.services.ingestion.email_parser import fetch_emails, parse_transaction
    emails = fetch_emails(lookback_days=30)
    print(f"Financial emails found: {len(emails)}")
    for em in emails:
        tx = parse_transaction(em)
        if tx:
            print(f"  MATCH: {tx['type']} ${tx['amount']:.2f} — {tx['description']} [{tx['institution']}]")
        else:
            print(f"  SKIP:  {em['subject'][:60]}")