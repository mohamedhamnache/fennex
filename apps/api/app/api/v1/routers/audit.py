from fastapi import APIRouter

router = APIRouter()


@router.post("", status_code=202)
async def trigger_audit():
    return {"message": "Not implemented yet"}


@router.get("/{audit_id}")
async def get_audit(audit_id: str):
    return {"message": "Not implemented yet"}


@router.get("/{audit_id}/issues")
async def list_audit_issues(audit_id: str):
    return {"message": "Not implemented yet"}


@router.get("/{audit_id}/summary")
async def get_audit_summary(audit_id: str):
    return {"message": "Not implemented yet"}
