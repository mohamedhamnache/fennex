from app.schemas.backlinks import (
    BacklinkProfileOut, BacklinkOut, BacklinkOpportunityOut,
    OpportunityStatusUpdate, AnalyzeResponse,
)

def test_analyze_response():
    r = AnalyzeResponse(job_id="abc", status="queued")
    assert r.job_id == "abc"
    assert r.status == "queued"

def test_opportunity_status_update():
    u = OpportunityStatusUpdate(status="contacted")
    assert u.status == "contacted"
