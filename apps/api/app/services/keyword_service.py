from collections import defaultdict

STOPWORDS = {
    "a", "an", "the", "is", "in", "on", "at", "to", "for", "of", "and", "or",
    "with", "how", "what", "why", "best", "top", "free", "new", "2024", "2025",
}


def _get_cluster_key_for(kw: str) -> str:
    """
    Returns the cluster key (most significant non-stopword token) for a keyword.
    Module-level so worker tasks can import it directly.
    """
    tokens = kw.lower().split()
    significant = [t for t in tokens if t not in STOPWORDS and len(t) > 2]
    return significant[0] if significant else tokens[0]


def cluster_keywords(keywords: list[str]) -> dict[str, list[str]]:
    """
    Simple word-overlap clustering. Groups keywords that share their
    most significant non-stopword token.
    Returns: {cluster_name: [keyword, ...]}
    """
    groups: dict[str, list[str]] = defaultdict(list)
    for kw in keywords:
        key = _get_cluster_key_for(kw)
        groups[key].append(kw)
    return dict(groups)
