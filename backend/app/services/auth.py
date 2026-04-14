import hashlib
import hmac
import os
from base64 import urlsafe_b64decode, urlsafe_b64encode

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User

PBKDF2_ITERATIONS = 100_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{PBKDF2_ITERATIONS}${urlsafe_b64encode(salt).decode()}${urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    iterations_str, salt_b64, digest_b64 = stored_hash.split("$", maxsplit=2)
    salt = urlsafe_b64decode(salt_b64.encode())
    expected_digest = urlsafe_b64decode(digest_b64.encode())
    actual_digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        int(iterations_str),
    )
    return hmac.compare_digest(actual_digest, expected_digest)


def get_user_by_username(db: Session, username: str) -> User | None:
    statement = select(User).where(User.username == username)
    return db.scalar(statement)


def list_users(db: Session) -> list[User]:
    statement = select(User).order_by(User.username.asc())
    return list(db.scalars(statement))


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = get_user_by_username(db, username)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_admin_user(db: Session, username: str, password: str) -> User:
    return create_user(db, username, password, role="admin", is_active=True)


def create_user(db: Session, username: str, password: str, *, role: str = "admin", is_active: bool = True) -> User:
    normalized_username = username.strip()
    if not normalized_username:
        raise ValueError("Benutzername darf nicht leer sein")
    if get_user_by_username(db, normalized_username) is not None:
        raise ValueError("Benutzername existiert bereits")
    if len(password) < 8:
        raise ValueError("Passwort muss mindestens 8 Zeichen lang sein")

    user = User(
        username=normalized_username,
        password_hash=hash_password(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, *, role: str | None = None, is_active: bool | None = None) -> User:
    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user_password(db: Session, user: User, password: str) -> User:
    if len(password) < 8:
        raise ValueError("Passwort muss mindestens 8 Zeichen lang sein")
    user.password_hash = hash_password(password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()
