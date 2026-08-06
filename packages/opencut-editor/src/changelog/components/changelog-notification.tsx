"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { getSortedReleases } from "../utils";
import type { Release } from "../utils";

const STORAGE_KEY = "last-seen-version";

export function ChangelogNotification() {
	const [release, setRelease] = useState<Release | null>(null);

	useEffect(() => {
		const releases = getSortedReleases();
		const latest = releases[0];
		if (!latest) return;

		let storedVersion: string | null = null;
		try {
			storedVersion = localStorage.getItem(STORAGE_KEY);
		} catch {
			// localStorage unavailable
		}

		const isOutdated =
			storedVersion === null ||
			storedVersion.localeCompare(latest.version, undefined, {
				numeric: true,
			}) < 0;

		// TODO(v0.4): revert to the standard "null = first-time visitor, record silently"
		// path. The null case intentionally shows the card for this release so existing
		// users who never had the key get the 0.3.0 announcement.
		if (!isOutdated) return;

		try {
			localStorage.setItem(STORAGE_KEY, latest.version);
		} catch {
			// ignore
		}

		setRelease(latest);
	}, []);

	if (!release) return null;

	return (
		<div className="fixed bottom-5 left-5 z-50 flex w-72 flex-col gap-3 rounded-xl border bg-card p-4 shadow-lg">
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-1">
					<span className="text-sm font-semibold leading-snug">
						{release.title}
					</span>
					<span className="text-xs text-muted-foreground">
						v{release.version}
					</span>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="-mr-1 -mt-1 shrink-0"
					onClick={() => setRelease(null)}
					aria-label="Dismiss"
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-4" />
				</Button>
			</div>

			{release.summary && (
				<p className="text-xs leading-relaxed text-muted-foreground">
					{release.summary}
				</p>
			)}

			<div className="flex justify-end">
				<Button asChild size="sm">
					<Link href="/changelog" onClick={() => setRelease(null)}>
						See full changelog
					</Link>
				</Button>
			</div>
		</div>
	);
}
