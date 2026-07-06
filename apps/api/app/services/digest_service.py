"""Weekly persona digest — composes and sends a per-project email summary
built from real analytics data, flavored by the project's onboarding persona."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.project import Project
from app.models.user import User
from app.services.analytics_service import (
    get_health_score,
    get_opportunities,
    get_overview,
)
from app.services.email_service import send_email

_PERSONA_INTRO = {
    "creator": "Here's what your audience did this week — and what to create next.",
    "ecommerce": "Here's how shoppers found your store this week — and where the revenue is hiding.",
    "freelancer": "Here's your market's pulse this week — insights you can take to clients.",
}

_PERSONA_CTA = {
    "creator": ("Write this week's article", "/articles"),
    "ecommerce": ("Open the product studio", "/images/studio?mode=create&intent=product"),
    "freelancer": ("Open the market report", "/analytics?ws=market"),
}


def _pct(v: float) -> str:
    return f"{v:+.0f}%"


async def compose_digest(project: Project, db: AsyncSession) -> tuple[str, str]:
    """Return (subject, html) for a project's weekly digest."""
    ov = await get_overview(project.id, project.org_id, "7d", db)
    health = await get_health_score(project.id, project.org_id, db)
    opps = await get_opportunities(project.id, project.org_id, db)

    persona = project.persona or "creator"
    intro = _PERSONA_INTRO.get(persona, _PERSONA_INTRO["creator"])
    cta_label, cta_path = _PERSONA_CTA.get(persona, _PERSONA_CTA["creator"])
    base_url = f"{settings.FRONTEND_URL}/{project.id}"

    subject = f"{project.name}: {ov.clicks:,} clicks this week ({_pct(ov.clicks_change)}) · Health {health.score}/100"

    top_opps = (opps.striking_distance + opps.ctr_wins)[:3]
    opps_html = "".join(
        f"<li style='margin-bottom:6px'><strong>{o.query}</strong> — position {o.position:.1f}, "
        f"<span style='color:#16a34a'>+{o.potential_clicks} potential clicks</span></li>"
        for o in top_opps
    ) or "<li>No opportunities detected yet — keep syncing.</li>"

    grade_color = "#16a34a" if health.score >= 65 else "#d97706" if health.score >= 45 else "#dc2626"

    from app.services.recommendation_service import summarize
    rec_summary = await summarize(project.id, project.org_id, db)
    if rec_summary["acted"]:
        standup_html = (
            "<div style='margin:16px 0;padding:12px 14px;background:#f8fafc;border-radius:12px;font-size:14px'>"
            f"<strong>Zerda</strong> — {rec_summary['acted']} recommendation(s) acted on, "
            f"{rec_summary['won']} won"
            + (f" (+{rec_summary['won_clicks']:,} clicks)" if rec_summary["won_clicks"] else "")
            + f", {rec_summary['measuring']} still measuring.</div>"
        )
    else:
        standup_html = ""

    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
  <div style="padding:24px 0 12px">
    <h2 style="margin:0 0 4px;font-size:20px">Your weekly Fennex digest</h2>
    <p style="margin:0;color:#64748b;font-size:14px">{project.name} · {intro}</p>
  </div>

  <table role="presentation" width="100%" style="border-collapse:separate;border-spacing:8px 0;margin:12px -8px">
    <tr>
      <td style="background:#f8fafc;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700">{ov.clicks:,}</div>
        <div style="font-size:12px;color:#64748b">Clicks ({_pct(ov.clicks_change)})</div>
      </td>
      <td style="background:#f8fafc;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700">{ov.impressions:,}</div>
        <div style="font-size:12px;color:#64748b">Impressions ({_pct(ov.impressions_change)})</div>
      </td>
      <td style="background:#f8fafc;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:{grade_color}">{health.score}</div>
        <div style="font-size:12px;color:#64748b">SEO health ({health.grade})</div>
      </td>
    </tr>
  </table>

  {standup_html}

  <h3 style="margin:20px 0 8px;font-size:15px">Top opportunities</h3>
  <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">{opps_html}</ul>

  <div style="margin:24px 0">
    <a href="{base_url}{cta_path}"
       style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
              padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">
      {cta_label} →
    </a>
    <a href="{base_url}/analytics" style="margin-left:12px;color:#4f46e5;font-size:13px">Open Analytics Studio</a>
  </div>

  <p style="color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px">
    Sent by Fennex · data from your Google Search Console sync
  </p>
</div>"""
    return subject, html


async def send_project_digest(project_id: uuid.UUID, db: AsyncSession) -> dict:
    """Compose and email the digest to every user in the project's org."""
    project = await db.get(Project, project_id)
    if project is None:
        return {"ok": False, "error": "Project not found", "sent": 0}

    subject, html = await compose_digest(project, db)

    users_result = await db.execute(select(User).where(User.org_id == project.org_id))
    recipients = [u.email for u in users_result.scalars().all() if u.email]

    if not settings.SENDGRID_API_KEY:
        return {
            "ok": False,
            "error": "Email is not configured (set SENDGRID_API_KEY).",
            "sent": 0,
            "recipients": recipients,
            "subject": subject,
        }

    sent = 0
    for email in recipients:
        if await send_email(email, subject, html):
            sent += 1
    return {"ok": sent > 0, "sent": sent, "recipients": recipients, "subject": subject}
