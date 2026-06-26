from typing import Any, List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://fennex:fennex@localhost:5432/fennex"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Auth
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Encryption key for sensitive data (API keys, credentials)
    ENCRYPTION_KEY: str = "change-me-32-bytes-base64-encoded=="

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001"]

    # Storage
    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_ENDPOINT_URL: str = ""

    # Email
    SENDGRID_API_KEY: str = ""
    FROM_EMAIL: str = "noreply@fennex.ai"

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # Internal service URLs
    CRAWLER_SERVICE_URL: str = "http://crawler:8001"
    CRAWLER_URL: str = "http://crawler:8001"  # alias used by worker tasks
    IMAGE_GEN_SERVICE_URL: str = "http://image-gen:8002"

    @property
    def REDIS_SETTINGS(self) -> Any:
        from arq.connections import RedisSettings
        return RedisSettings.from_dsn(self.REDIS_URL)


settings = Settings()
