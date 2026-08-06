import type {
	MarbleAuthorList,
	MarbleCategoryList,
	Pagination,
	MarblePost,
	MarblePostList,
	MarbleTagList,
} from "@/blog/types";
import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSanitize from "rehype-sanitize";

const url =
	process.env.NEXT_PUBLIC_MARBLE_API_URL ?? "https://api.marblecms.com";
const key = process.env.MARBLE_WORKSPACE_KEY ?? "cmd4iw9mm0006l804kwqv0k46";

const EMPTY_PAGINATION: Pagination = {
	limit: 0,
	currpage: 1,
	nextPage: null,
	prevPage: null,
	totalItems: 0,
	totalPages: 0,
};

const EMPTY_POSTS: MarblePostList = {
	posts: [],
	pagination: EMPTY_PAGINATION,
};

const EMPTY_TAGS: MarbleTagList = {
	tags: [],
	pagination: EMPTY_PAGINATION,
};

const EMPTY_CATEGORIES: MarbleCategoryList = {
	categories: [],
	pagination: EMPTY_PAGINATION,
};

const EMPTY_AUTHORS: MarbleAuthorList = {
	authors: [],
	pagination: EMPTY_PAGINATION,
};

function isMarbleConfigured() {
	return ![
		"",
		"placeholder",
		"build-placeholder",
		"your_workspace_key_here",
	].includes(key);
}

async function fetchFromMarble<T>({
	endpoint,
	fallback,
}: {
	endpoint: string;
	fallback: T;
}): Promise<T> {
	if (!isMarbleConfigured()) {
		return fallback;
	}

	try {
		const response = await fetch(`${url}/${key}/${endpoint}`);
		if (!response.ok) {
			console.warn(
				`Failed to fetch ${endpoint}: ${response.status} ${response.statusText}`,
			);
			return fallback;
		}
		return (await response.json()) as T;
	} catch (error) {
		console.error(`Error fetching ${endpoint}:`, error);
		return fallback;
	}
}

export async function getPosts() {
	return fetchFromMarble<MarblePostList>({
		endpoint: "posts",
		fallback: EMPTY_POSTS,
	});
}

export async function getTags() {
	return fetchFromMarble<MarbleTagList>({
		endpoint: "tags",
		fallback: EMPTY_TAGS,
	});
}

export async function getSinglePost({ slug }: { slug: string }) {
	return fetchFromMarble<MarblePost | null>({
		endpoint: `posts/${slug}`,
		fallback: null,
	});
}

export async function getCategories() {
	return fetchFromMarble<MarbleCategoryList>({
		endpoint: "categories",
		fallback: EMPTY_CATEGORIES,
	});
}

export async function getAuthors() {
	return fetchFromMarble<MarbleAuthorList>({
		endpoint: "authors",
		fallback: EMPTY_AUTHORS,
	});
}

export async function processHtmlContent({
	html,
}: {
	html: string;
}): Promise<string> {
	const processor = unified()
		.use(rehypeSanitize)
		.use(rehypeParse, { fragment: true })
		.use(rehypeSlug)
		.use(rehypeAutolinkHeadings, { behavior: "append" })
		.use(rehypeStringify);

	const file = await processor.process({ value: html, type: "html" });
	return String(file);
}
