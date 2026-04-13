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


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = get_user_by_username(db, username)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_admin_user(db: Session, username: str, password: str) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password),
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
