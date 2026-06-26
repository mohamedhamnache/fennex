from fastapi import APIRouter

router = APIRouter()


@router.post("/generate", status_code=202)
async def generate_image():
    return {"message": "Not implemented yet"}


@router.get("")
async def list_images():
    return {"message": "Not implemented yet"}


@router.get("/{image_id}")
async def get_image(image_id: str):
    return {"message": "Not implemented yet"}


@router.delete("/{image_id}", status_code=204)
async def delete_image(image_id: str):
    return {"message": "Not implemented yet"}
