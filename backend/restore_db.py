import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("DATABASE_URL not found in .env")
    exit(1)

# PostgreSQL engine
engine = create_engine(DATABASE_URL)

sql_file = "seed_database.sql"

if not os.path.exists(sql_file):
    print(f"File {sql_file} not found.")
    exit(1)

print(f"Reading {sql_file}...")
with open(sql_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Strip out psql specific commands (like \restrict) which SQLAlchemy doesn't understand
cleaned_lines = []
for line in lines:
    if line.strip().startswith('\\'):
        continue
    cleaned_lines.append(line)

sql_script = "".join(cleaned_lines)

print("Executing SQL script... This may take a moment.")
try:
    with engine.begin() as conn:
        conn.execute(text(sql_script))
    print("Database restored successfully!")
except Exception as e:
    print(f"Failed to restore database: {e}")
