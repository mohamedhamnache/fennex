from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_social_posts():
    return {"message": "Not implemented yet"}


@router.post("/generate", status_code=202)
async def generate_social_posts():
    return {"message": "Not implemented yet"}


@router.get("/{post_id}")
async def get_social_post(post_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{post_id}")
async def update_social_post(post_id: str):
    return {"message": "Not implemented yet"}
