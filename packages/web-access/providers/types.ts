/** One search result, in the shape map ticket 04 fixed: all four keys, always. */
export type SearchResult = { title: string; url: string; snippet: string; content: string };

export type SearchOptions = {
	numResults: number;
	timeoutMs: number;
	signal?: AbortSignal;
	/** Injected in tests so provider parsing can be exercised without the network. */
	fetchImpl?: typeof fetch;
};

export type ProviderName = "duckduckgo" | "anysearch";
