#!/usr/bin/env python3
"""
Generador de claves y hashes para SMART Validation.

Uso:
    python generate_keys.py --secret    Genera AUTH_SECRET_KEY
    python generate_keys.py --hash      Genera hash PBKDF2 de una contraseña
    python generate_keys.py --all       Genera ambos
    python generate_keys.py --verify    Verifica una contraseña contra un hash
"""

import getpass
import hashlib
import hmac
import os
import sys


def gen_secret(n_bytes: int = 48) -> str:
    return os.urandom(n_bytes).hex()


def pbkdf2_hash(plain: str, iters: int = 260_000) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


def pbkdf2_verify(plain: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def main() -> None:
    args = set(sys.argv[1:])

    if not args:
        print(__doc__)
        return

    if "--secret" in args or "--all" in args:
        print("\n── AUTH_SECRET_KEY ──────────────────────────────────────")
        print(gen_secret())
        print("(Pegar tal cual en Railway → Variables → AUTH_SECRET_KEY)")

    if "--hash" in args or "--all" in args:
        print("\n── Hash de contraseña ──────────────────────────────────")
        pwd = getpass.getpass("Contraseña: ")
        if not pwd:
            print("Error: contraseña vacía.")
            sys.exit(1)
        pwd2 = getpass.getpass("Confirmar: ")
        if pwd != pwd2:
            print("Error: las contraseñas no coinciden.")
            sys.exit(1)
        print(pbkdf2_hash(pwd))
        print("(Pegar en Railway → Variables → USER1_HASH)")

    if "--verify" in args:
        print("\n── Verificar contraseña ────────────────────────────────")
        stored = input("Hash almacenado (pbkdf2_sha256$...): ").strip()
        pwd = getpass.getpass("Contraseña a verificar: ")
        ok = pbkdf2_verify(pwd, stored)
        print("✓ Contraseña correcta." if ok else "✗ Contraseña incorrecta.")


if __name__ == "__main__":
    main()
