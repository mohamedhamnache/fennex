from enum import Enum
from typing import Set


class Role(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    SEO_MANAGER = "seo_manager"
    CONTENT_WRITER = "content_writer"
    EDITOR = "editor"
    DESIGNER = "designer"
    MARKETING_MANAGER = "marketing_manager"
    VIEWER = "viewer"


class Permission(str, Enum):
    # Organization
    ORG_MANAGE = "org:manage"
    ORG_BILLING = "org:billing"
    ORG_MEMBERS_MANAGE = "org:members:manage"

    # Projects
    PROJECT_CREATE = "project:create"
    PROJECT_DELETE = "project:delete"
    PROJECT_SETTINGS = "project:settings"

    # Content
    CONTENT_GENERATE = "content:generate"
    CONTENT_EDIT = "content:edit"
    CONTENT_APPROVE = "content:approve"
    CONTENT_PUBLISH = "content:publish"

    # SEO
    SEO_RESEARCH = "seo:research"
    SEO_AUDIT = "seo:audit"

    # Analytics
    ANALYTICS_VIEW = "analytics:view"

    # API Keys
    API_KEYS_MANAGE = "apikeys:manage"

    # Backlinks
    BACKLINKS_MANAGE = "backlinks:manage"


# Role → set of permissions
ROLE_PERMISSIONS: dict[Role, Set[Permission]] = {
    Role.OWNER: set(Permission),  # all permissions
    Role.ADMIN: {
        Permission.ORG_MEMBERS_MANAGE,
        Permission.PROJECT_CREATE,
        Permission.PROJECT_DELETE,
        Permission.PROJECT_SETTINGS,
        Permission.CONTENT_GENERATE,
        Permission.CONTENT_EDIT,
        Permission.CONTENT_APPROVE,
        Permission.CONTENT_PUBLISH,
        Permission.SEO_RESEARCH,
        Permission.SEO_AUDIT,
        Permission.ANALYTICS_VIEW,
        Permission.API_KEYS_MANAGE,
        Permission.BACKLINKS_MANAGE,
    },
    Role.SEO_MANAGER: {
        Permission.SEO_RESEARCH,
        Permission.SEO_AUDIT,
        Permission.CONTENT_GENERATE,
        Permission.CONTENT_EDIT,
        Permission.ANALYTICS_VIEW,
        Permission.BACKLINKS_MANAGE,
    },
    Role.CONTENT_WRITER: {
        Permission.CONTENT_GENERATE,
        Permission.CONTENT_EDIT,
        Permission.SEO_RESEARCH,
    },
    Role.EDITOR: {
        Permission.CONTENT_EDIT,
        Permission.CONTENT_APPROVE,
    },
    Role.DESIGNER: {
        Permission.CONTENT_EDIT,
    },
    Role.MARKETING_MANAGER: {
        Permission.CONTENT_GENERATE,
        Permission.CONTENT_EDIT,
        Permission.CONTENT_APPROVE,
        Permission.CONTENT_PUBLISH,
        Permission.ANALYTICS_VIEW,
    },
    Role.VIEWER: {
        Permission.ANALYTICS_VIEW,
    },
}


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
