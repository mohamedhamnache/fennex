from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_articles():
    return {"message": "Not implemented yet"}


@router.post("/generate", status_code=202)
async def generate_article():
    return {"message": "Not implemented yet"}


@router.get("/{article_id}")
async def get_article(article_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{article_id}")
async def update_article(article_id: str):
    return {"message": "Not implemented yet"}


@router.post("/{article_id}/approve")
async def approve_article(article_id: str):
    return {"message": "Not implemented yet"}
