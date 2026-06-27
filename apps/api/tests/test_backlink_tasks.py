from app.workers.tasks.backlink_tasks import _is_spam


def test_is_spam_bad_tld():
    assert _is_spam("example.xyz", None) is True


def test_is_spam_keyword():
    assert _is_spam("casino-deals.com", 50.0) is True


def test_is_spam_low_da():
    assert _is_spam("legit.com", 3.0) is True


def test_not_spam():
    assert _is_spam("example.com", 40.0) is False
