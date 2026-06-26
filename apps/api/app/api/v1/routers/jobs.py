from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_jobs():
    return {"message": "Not implemented yet"}


@router.get("/{job_id}")
async def get_job(job_id: str):
    return {"message": "Not implemented yet"}


@router.post("/{job_id}/cancel", status_code=202)
async def cancel_job(job_id: str):
    return {"message": "Not implemented yet"}
