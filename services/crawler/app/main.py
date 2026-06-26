from fastapi import FastAPI
from pydantic import BaseModel, HttpUrl

from app.crawler import crawl

app = FastAPI(title="Fennex Crawler", version="0.1.0")


class CrawlRequest(BaseModel):
    url: HttpUrl


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/crawl")
async def crawl_url(request: CrawlRequest):
    return await crawl(str(request.url))
