from app.services.discovery.crawl_map import select_urls


def test_select_prioritises_key_pages_and_caps():
    home = "https://acme.test"
    page = {"internal_links": [
        {"href": "https://acme.test/about", "text": "About"},
        {"href": "https://acme.test/blog/post-1", "text": "Post"},
        {"href": "https://acme.test/shop", "text": "Shop"},
        {"href": "https://other.test/x", "text": "Off"},
        {"href": "https://acme.test/random-1", "text": "R1"},
        {"href": "https://acme.test/random-2", "text": "R2"},
    ]}
    urls = select_urls(home, page, max_pages=4)
    assert urls[0] == home
    assert "https://acme.test/about" in urls
    assert "https://acme.test/shop" in urls
    assert "https://other.test/x" not in urls  # off-domain excluded
    assert len(urls) == 4
