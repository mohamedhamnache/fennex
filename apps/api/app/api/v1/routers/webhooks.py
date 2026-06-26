from fastapi import APIRouter

router = APIRouter()


@router.post("/stripe")
async def stripe_webhook():
    return {"message": "Not implemented yet"}


@router.post("/publishing")
async def publishing_webhook():
    return {"message": "Not implemented yet"}


@router.get("")
async def list_webhooks():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_webhook():
    return {"message": "Not implemented yet"}
