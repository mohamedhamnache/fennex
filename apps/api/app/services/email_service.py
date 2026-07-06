"""Transactional email via the SendGrid HTTP API (no SDK needed)."""
import httpx

from app.core.config import settings


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send one email. Returns False (no-op) when SENDGRID_API_KEY isn't set."""
    if not settings.SENDGRID_API_KEY or not to:
        return False
    payload = {
        "personalizations": [{"to": [{"email": to}]}],
        "from": {"email": settings.FROM_EMAIL, "name": "Fennex"},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
                json=payload,
            )
        return resp.status_code in (200, 202)
    except Exception:
        return False
