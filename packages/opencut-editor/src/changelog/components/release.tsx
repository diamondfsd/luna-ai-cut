import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/utils/ui";
import { ReactMarkdownWrapper } from "@/components/ui/react-markdown-wrapper";
import {
	getSectionTitle,
	groupAndOrderChanges,
	isSectionCollapsible,
	type Change,
	type Release,
} from "../utils";
import { ArrowRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function ReleaseArticle({
	variant,
	isLatest,
	children,
}: {
	variant: "list" | "detail";
	isLatest?: boolean;
	children: ReactNode;
}) {
	if (variant === "list") {
		return (
			<article className="relative sm:pl-10">
				<div aria-hidden className="absolute left-0 top-[3px] hidden sm:block">
					<div
						className={cn(
							"size-[11px] rounded-full border-[1.5px]",
							isLatest
								? "border-foreground bg-foreground"
								: "border-muted-foreground/30 bg-background",
						)}
					/>
				</div>
				<div className="flex flex-col gap-5">{children}</div>
			</article>
		);
	}

	return <article className="flex flex-col gap-8">{children}</article>;
}

export function ReleaseMeta({ release }: { release: Release }) {
	return (
		<span className="text-sm font-medium tracking-widest text-muted-foreground">
			{release.version} — {release.date}
		</span>
	);
}

const titleSizes: Record<"h1" | "h2", string> = {
	h1: "text-4xl",
	h2: "text-2xl",
};

export function ReleaseTitle({
	as: As,
	href,
	children,
}: {
	as: "h1" | "h2";
	href?: string;
	children: ReactNode;
}) {
	return (
		<As className={cn("font-bold tracking-tight", titleSizes[As])}>
			{href ? (
				<Link href={href} className="hover:underline underline-offset-4">
					{children}
				</Link>
			) : (
				children
			)}
		</As>
	);
}

export function ReleaseDescription({ children }: { children: ReactNode }) {
	return (
		<p className="text-base text-foreground leading-relaxed max-w-xl">
			{children}
		</p>
	);
}

export function ReleaseChanges({ release }: { release: Release }) {
	const { grouped, orderedTypes } = groupAndOrderChanges({
		changes: release.changes,
	});

	return (
		<div className="flex flex-col gap-4">
			{orderedTypes.map((type) => (
				<ReleaseChangeSection key={type} type={type} changes={grouped[type]} />
			))}
		</div>
	);
}

function ReleaseChangeSection({
	type,
	changes,
}: {
	type: string;
	changes: Change[];
}) {
	const title = getSectionTitle({ type });

	if (isSectionCollapsible({ type })) {
		return (
			<details className="group flex flex-col gap-1.5">
				<summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
					<span>{title}:</span>
					<HugeiconsIcon
						icon={ArrowRightIcon}
						className="size-3 shrink-0 text-muted-foreground group-open:rotate-90"
					/>
				</summary>
				<ReleaseChangeList changes={changes} />
			</details>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			<h3 className="text-base font-semibold text-foreground">{title}:</h3>
			<ReleaseChangeList changes={changes} />
		</div>
	);
}

function ReleaseChangeList({
	changes,
	className,
}: {
	changes: Change[];
	className?: string;
}) {
	return (
		<ul className={cn("list-disc space-y-1.5 pl-5", className)}>
			{changes.map((change) => (
				<li
					key={change.text}
					className="text-base leading-relaxed text-foreground"
				>
					<ReactMarkdownWrapper inline>{change.text}</ReactMarkdownWrapper>
				</li>
			))}
		</ul>
	);
}
