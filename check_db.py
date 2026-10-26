from database import engine
from sqlalchemy import text

with engine.connect() as c:
    print("DB aur port:")
    print(c.execute(text("select current_database(), inet_server_port()")).fetchall())

    print("\nTables kis schema me hain:")
    print(c.execute(text(
        "select table_schema, table_name from information_schema.tables "
        "where table_name in ('users', 'predictions')"
    )).fetchall())

    print("\nUsers table ki rows:")
    print(c.execute(text(
        "select id, email, role, left(hashed_password, 7) from users"
    )).fetchall())