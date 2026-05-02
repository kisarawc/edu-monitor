from database import engine, Base, SessionLocal
import models
import os
from sqlalchemy import text

Base.metadata.create_all(bind=engine)
print("Tables created successfully")

# Auto-seed the database if seed_database.sql exists
sql_file = "seed_database.sql"
if os.path.exists(sql_file):
    print("Checking if database needs seeding...")
    db = SessionLocal()
    try:
        # Check if users table is empty
        result = db.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if result == 0:
            print("Database is empty. Automatically loading seed data from seed_database.sql...")
            with open(sql_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Strip out psql specific commands which SQLAlchemy doesn't understand
            cleaned_lines = []
            for line in lines:
                if line.strip().startswith('\\'):
                    continue
                cleaned_lines.append(line)
            
            sql_script = "".join(cleaned_lines)
            
            print("Executing SQL script... This may take a moment.")
            with engine.begin() as conn:
                conn.execute(text(sql_script))
            print("Seed data loaded successfully!")
        else:
            print("Database already contains data. Skipping seed.")
    except Exception as e:
        print(f"Failed to load seed data: {e}")
    finally:
        db.close()
