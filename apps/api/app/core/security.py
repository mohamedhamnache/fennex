import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from cryptography.fernet import Fernet
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return {}


def _get_fernet() -> Fernet:
    key = settings.ENCRYPTION_KEY
    # Ensure key is valid base64 and 32 bytes
    try:
        decoded = base64.urlsafe_b64decode(key + "==")
        if len(decoded) < 32:
            decoded = decoded.ljust(32, b"\0")
        key = base64.urlsafe_b64encode(decoded[:32])
    except Exception:
        key = base64.urlsafe_b64encode(key.encode()[:32].ljust(32, b"\0"))
    return Fernet(key)


def encrypt_value(value: str) -> str:
    f = _get_fernet()
    return f.encrypt(value.encode()).decode()


def decrypt_value(encrypted: str) -> str:
    f = _get_fernet()
    return f.decrypt(encrypted.encode()).decode()


# Aliases used by older code
encrypt_api_key = encrypt_value
decrypt_api_key = decrypt_value


def encrypt_credentials(data: dict) -> str:
    """Encrypt a dict to a string using encrypt_value."""
    return encrypt_value(json.dumps(data))


def decrypt_credentials(encrypted: str) -> dict:
    """Decrypt a string back to a dict using decrypt_value."""
    return json.loads(decrypt_value(encrypted))
