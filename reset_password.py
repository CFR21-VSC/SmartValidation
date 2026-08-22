"""
Resetea la contraseña del usuario admin en la DB y en el .env
Ejecutar con: python reset_password.py
"""
import hashlib, os, sqlite3, re, getpass

ROOT     = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(ROOT, "data", "smart_validation.db")
ENV_PATH = os.path.join(ROOT, "SMART_Validation", ".env")


def pbkdf2_hash(plain: str, iters: int = 260000) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


def main():
    print("=" * 55)
    print("  Reset de contraseña — SMART Validation")
    print("=" * 55)
    print()

    # Mostrar usuarios existentes
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    users = db.execute(
        "SELECT username, display_name, role FROM users WHERE role='admin' ORDER BY username"
    ).fetchall()
    print("Usuarios admin disponibles:")
    for u in users:
        print(f"  [{u['username']}]  {u['display_name']}")
    print()

    username = input("Usuario a resetear (Enter = admin): ").strip() or "admin"
    row = db.execute(
        "SELECT username FROM users WHERE username=?", (username,)
    ).fetchone()
    if not row:
        print(f"[ERROR] Usuario '{username}' no encontrado en la DB.")
        db.close()
        return

    new_pass = getpass.getpass(f"Nueva contraseña para '{username}': ")
    if len(new_pass) < 6:
        print("[ERROR] La contraseña debe tener al menos 6 caracteres.")
        db.close()
        return
    confirm = getpass.getpass("Confirmar contraseña: ")
    if new_pass != confirm:
        print("[ERROR] Las contraseñas no coinciden.")
        db.close()
        return

    new_hash = pbkdf2_hash(new_pass)

    # Actualizar DB
    db.execute("UPDATE users SET password_hash=? WHERE username=?", (new_hash, username))
    db.commit()
    db.close()
    print(f"\n[OK] Contraseña actualizada en DB para '{username}'.")

    # Actualizar .env si el usuario es admin y existe USER1_HASH
    if username == "admin" and os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            env_content = f.read()

        if "USER1_HASH=" in env_content:
            env_content = re.sub(
                r"^USER1_HASH=.*$",
                f"USER1_HASH={new_hash}",
                env_content,
                flags=re.MULTILINE
            )
            with open(ENV_PATH, "w", encoding="utf-8") as f:
                f.write(env_content)
            print(f"[OK] USER1_HASH actualizado en .env")

    print()
    print("=" * 55)
    print(f"  Listo. Para acceso web: usuario='{username}', contraseña=la que ingresaste.")
    print(f"  Via INICIAR.bat no se requiere login (ALLOW_NO_AUTH=true).")
    print("=" * 55)


if __name__ == "__main__":
    main()
