from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_brand_voices():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_brand_voice():
    return {"message": "Not implemented yet"}


@router.get("/{voice_id}")
async def get_brand_voice(voice_id: str):
    return {"message": "Not implemented yet"}


@router.post("/analyze", status_code=202)
async def analyze_brand_voice():
    return {"message": "Not implemented yet"}
