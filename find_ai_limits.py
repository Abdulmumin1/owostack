import time

try:
    from googlesearch import search
except ImportError:
    print("Please install the required library first: pip install googlesearch-python")
    exit(1)


def get_ai_limits_info():
    """
    Searches Google for the official documentation pages
    regarding the rate limits of ChatGPT Plus, Claude Pro, and Perplexity Pro.
    """
    queries = {
        "OpenAI ChatGPT Plus": 'site:help.openai.com "usage limits" "every 3 hours"',
        "Anthropic Claude Pro": 'site:support.anthropic.com "Claude Pro usage" limit',
        "Perplexity Pro": 'site:perplexity.ai/hub/faq "Pro search" daily limit',
    }

    results = {}

    print("Searching for official documentation on AI premium limits...\n")
    for platform, query in queries.items():
        print(f"--- Searching for {platform} ---")
        platform_results = []
        try:
            # Setting advanced=True returns dictionaries/objects with title, url, description
            search_results = search(
                query, num_results=3, advanced=True, sleep_interval=2
            )
            for res in search_results:
                platform_results.append(
                    {"title": res.title, "url": res.url, "description": res.description}
                )
                print(f"Found: {res.title}")
                print(f"URL: {res.url}")
                print(f"Snippet: {res.description}\n")
            results[platform] = platform_results
        except Exception as e:
            print(f"Error searching for {platform}: {e}\n")
            results[platform] = str(e)

    return results


if __name__ == "__main__":
    get_ai_limits_info()
