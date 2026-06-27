"""phase11_backlink_models

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-27 00:00:00.000000

Creates tables: backlink_profiles, backlinks, backlink_opportunities, exchange_listings, exchange_requests, exchange_messages
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "g2b3c4d5e6f7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS backlink_profiles ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  domain VARCHAR(255), "
        "  total_backlinks INTEGER NOT NULL DEFAULT 0, "
        "  domain_authority FLOAT, "
        "  trust_score FLOAT, "
        "  spam_score FLOAT, "
        "  referring_domains INTEGER NOT NULL DEFAULT 0, "
        "  last_synced_at VARCHAR(50), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS backlinks ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  profile_id UUID NOT NULL REFERENCES backlink_profiles(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  source_url VARCHAR(2048) NOT NULL, "
        "  source_domain VARCHAR(255), "
        "  target_url VARCHAR(2048), "
        "  anchor_text VARCHAR(500), "
        "  domain_authority FLOAT, "
        "  trust_score FLOAT, "
        "  spam_score FLOAT, "
        "  is_spam BOOLEAN NOT NULL DEFAULT FALSE, "
        "  link_type VARCHAR(20) NOT NULL DEFAULT 'dofollow', "
        "  first_seen VARCHAR(20), "
        "  last_seen VARCHAR(20), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_backlink_project_source UNIQUE (project_id, source_url) "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_backlinks_project_id ON backlinks(project_id);"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_backlinks_is_spam ON backlinks(project_id, is_spam);"))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS backlink_opportunities ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  source_domain VARCHAR(255), "
        "  source_url VARCHAR(2048) NOT NULL, "
        "  domain_authority FLOAT, "
        "  trust_score FLOAT, "
        "  spam_score FLOAT, "
        "  is_spam BOOLEAN NOT NULL DEFAULT FALSE, "
        "  linking_to_competitor VARCHAR(255), "
        "  status VARCHAR(20) NOT NULL DEFAULT 'new', "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_opportunity_project_source UNIQUE (project_id, source_url) "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_backlink_opportunities_project_status ON backlink_opportunities(project_id, status);"))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS exchange_listings ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  site_url VARCHAR(2048) NOT NULL, "
        "  niche VARCHAR(100), "
        "  language VARCHAR(10), "
        "  domain_authority FLOAT, "
        "  description TEXT, "
        "  is_active BOOLEAN NOT NULL DEFAULT TRUE, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS exchange_requests ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  requester_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  target_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  requester_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  target_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  status VARCHAR(20) NOT NULL DEFAULT 'pending', "
        "  requester_url VARCHAR(2048), "
        "  target_url VARCHAR(2048), "
        "  requester_link_verified BOOLEAN NOT NULL DEFAULT FALSE, "
        "  target_link_verified BOOLEAN NOT NULL DEFAULT FALSE, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_exchange_request_pair UNIQUE (requester_project_id, target_project_id) "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_exchange_requests_requester ON exchange_requests(requester_project_id);"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_exchange_requests_target ON exchange_requests(target_project_id);"))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS exchange_messages ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  request_id UUID NOT NULL REFERENCES exchange_requests(id) ON DELETE CASCADE, "
        "  sender_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  body TEXT NOT NULL, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_exchange_messages_request ON exchange_messages(request_id, created_at);"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS exchange_messages;"))
    op.execute(sa.text("DROP TABLE IF EXISTS exchange_requests;"))
    op.execute(sa.text("DROP TABLE IF EXISTS exchange_listings;"))
    op.execute(sa.text("DROP TABLE IF EXISTS backlink_opportunities;"))
    op.execute(sa.text("DROP TABLE IF EXISTS backlinks;"))
    op.execute(sa.text("DROP TABLE IF EXISTS backlink_profiles;"))
